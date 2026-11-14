// 自动更新（docs/decisions.md“自动更新”，用户 2026-11-14 授权的对“应用不联网”的第二个例外）。
//
// 边界（全部写死在这个文件里）：
// - 只在主进程发起，用 Node 的 fetch；渲染进程的会话级网络拦截、CSP 和 1.6 的其余各条都不动。
// - 只用 https、默认端口；主机只认 GitHub 和 GitCode 的 API、下载地址和它们的文件 CDN，重定向逐跳过白名单。
// - 请求只带固定的 User-Agent 和 Accept，不带任何用户信息、设备标识或令牌。
// - 只读本仓库的最新正式版（GitHub 的 releases/latest、GitCode v5 的 releases/latest）。
// - 安装包先写临时文件，按同一个 Release 里的 SHA256SUMS.txt 校验 SHA-256 和大小后才改名；校验和缺失就不装。
// - 安装：Windows 静默运行 NSIS 安装包（--updated /S --force-run）后退出；macOS 打开 dmg 后退出，由用户拖进“应用程序”。
// - 只有打包后的应用会自动检查；未打包的构建（开发、e2e）只在手动检查时联网，也不安装。
import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, readdir, rename, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import {
  CHECKSUMS_ASSET,
  ReleaseJsonSchema,
  UPDATE_REPO,
  assetPattern,
  compareVersions,
  otherSource,
  parseChecksums,
  resolveUpdateSource,
  versionFromTag,
  type UpdateErrorCode,
  type UpdatePrefs,
  type UpdateRelease,
  type UpdateSource,
  type UpdateState,
} from '../../shared/updates';
import type { Logger } from '../logger';

const RELEASE_API: Record<UpdateSource, string> = {
  github: `https://api.github.com/repos/${UPDATE_REPO}/releases/latest`,
  gitcode: `https://api.gitcode.com/api/v5/repos/${UPDATE_REPO}/releases/latest`,
};

const EXACT_HOSTS = new Set(['api.github.com', 'github.com', 'api.gitcode.com', 'gitcode.com']);
const HOST_SUFFIXES = ['.githubusercontent.com', '.gitcode.com'];

const USER_AGENT = 'AllayMotion-Updater';
const MAX_JSON_BYTES = 4 * 1024 * 1024;
const MAX_INSTALLER_BYTES = 1024 * 1024 * 1024;
const REQUEST_TIMEOUT_MS = 30_000;
const IDLE_TIMEOUT_MS = 60_000;
const MAX_REDIRECTS = 5;

/** 启动后多久第一次自动检查；之后每隔多久再查 */
const FIRST_CHECK_DELAY_MS = 15_000;
const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;
const TICK_MS = 30 * 60 * 1000;

class UpdateError extends Error {
  override name = 'UpdateError';
  constructor(readonly code: UpdateErrorCode, message: string) {
    super(message);
  }
}

export function checkUpdateUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new UpdateError('network', 'invalid url');
  }
  const host = url.hostname.toLowerCase();
  const allowed = EXACT_HOSTS.has(host) || HOST_SUFFIXES.some((s) => host.endsWith(s));
  if (url.protocol !== 'https:' || !allowed || url.port !== '' || url.username !== '' || url.password !== '') {
    throw new UpdateError('network', `host not allowed: ${host}`);
  }
  return url;
}

/** 日志里只记主机和路径，不记查询参数（GitCode 的 CDN 地址带一次性签名） */
function short(url: URL): string {
  return `${url.host}${url.pathname.length > 80 ? `${url.pathname.slice(0, 80)}…` : url.pathname}`;
}

async function request(raw: string, accept: string, signal: AbortSignal): Promise<Response> {
  let url = checkUpdateUrl(raw);
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    let res: Response;
    try {
      res = await fetch(url, { headers: { 'User-Agent': USER_AGENT, Accept: accept }, redirect: 'manual', signal });
    } catch (error) {
      if (signal.aborted) throw error;
      throw new UpdateError('network', `request failed: ${short(url)}`);
    }
    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get('location');
      await res.body?.cancel();
      if (!location) throw new UpdateError('network', 'redirect without location');
      url = checkUpdateUrl(new URL(location, url).toString());
      continue;
    }
    if (!res.ok) {
      await res.body?.cancel();
      throw new UpdateError(res.status === 404 ? 'no-release' : 'network', `HTTP ${res.status}: ${short(url)}`);
    }
    return res;
  }
  throw new UpdateError('network', 'too many redirects');
}

async function readText(res: Response, maxBytes: number): Promise<string> {
  const declared = Number(res.headers.get('content-length') ?? Number.NaN);
  if (Number.isFinite(declared) && declared > maxBytes) throw new UpdateError('network', 'response too large');
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length > maxBytes) throw new UpdateError('network', 'response too large');
  return buf.toString('utf8');
}

async function sha256File(file: string): Promise<string> {
  const h = createHash('sha256');
  for await (const chunk of createReadStream(file)) h.update(chunk as Buffer);
  return h.digest('hex');
}

interface FoundRelease {
  release: UpdateRelease;
  assetUrl: string;
  sha256: string;
}

export interface UpdateServiceOptions {
  currentVersion: string;
  packaged: boolean;
  /** userData/updates */
  downloadDir: string;
  platform: string;
  arch: string;
  timeZone: string | undefined;
  prefs(): UpdatePrefs;
  log: Logger;
  onChanged(state: UpdateState): void;
  /** 安装包已经启动（或 dmg 已经打开）：退出应用 */
  quit(): void;
  /** macOS：用系统默认程序打开 dmg；返回错误信息，成功时为空串 */
  openPath(path: string): Promise<string>;
}

export class UpdateService {
  private state: UpdateState;
  private found: FoundRelease | null = null;
  private downloadedFile: string | null = null;
  private checking: Promise<UpdateState> | null = null;
  private downloadAbort: AbortController | null = null;
  private timers: NodeJS.Timeout[] = [];
  private lastProgressAt = 0;

  constructor(private readonly o: UpdateServiceOptions) {
    const supported = assetPattern(o.platform, o.arch) !== null;
    this.state = {
      status: supported ? 'idle' : 'unsupported',
      currentVersion: o.currentVersion,
      preferredSource: resolveUpdateSource(o.prefs().source, o.timeZone),
      latest: null,
      progress: null,
      error: null,
      checkedAt: null,
      announce: false,
    };
  }

  get current(): UpdateState {
    return { ...this.state, preferredSource: resolveUpdateSource(this.o.prefs().source, this.o.timeZone) };
  }

  private set(patch: Partial<UpdateState>): UpdateState {
    this.state = { ...this.state, announce: false, ...patch };
    const s = this.current;
    this.o.onChanged(s);
    return s;
  }

  /** 打包后的应用：启动一会儿后检查一次，之后定时检查（设置为 off 时跳过） */
  start(): void {
    if (!this.o.packaged || this.state.status === 'unsupported') return;
    this.timers.push(setTimeout(() => void this.autoCheck(), FIRST_CHECK_DELAY_MS));
    this.timers.push(setInterval(() => void this.autoCheck(), TICK_MS));
  }

  /** 设置变了：从 off 打开时尽快查一次 */
  prefsChanged(prev: UpdatePrefs, next: UpdatePrefs): void {
    if (prev.mode === 'off' && next.mode !== 'off' && this.o.packaged && this.state.status !== 'unsupported') {
      this.timers.push(setTimeout(() => void this.autoCheck(true), 1000));
    }
    if (prev.source !== next.source) this.o.onChanged(this.current);
  }

  stop(): void {
    for (const t of this.timers) clearTimeout(t);
    this.timers = [];
    this.downloadAbort?.abort();
  }

  private async autoCheck(force = false): Promise<void> {
    const prefs = this.o.prefs();
    if (prefs.mode === 'off') return;
    if (!force && this.state.checkedAt !== null && Date.now() - this.state.checkedAt < CHECK_INTERVAL_MS) return;
    if (this.state.status === 'downloading' || this.state.status === 'downloaded') return;
    const s = await this.check(false);
    if (s.status !== 'available' || !s.latest || s.latest.version === prefs.skipVersion) return;
    if (prefs.mode === 'auto') await this.download(true);
    else this.set({ announce: true });
  }

  /** 检查最新版本。manual 为假时是后台的自动检查 */
  check(manual: boolean): Promise<UpdateState> {
    if (this.state.status === 'unsupported') return Promise.resolve(this.current);
    if (this.state.status === 'downloading' || this.state.status === 'downloaded') return Promise.resolve(this.current);
    if (this.checking) return this.checking;
    this.checking = this.runCheck(manual).finally(() => {
      this.checking = null;
    });
    return this.checking;
  }

  private async runCheck(manual: boolean): Promise<UpdateState> {
    this.set({ status: 'checking', error: null, progress: null });
    const preferred = resolveUpdateSource(this.o.prefs().source, this.o.timeZone);
    let firstError: UpdateError | null = null;
    for (const source of [preferred, otherSource(preferred)]) {
      try {
        const found = await this.fetchRelease(source);
        this.found = found;
        const newer = compareVersions(found.release.version, this.o.currentVersion) > 0;
        this.o.log.info('updates', 'checked', { source, latest: found.release.version, current: this.o.currentVersion, manual });
        return this.set({ status: newer ? 'available' : 'up-to-date', latest: found.release, checkedAt: Date.now() });
      } catch (error) {
        const e = error instanceof UpdateError ? error : new UpdateError('network', String(error));
        this.o.log.warn('updates', 'check failed', { source, code: e.code, message: e.message });
        firstError ??= e;
      }
    }
    return this.set({ status: 'error', error: firstError?.code ?? 'network', checkedAt: Date.now() });
  }

  private async fetchRelease(source: UpdateSource): Promise<FoundRelease> {
    const pattern = assetPattern(this.o.platform, this.o.arch);
    if (!pattern) throw new UpdateError('no-asset', 'unsupported platform');
    const signal = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
    const res = await request(RELEASE_API[source], 'application/json', signal);
    let json: unknown;
    try {
      json = JSON.parse(await readText(res, MAX_JSON_BYTES));
    } catch (error) {
      if (error instanceof UpdateError) throw error;
      throw new UpdateError('no-release', 'release is not JSON');
    }
    const parsed = ReleaseJsonSchema.safeParse(json);
    if (!parsed.success) throw new UpdateError('no-release', 'unexpected release format');
    const r = parsed.data;
    const version = versionFromTag(r.tag_name);
    if (!version || r.draft || r.prerelease) throw new UpdateError('no-release', `not a release: ${r.tag_name}`);
    const assets = r.assets.filter((a) => a.type !== 'source');
    const asset = assets.find((a) => pattern.test(a.name));
    const sums = assets.find((a) => a.name === CHECKSUMS_ASSET);
    if (!asset || !sums) throw new UpdateError('no-asset', `${source} ${r.tag_name} has no installer or checksums yet`);
    checkUpdateUrl(asset.browser_download_url);
    const sumsText = await readText(await request(sums.browser_download_url, 'application/octet-stream', AbortSignal.timeout(REQUEST_TIMEOUT_MS)), 64 * 1024);
    const sha256 = parseChecksums(sumsText).get(asset.name);
    if (!sha256) throw new UpdateError('checksum', `no checksum for ${asset.name}`);
    return {
      release: {
        version,
        tag: r.tag_name,
        source,
        publishedAt: r.published_at ?? r.created_at ?? null,
        asset: { name: asset.name, size: asset.size ?? 0 },
      },
      assetUrl: asset.browser_download_url,
      sha256,
    };
  }

  /** 下载这台机器的安装包并校验。background 为真时是 auto 模式的后台下载（完成后通知界面） */
  async download(background = false): Promise<UpdateState> {
    const found = this.found;
    if (!found || this.state.status === 'downloading') return this.current;
    if (this.state.status === 'downloaded' && this.downloadedFile) return this.current;
    if (compareVersions(found.release.version, this.o.currentVersion) <= 0) return this.current;
    const name = found.release.asset.name;
    if (!/^[\w.-]+$/.test(name)) return this.set({ status: 'error', error: 'no-asset' });
    const dest = join(this.o.downloadDir, name);
    const abort = new AbortController();
    this.downloadAbort = abort;
    this.set({ status: 'downloading', error: null, progress: { received: 0, total: found.release.asset.size } });
    try {
      await mkdir(this.o.downloadDir, { recursive: true });
      // 已经下好、校验也对：不重下
      if ((await stat(dest).catch(() => null))?.isFile() && (await sha256File(dest)) === found.sha256) {
        this.downloadedFile = dest;
        return this.set({ status: 'downloaded', progress: null, announce: background });
      }
      // 清掉以前的版本和半成品
      for (const f of await readdir(this.o.downloadDir)) await rm(join(this.o.downloadDir, f), { recursive: true, force: true });
      await this.fetchToFile(found, dest, abort);
      this.downloadedFile = dest;
      this.o.log.info('updates', 'downloaded', { version: found.release.version, source: found.release.source });
      return this.set({ status: 'downloaded', progress: null, announce: background });
    } catch (error) {
      // 空闲超时也走 abort，原因是 UpdateError；用户取消的原因不是
      const reason: unknown = abort.signal.reason;
      if (abort.signal.aborted && !(reason instanceof UpdateError)) {
        this.o.log.info('updates', 'download canceled');
        return this.set({ status: 'available', progress: null });
      }
      const e = reason instanceof UpdateError ? reason : error instanceof UpdateError ? error : new UpdateError('network', String(error));
      this.o.log.warn('updates', 'download failed', { code: e.code, message: e.message });
      return this.set({ status: 'error', error: e.code, progress: null });
    } finally {
      if (this.downloadAbort === abort) this.downloadAbort = null;
    }
  }

  private async fetchToFile(found: FoundRelease, dest: string, abort: AbortController): Promise<void> {
    const tmp = `${dest}.${randomUUID()}.part`;
    let idle: NodeJS.Timeout | null = null;
    const kick = () => {
      if (idle) clearTimeout(idle);
      idle = setTimeout(() => abort.abort(new UpdateError('network', 'idle timeout')), IDLE_TIMEOUT_MS);
    };
    try {
      kick();
      const res = await request(found.assetUrl, 'application/octet-stream', abort.signal);
      const declared = Number(res.headers.get('content-length') ?? Number.NaN);
      const total = found.release.asset.size || (Number.isFinite(declared) ? declared : 0);
      if (total > MAX_INSTALLER_BYTES) throw new UpdateError('network', 'installer too large');
      if (!res.body) throw new UpdateError('network', 'empty body');
      const hash = createHash('sha256');
      let received = 0;
      const meter = new Transform({
        transform: (chunk: Buffer, _enc, done) => {
          received += chunk.length;
          if (received > MAX_INSTALLER_BYTES) {
            done(new UpdateError('network', 'installer too large'));
            return;
          }
          hash.update(chunk);
          kick();
          const now = Date.now();
          if (now - this.lastProgressAt > 250) {
            this.lastProgressAt = now;
            this.set({ progress: { received, total } });
          }
          done(null, chunk);
        },
      });
      try {
        await pipeline(Readable.fromWeb(res.body as Parameters<typeof Readable.fromWeb>[0]), meter, createWriteStream(tmp, { flags: 'wx' }));
      } catch (error) {
        if (abort.signal.aborted) throw error;
        if (error instanceof UpdateError) throw error;
        const code = (error as NodeJS.ErrnoException).code;
        throw new UpdateError(code === 'ENOSPC' || code === 'EACCES' || code === 'EPERM' ? 'disk' : 'network', String(error));
      }
      if ((found.release.asset.size && received !== found.release.asset.size) || hash.digest('hex') !== found.sha256) {
        throw new UpdateError('checksum', 'downloaded installer does not match SHA256SUMS.txt');
      }
      await rename(tmp, dest);
    } finally {
      if (idle) clearTimeout(idle);
      await rm(tmp, { force: true });
    }
  }

  cancel(): void {
    this.downloadAbort?.abort();
  }

  /** 运行下好的安装包并退出应用 */
  async install(): Promise<UpdateState> {
    const file = this.downloadedFile;
    if (this.state.status !== 'downloaded' || !file) return this.current;
    if (!this.o.packaged) {
      this.o.log.warn('updates', 'install skipped: not packaged');
      return this.set({ status: 'error', error: 'install' });
    }
    try {
      if (this.o.platform === 'win32') {
        // NSIS（electron-builder）：--updated 按更新处理，/S 静默安装到原来的位置，--force-run 装完重新启动应用
        const child = spawn(file, ['--updated', '/S', '--force-run'], { detached: true, stdio: 'ignore' });
        child.unref();
      } else {
        const error = await this.o.openPath(file);
        if (error) throw new Error(error);
      }
    } catch (error) {
      this.o.log.error('updates', 'install failed', { error: String(error) });
      return this.set({ status: 'error', error: 'install' });
    }
    this.o.log.info('updates', 'installing, quitting', { version: this.state.latest?.version });
    this.o.quit();
    return this.current;
  }
}
