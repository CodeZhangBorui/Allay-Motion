// 主进程的资源栈服务（docs/03-assets.md 3.2–3.5、01-product-architecture.md 1.8 的 resources 命名空间）。
// 持有各层、按设置组装资源栈、算 resourceStamp，栈一变就通知渲染进程。不依赖 Electron：对话框由调用方传入。
import { randomUUID } from 'node:crypto';
import { readFile, rm, stat } from 'node:fs/promises';
import { basename, extname } from 'node:path';
import {
  buildStack,
  computeResourceStamp,
  layersWith,
  listMerged,
  parseBdf,
  parseFontJson,
  readResource,
  resolveFontProviders,
  textureIdToPath,
  textureMetaPath,
  type BitmapFontTables,
  type ResourceLayer,
  type ResourceStackSettings,
} from '@allay/assets';
import type {
  AddPackResult,
  BrokenPack,
  ChooseGameDirResult,
  DownloadErrorKind,
  DownloadResult,
  DownloadState,
  FontProvidersResult,
  LayerInfo,
  ResourceState,
  VanillaState,
} from '../../shared/resources';
import type { Logger } from '../logger';
import type { SettingsStore } from '../settings-store';
import { chooseVanillaSource, DownloadError, type CachedVanilla, type VanillaDownloader } from './download';
import { BUILTIN_LAYER_ID, openBuiltinLayer, openFolderPack, openZipPack, type ClosableLayer } from './layers';
import { importZipPack, packZipPath } from './pack-import';
import { detectMinecraft, findLatestRelease, openVanillaLayer, VANILLA_LAYER_ID, type CandidateEnv, type VanillaInstall } from './vanilla';
import { ZipRejectedError } from './zip';

export interface ResourceServiceOptions {
  userDataDir: string;
  /** 内置层的目录（v1 没有自制素材，通常不存在，见 decisions.md M2a） */
  builtinDir: string;
  /** 兜底像素字体（BDF）的路径 */
  fallbackFontFile: string;
  settings: SettingsStore;
  log: Logger;
  gameEnv: CandidateEnv;
  downloader: VanillaDownloader;
  onChanged(state: ResourceState): void;
}

/** 下载进度最多每 100 ms 通知一次 */
const PROGRESS_INTERVAL_MS = 100;

function downloadErrorKind(error: unknown): DownloadErrorKind {
  if (error instanceof DownloadError) {
    if (error.code === 'hash' || error.code === 'size' || error.code === 'bad-data') return 'verify';
    if (error.code === 'aborted') return 'unknown';
    return 'network';
  }
  const code = (error as { code?: unknown } | null)?.code;
  if (code === 'ENOSPC' || code === 'EACCES' || code === 'EPERM' || code === 'EROFS') return 'disk';
  return 'unknown';
}

function sameInstall(a: VanillaInstall | null, b: VanillaInstall | null): boolean {
  return a?.jarPath === b?.jarPath && a?.versionId === b?.versionId;
}

export class ResourceService {
  private builtin: ClosableLayer | null = null;
  private vanillaLayer: ClosableLayer | null = null;
  private vanillaInstall: VanillaInstall | null = null;
  private local: VanillaInstall | null = null;
  private cached: CachedVanilla | null = null;
  private vanillaProblem: VanillaState['problem'] = null;
  private readonly packs = new Map<string, ClosableLayer>();
  private broken: BrokenPack[] = [];
  private stack: ResourceLayer[] = [];
  private stamp = '';
  private detecting = true;
  private download: DownloadState = { status: 'idle' };
  private downloadAbort: AbortController | null = null;
  private lastProgress = 0;
  private fallbackFont: Promise<BitmapFontTables | null> | null = null;
  /** 改栈的操作串行执行，避免交错 */
  private queue: Promise<unknown> = Promise.resolve();

  constructor(private readonly opts: ResourceServiceOptions) {}

  private serial<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.queue.then(fn, fn);
    this.queue = run.catch(() => undefined);
    return run;
  }

  private get settings(): ResourceStackSettings {
    return this.opts.settings.resources;
  }

  private async saveSettings(next: ResourceStackSettings): Promise<void> {
    await this.opts.settings.updateResources(next);
  }

  /** 启动：先打开内置层和资源包（不需要探测），再在后台离线探测原版层（3.4） */
  private opened: Promise<void> | null = null;

  /** 内置层和资源包已经打开（state() 才有意义） */
  whenOpened(): Promise<void> {
    return this.opened ?? Promise.resolve();
  }

  async init(): Promise<void> {
    this.opened = this.serial(async () => {
      this.builtin = await openBuiltinLayer(this.opts.builtinDir);
      await this.openPacks();
      this.rebuild();
    });
    await this.opened;
    void this.serial(async () => {
      await this.detectVanilla();
      this.detecting = false;
      this.rebuild();
    });
  }

  // ---- 状态 ----

  state(): ResourceState {
    const vanilla: VanillaState = {
      consent: this.settings.vanilla.consent,
      enabled: this.settings.vanilla.enabled,
      local: this.local ? { versionId: this.local.versionId, gameDir: this.local.gameDir } : null,
      cached: this.cached ? { versionId: this.cached.versionId } : null,
      active: this.vanillaLayer ? (this.vanillaInstall === this.cached ? 'cached' : 'local') : null,
      problem: this.vanillaProblem,
    };
    const layers: LayerInfo[] = this.stack.map((l) => {
      const info: LayerInfo = { id: l.id, kind: l.kind, name: l.name, enabled: l.enabled, legacyFormat: l.legacyFormat === true, warnings: [...(l.warnings ?? [])].slice(0, 20) };
      if (l.description !== undefined) info.description = l.description;
      if (l.packFormat !== undefined) info.packFormat = l.packFormat;
      if (l.icon) info.icon = l.icon;
      if (l.kind === 'vanilla') info.source = vanilla.active === 'cached' ? 'downloaded' : 'local';
      if (l.kind === 'pack') info.source = this.settings.packs.find((p) => p.id === l.id)?.source.kind ?? 'zip';
      if (l.kind === 'builtin') info.empty = l.revision === 'empty' || l.list('').length === 0;
      return info;
    });
    const hasAssets = this.stack.some((l) => l.kind !== 'builtin' && l.enabled) || layers.some((l) => l.kind === 'builtin' && !l.empty);
    return { stamp: this.stamp, layers, brokenPacks: [...this.broken], vanilla, download: this.download, detecting: this.detecting, hasAssets };
  }

  get resourceStamp(): string {
    return this.stamp;
  }

  private emit(): void {
    this.opts.onChanged(this.state());
  }

  private rebuild(): void {
    if (!this.builtin) return;
    this.stack = buildStack(this.builtin, this.vanillaLayer, this.packs, this.settings);
    this.stamp = computeResourceStamp(this.stack);
    this.emit();
  }

  // ---- 原版层 ----

  /** 离线：探测本机游戏和下载缓存，按设置决定用哪个（不联网） */
  private async detectVanilla(): Promise<void> {
    this.local = await detectMinecraft(this.opts.gameEnv, this.settings.vanilla.dir).catch((error: unknown) => {
      this.opts.log.warn('resources', 'minecraft detection failed', { error });
      return null;
    });
    this.cached = await this.opts.downloader.findCached().catch(() => null);
    this.opts.log.info('resources', 'vanilla sources', { local: this.local?.versionId ?? null, cached: this.cached?.versionId ?? null });
    await this.applyVanilla();
  }

  private async applyVanilla(): Promise<void> {
    const choice = chooseVanillaSource(this.local, this.cached);
    const want = this.settings.vanilla.consent === true ? choice.install : null;
    if (sameInstall(want, this.vanillaInstall) && (want === null || this.vanillaLayer)) {
      // 来源对象可能换成了新探测的那一个（cached 和 local 的判断要用最新的）
      if (want) this.vanillaInstall = want;
      return;
    }
    this.vanillaLayer?.close();
    this.vanillaLayer = null;
    this.vanillaInstall = null;
    this.vanillaProblem = null;
    if (!want) {
      // 同意过、开着，却哪里都找不到了（游戏被移动或卸载）：提示一次（3.4）
      if (this.settings.vanilla.consent === true && this.settings.vanilla.enabled && !choice.install) this.vanillaProblem = 'missing';
      return;
    }
    try {
      // 下载缓存的原版层不传 fetchObject：除了用户点“下载”，不按需联网取音效（decisions.md M2b）
      this.vanillaLayer = await openVanillaLayer(want);
      this.vanillaInstall = want;
    } catch (error) {
      // jar 不见了或打不开：静默退回，在资源面板里提示（3.4）
      this.opts.log.warn('resources', 'vanilla jar unreadable', { jar: want.jarPath, error });
      this.vanillaProblem = 'jar-unreadable';
    }
  }

  detectMinecraft(): Promise<ResourceState> {
    return this.serial(async () => {
      await this.detectVanilla();
      this.rebuild();
      return this.state();
    });
  }

  setVanilla(patch: { consent?: boolean; enabled?: boolean }): Promise<ResourceState> {
    return this.serial(async () => {
      const v = { ...this.settings.vanilla, ...patch };
      await this.saveSettings({ ...this.settings, vanilla: v });
      await this.applyVanilla();
      this.rebuild();
      return this.state();
    });
  }

  /** 用户在主进程的对话框里选了一个游戏目录 */
  useGameDir(dir: string): Promise<ChooseGameDirResult> {
    return this.serial(async () => {
      const install = await findLatestRelease(dir);
      if (!install) return { ok: false, error: 'no-release' } as const;
      await this.saveSettings({ ...this.settings, vanilla: { ...this.settings.vanilla, dir, consent: true, enabled: true } });
      this.local = install;
      await this.applyVanilla();
      this.rebuild();
      return { ok: true } as const;
    });
  }

  /** 联网：只在用户点了“下载原版资源”之后调用（decisions.md M2a 的联网例外） */
  async downloadVanilla(): Promise<DownloadResult> {
    if (this.downloadAbort) return { ok: false, error: 'busy' };
    const abort = new AbortController();
    this.downloadAbort = abort;
    this.download = { status: 'running', phase: 'manifest', received: 0, total: null };
    this.emit();
    try {
      const cached = await this.opts.downloader.downloadLatest({
        signal: abort.signal,
        onProgress: (p) => {
          this.download = { status: 'running', phase: p.phase, received: p.received, total: p.total };
          const now = Date.now();
          if (now - this.lastProgress >= PROGRESS_INTERVAL_MS) {
            this.lastProgress = now;
            this.emit();
          }
        },
      });
      this.opts.log.info('resources', 'vanilla downloaded', { version: cached.versionId });
      this.download = { status: 'idle' };
      await this.serial(async () => {
        this.cached = cached;
        await this.saveSettings({ ...this.settings, vanilla: { ...this.settings.vanilla, consent: true, enabled: true } });
        await this.applyVanilla();
        this.rebuild();
      });
      return { ok: true };
    } catch (error) {
      if (abort.signal.aborted) {
        this.opts.log.info('resources', 'vanilla download canceled');
        this.download = { status: 'idle' };
        this.emit();
        return { canceled: true };
      }
      const kind = downloadErrorKind(error);
      this.opts.log.warn('resources', 'vanilla download failed', { kind, error });
      this.download = { status: 'failed', error: kind };
      this.emit();
      return { ok: false, error: kind };
    } finally {
      this.downloadAbort = null;
    }
  }

  cancelDownload(): void {
    this.downloadAbort?.abort();
  }

  // ---- 资源包 ----

  private async openPacks(): Promise<void> {
    for (const l of this.packs.values()) l.close();
    this.packs.clear();
    this.broken = [];
    for (const p of this.settings.packs) {
      try {
        const layer = await this.openPack(p.id, p.name, p.source);
        this.packs.set(p.id, layer);
      } catch (error) {
        const problem: BrokenPack['problem'] = error instanceof ZipRejectedError ? 'rejected' : (error as { code?: string }).code === 'ENOENT' ? 'missing' : 'unreadable';
        this.opts.log.warn('resources', 'pack unavailable', { id: p.id, problem });
        this.broken.push({ id: p.id, name: p.name, problem });
      }
    }
  }

  private async openPack(id: string, name: string, source: ResourceStackSettings['packs'][number]['source']): Promise<ClosableLayer> {
    if (source.kind === 'zip') {
      const file = packZipPath(this.opts.userDataDir, source.file);
      if (!file) throw new ZipRejectedError('bad pack file name');
      return openZipPack(file, id, name);
    }
    const layer = await openFolderPack(source.path, id);
    return { ...layer, name };
  }

  /** 添加 zip 或文件夹形式的资源包（路径来自主进程的对话框或拖放） */
  addPackFromPath(path: string): Promise<AddPackResult> {
    return this.serial(async () => {
      const st = await stat(path).catch(() => null);
      if (!st) return { ok: false, error: 'unreadable' } as const;
      let entry: ResourceStackSettings['packs'][number];
      let layer: ClosableLayer;
      if (st.isDirectory()) {
        const id = `folder:${randomUUID()}`;
        const name = basename(path);
        try {
          layer = await openFolderPack(path, id);
        } catch (error) {
          this.opts.log.warn('resources', 'folder pack unreadable', { error });
          return { ok: false, error: 'unreadable' } as const;
        }
        layer = { ...layer, name };
        entry = { id, name, source: { kind: 'folder', path }, enabled: true };
      } else if (st.isFile() && extname(path).toLowerCase() === '.zip') {
        let imported;
        try {
          imported = await importZipPack(path, this.opts.userDataDir);
        } catch (error) {
          if (error instanceof ZipRejectedError) {
            this.opts.log.warn('resources', 'zip pack rejected', { reason: error.message });
            return { ok: false, error: 'rejected', detail: error.message.slice(0, 200) } as const;
          }
          this.opts.log.warn('resources', 'zip pack unreadable', { error });
          return { ok: false, error: 'unreadable' } as const;
        }
        const id = `zip:${imported.sha256.slice(0, 16)}`;
        const existing = this.settings.packs.find((p) => p.id === id);
        if (existing) return { ok: true, id, warnings: [] } as const;
        const name = basename(path).replace(/\.zip$/i, '');
        layer = await openZipPack(imported.path, id, name);
        entry = { id, name, source: { kind: 'zip', file: imported.file }, enabled: true };
      } else {
        return { ok: false, error: 'unsupported' } as const;
      }
      this.packs.set(entry.id, layer);
      // 新包放在最上面
      await this.saveSettings({ ...this.settings, packs: [...this.settings.packs, entry] });
      this.rebuild();
      return { ok: true, id: entry.id, warnings: [...(layer.warnings ?? [])].slice(0, 20) } as const;
    });
  }

  removeLayer(id: string): Promise<ResourceState> {
    return this.serial(async () => {
      if (id === VANILLA_LAYER_ID) {
        await this.saveSettings({ ...this.settings, vanilla: { ...this.settings.vanilla, consent: false } });
        await this.applyVanilla();
      } else {
        const entry = this.settings.packs.find((p) => p.id === id);
        if (!entry) return this.state();
        this.packs.get(id)?.close();
        this.packs.delete(id);
        this.broken = this.broken.filter((b) => b.id !== id);
        const packs = this.settings.packs.filter((p) => p.id !== id);
        await this.saveSettings({ ...this.settings, packs });
        // 应用数据目录里的 zip 副本没人用了就删掉
        if (entry.source.kind === 'zip' && !packs.some((p) => p.source.kind === 'zip' && p.source.file === (entry.source as { file: string }).file)) {
          const file = packZipPath(this.opts.userDataDir, entry.source.file);
          if (file) await rm(file, { force: true }).catch(() => undefined);
        }
      }
      this.rebuild();
      return this.state();
    });
  }

  /** 资源包的新顺序（从下往上）；没列出的保持原来的相对顺序放在最上面 */
  reorder(idsBottomToTop: readonly string[]): Promise<ResourceState> {
    return this.serial(async () => {
      const rank = new Map(idsBottomToTop.map((id, i) => [id, i]));
      const listed = this.settings.packs.filter((p) => rank.has(p.id)).sort((a, b) => rank.get(a.id)! - rank.get(b.id)!);
      const rest = this.settings.packs.filter((p) => !rank.has(p.id));
      await this.saveSettings({ ...this.settings, packs: [...listed, ...rest] });
      this.rebuild();
      return this.state();
    });
  }

  setEnabled(id: string, enabled: boolean): Promise<ResourceState> {
    if (id === VANILLA_LAYER_ID) return this.setVanilla({ enabled });
    return this.serial(async () => {
      if (id === BUILTIN_LAYER_ID) return this.state();
      await this.saveSettings({ ...this.settings, packs: this.settings.packs.map((p) => (p.id === id ? { ...p, enabled } : p)) });
      this.rebuild();
      return this.state();
    });
  }

  /** 窗口重新获得焦点时重扫文件夹形式的资源包（3.5）；内容有变化才通知 */
  rescanFolders(): Promise<void> {
    return this.serial(async () => {
      let changed = false;
      for (const p of this.settings.packs) {
        if (p.source.kind !== 'folder') continue;
        const old = this.packs.get(p.id);
        try {
          const layer = { ...(await openFolderPack(p.source.path, p.id)), name: p.name };
          if (!old || old.revision !== layer.revision) {
            this.packs.set(p.id, layer);
            this.broken = this.broken.filter((b) => b.id !== p.id);
            changed = true;
          }
        } catch {
          if (old) {
            this.packs.delete(p.id);
            this.broken = [...this.broken.filter((b) => b.id !== p.id), { id: p.id, name: p.name, problem: 'missing' }];
            changed = true;
          }
        }
      }
      if (changed) this.rebuild();
    });
  }

  // ---- 读取（渲染进程经 IPC 调用；路径已经过 isSafeRelativePath 校验） ----

  async read(path: string): Promise<Uint8Array | null> {
    return (await readResource(this.stack, path))?.data ?? null;
  }

  /** 贴图 PNG 和与它来自同一层的 .mcmeta（游戏的规则：元数据跟着胜出的那张图走） */
  async readTexture(id: string): Promise<{ png: Uint8Array; mcmeta: string | null } | null> {
    const path = textureIdToPath(id);
    if (!path) return null;
    const stack = this.stack;
    for (let i = stack.length - 1; i >= 0; i--) {
      const layer = stack[i];
      if (!layer?.enabled || !layer.has(path)) continue;
      const png = await layer.read(path).catch(() => null);
      if (!png) continue;
      const metaPath = textureMetaPath(path);
      const meta = layer.has(metaPath) ? await layer.read(metaPath).catch(() => null) : null;
      return { png, mcmeta: meta && meta.byteLength <= 65_536 ? new TextDecoder().decode(meta) : null };
    }
    return null;
  }

  list(prefix: string): string[] {
    return listMerged(this.stack, prefix).slice(0, 10_000);
  }

  /** 资源栈里的字体定义（3.9）：各层合并、展开 reference；没有任何层提供时为 null */
  async fontProviders(fontId: string): Promise<FontProvidersResult | null> {
    const stack = this.stack;
    let found = false;
    const { providers, skipped } = await resolveFontProviders(fontId, async (path) => {
      const layers = layersWith(stack, path);
      if (layers.length === 0) return null;
      found = true;
      const out = [];
      for (const layer of layers) {
        const bytes = await layer.read(path).catch(() => null);
        if (bytes && bytes.byteLength <= 4 * 1024 * 1024) out.push(parseFontJson(new TextDecoder().decode(bytes)));
      }
      return out;
    });
    if (!found) return null;
    return {
      providers: providers.map((p) => (p.type === 'bitmap' ? { type: 'bitmap', file: p.file, ascent: p.ascent, height: p.height, rows: p.rows } : { type: 'space', advances: [...p.advances.entries()] })),
      skipped,
    };
  }

  /** 兜底像素字体（不随资源栈变），第一次用到时解析 */
  fallbackFontTables(): Promise<BitmapFontTables | null> {
    this.fallbackFont ??= readFile(this.opts.fallbackFontFile, 'utf8').then(
      (text) => parseBdf(text),
      (error: unknown) => {
        this.opts.log.warn('resources', 'fallback font unavailable', { error });
        return null;
      },
    );
    return this.fallbackFont;
  }

  close(): void {
    this.cancelDownload();
    this.builtin?.close();
    this.vanillaLayer?.close();
    for (const l of this.packs.values()) l.close();
  }
}
