// 模板的来源、安装、卸载、导出与派生（docs/04-templates.md 4.7–4.9；01-product-architecture.md 1.8、1.9）。
//
// 两个来源走同一条装载路径（读包 → 校验 manifest → 解析派生 → 交给渲染进程的引擎）：
// - 内置：resources/templates/*.allaytpl，只读。跳过 4.8 的第 1、3 步（构建时已保证），其余与用户模板相同。
// - 用户：userData/templates/<id>/<version>/，里面是解压后的包内容；安装元数据在旁边的 <version>.meta.json。
//
// 安装分两段：stage（第 1–3 步，解压到 templates/.staging/<uuid>/）→ 渲染进程试运行（第 4 步）→ commit（第 6 步，改名就位）。
// 渲染进程交来的只有暂存 ID 和试运行的警告，路径都由主进程决定（1.6 第 6 条）。
import { randomBytes, randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import {
  DeriveError,
  TEMPLATE_ID_RE,
  compareVersionStrings,
  isSafeAssetPath,
  isValidVersion,
  parseManifest,
  pickVersion,
  resolveDerived,
  resolveScript,
  sanitizeParams,
  type ResolvedTemplate,
  type TemplateManifest,
} from '@allay/template-sdk';
import { z } from 'zod';
import {
  InstallReportSchema,
  type CommitResult,
  type InstallReport,
  type SaveDerivedRequest,
  type StageResult,
  type TemplateBundle,
  type TemplateEntry,
  type TemplateSourceKind,
  type TrialWarning,
} from '../../shared/templates';
import type { Logger } from '../logger';
import { writeJsonAtomic } from '../settings-store';
import { PackageError, readPackage } from './package-reader';
import { writeZip } from './zip-writer';

/** 暂存的包多久没提交就作废 */
const STAGING_TTL_MS = 10 * 60 * 1000;

interface Stored {
  source: TemplateSourceKind;
  manifest: TemplateManifest;
  /** 内置模板：包内容在内存里；用户模板：从目录按需读 */
  files: Map<string, Uint8Array> | null;
  dir: string | null;
  trialWarnings: TrialWarning[];
}

interface Staged {
  dir: string;
  manifest: TemplateManifest;
  code: string | null;
  expires: number;
}

const MetaSchema = z.looseObject({ formatVersion: z.literal(1), installedAt: z.string(), trialWarnings: z.array(z.string()) });

export type AssetSource = { id: string; version: string } | { stagingId: string };

export interface TemplateServiceOptions {
  /** 内置模板包所在目录（resources/templates） */
  builtinDir: string;
  /** userData 目录 */
  userDataDir: string;
  appVersion: string;
  log: Logger;
  now?: () => number;
}

const key = (id: string, version: string) => `${id}@${version}`;

export class TemplateService {
  private readonly templates = new Map<string, Stored>();
  private readonly staged = new Map<string, Staged>();
  private readonly userDir: string;
  private readonly stagingDir: string;
  private readonly now: () => number;
  /** 写操作串行：安装、删除、派生不交错 */
  private queue: Promise<unknown> = Promise.resolve();

  constructor(private readonly opts: TemplateServiceOptions) {
    this.userDir = join(opts.userDataDir, 'templates');
    this.stagingDir = join(this.userDir, '.staging');
    this.now = opts.now ?? Date.now;
  }

  async init(): Promise<void> {
    await rm(this.stagingDir, { recursive: true, force: true });
    await this.loadBuiltins();
    await this.scanUser();
  }

  // ---- 读 ----

  list(): TemplateEntry[] {
    const out: TemplateEntry[] = [];
    for (const s of this.templates.values()) out.push(this.entryOf(s));
    return out.sort((a, b) => (a.source === b.source ? 0 : a.source === 'builtin' ? -1 : 1) || a.id.localeCompare(b.id) || compareVersionStrings(a.version, b.version));
  }

  /** 装载需要的一切；不存在或派生模板的基模板缺失时返回 null */
  async read(id: string, version: string): Promise<TemplateBundle | null> {
    const s = this.templates.get(key(id, version));
    if (!s) return null;
    const resolved = this.resolve(s.manifest);
    if (!resolved) return null;
    const codeOwner = this.templates.get(key(resolved.codeFrom.id, resolved.codeFrom.version));
    if (!codeOwner) return null;
    const bytes = await this.readFile(codeOwner, 'template.js');
    if (!bytes) return null;
    return { entry: this.entryOf(s), resolved, code: new TextDecoder().decode(bytes) };
  }

  /**
   * 模板包 assets/ 里的文件（asset: 引用）。派生模板先找自己的，再找基模板的。
   * 暂存的包（试运行时）也能读。
   */
  async readAsset(source: AssetSource, path: string): Promise<Uint8Array | null> {
    if (!isSafeAssetPath(path)) return null;
    const rel = `assets/${path}`;
    if ('stagingId' in source) {
      const st = this.staged.get(source.stagingId);
      if (!st) return null;
      const own = await readInside(st.dir, rel);
      if (own || !st.manifest.extends) return own;
      const base = this.resolveBase(st.manifest);
      return base ? this.readFile(base, rel) : null;
    }
    const s = this.templates.get(key(source.id, source.version));
    if (!s) return null;
    const own = await this.readFile(s, rel);
    if (own || !s.manifest.extends) return own;
    const base = this.resolveBase(s.manifest);
    return base ? this.readFile(base, rel) : null;
  }

  // ---- 安装（4.8）----

  /** 第 1–3 步，解压到暂存区。失败返回错误码 */
  stage(file: string): Promise<StageResult> {
    return this.serial(async () => {
      this.dropExpired();
      let pkg;
      try {
        pkg = await readPackage(file, { appVersion: this.opts.appVersion });
      } catch (error) {
        if (error instanceof PackageError) return { ok: false, error: error.toInstallError() };
        throw error;
      }
      const { manifest } = pkg;
      // 派生模板：基模板必须已安装、版本匹配、是脚本模板（第 2 步）
      let resolved: ResolvedTemplate;
      let code: string;
      if (manifest.extends) {
        const candidate = this.findBase(manifest);
        if (!candidate) return { ok: false, error: { code: 'base-missing', detail: `${manifest.extends.id}@${manifest.extends.version}` } };
        // 只允许派生一层（4.7）
        if (candidate.manifest.extends) return { ok: false, error: { code: 'base-not-script', detail: `${candidate.manifest.id}@${candidate.manifest.version}` } };
        const base = candidate;
        try {
          resolved = resolveDerived(manifest, base.manifest);
        } catch (error) {
          if (error instanceof DeriveError) return { ok: false, error: { code: error.code === 'base-not-script' ? 'base-not-script' : 'base-missing', detail: error.message } };
          throw error;
        }
        const baseCode = await this.readFile(base, 'template.js');
        if (!baseCode) return { ok: false, error: { code: 'base-missing', detail: 'base template code is missing' } };
        code = new TextDecoder().decode(baseCode);
      } else {
        resolved = resolveScript(manifest);
        code = pkg.code!;
      }
      const stagingId = randomUUID();
      const dir = join(this.stagingDir, stagingId);
      for (const [path, data] of pkg.files) {
        const target = join(dir, ...path.split('/'));
        await mkdir(dirname(target), { recursive: true });
        await writeFile(target, data);
      }
      this.staged.set(stagingId, { dir, manifest, code: pkg.code, expires: this.now() + STAGING_TTL_MS });
      const entry: TemplateEntry = { id: manifest.id, version: manifest.version, source: 'user', kind: manifest.extends ? 'derived' : 'script', manifest, baseMissing: false, trialWarnings: [] };
      return { ok: true, stagingId, bundle: { entry, resolved, code }, replaces: this.templates.has(key(manifest.id, manifest.version)) };
    });
  }

  /** 第 6 步：暂存区改名就位，记下试运行的警告 */
  commit(stagingId: string, report: InstallReport): Promise<CommitResult> {
    return this.serial(async () => {
      const st = this.staged.get(stagingId);
      this.staged.delete(stagingId);
      if (!st || st.expires < this.now()) {
        if (st) await rm(st.dir, { recursive: true, force: true });
        return { ok: false, error: { code: 'staging-expired', detail: stagingId } };
      }
      const { id, version } = st.manifest;
      const dir = this.versionDir(id, version);
      await rm(dir, { recursive: true, force: true });
      await mkdir(dirname(dir), { recursive: true });
      await rename(st.dir, dir);
      const warnings = InstallReportSchema.parse(report).warnings;
      await writeJsonAtomic(this.metaFile(id, version), { formatVersion: 1, installedAt: new Date(this.now()).toISOString(), trialWarnings: warnings });
      const stored: Stored = { source: 'user', manifest: st.manifest, files: null, dir, trialWarnings: warnings };
      this.templates.set(key(id, version), stored);
      this.opts.log.info('templates', 'installed', { id, version, warnings });
      return { ok: true, entry: this.entryOf(stored) };
    });
  }

  cancel(stagingId: string): Promise<void> {
    return this.serial(async () => {
      const st = this.staged.get(stagingId);
      this.staged.delete(stagingId);
      if (st) await rm(st.dir, { recursive: true, force: true });
    });
  }

  /** 删除用户模板。依赖它的预设和派生模板保留，标记为“基模板缺失”（4.8 末尾） */
  remove(id: string, version: string): Promise<boolean> {
    return this.serial(async () => {
      const s = this.templates.get(key(id, version));
      if (!s || s.source !== 'user') return false;
      this.templates.delete(key(id, version));
      await rm(this.versionDir(id, version), { recursive: true, force: true });
      await rm(this.metaFile(id, version), { force: true });
      // 这个 id 的最后一个版本：把空目录也删掉
      const idDir = join(this.userDir, id);
      const left = await readdir(idDir).catch(() => []);
      if (left.length === 0) await rm(idDir, { recursive: true, force: true });
      this.opts.log.info('templates', 'removed', { id, version });
      return true;
    });
  }

  /** 导出成 .allaytpl 的字节 */
  async exportPackage(id: string, version: string): Promise<Buffer | null> {
    const s = this.templates.get(key(id, version));
    if (!s) return null;
    const entries: { path: string; data: Uint8Array }[] = [];
    if (s.files) {
      for (const [path, data] of [...s.files].sort(([a], [b]) => a.localeCompare(b))) entries.push({ path, data });
    } else {
      for (const path of await listDir(s.dir!)) {
        const data = await readInside(s.dir!, path);
        if (data) entries.push({ path, data });
      }
    }
    return writeZip(entries);
  }

  /**
   * 另存为派生模板（4.7）：新的 id 是 user.<随机>.<名字>，版本 1.0.0。
   * 覆盖的默认值按基模板的参数定义清洗，只留基模板有的键。
   */
  saveDerived(req: SaveDerivedRequest, resolveFile: (ref: string) => string | null = () => null): Promise<{ ok: true; entry: TemplateEntry } | { ok: false; error: string }> {
    return this.serial(async () => {
      const base = this.templates.get(key(req.base.id, req.base.version));
      if (!base) return { ok: false, error: 'base-missing' };
      if (base.manifest.extends) return { ok: false, error: 'base-not-script' };
      const defs = base.manifest.params ?? [];
      const known = new Set(defs.map((d) => d.key));
      const picked: Record<string, unknown> = Object.fromEntries(Object.entries(req.defaults).filter(([k]) => known.has(k)));
      // 用户选的图片（texture 参数的 file: 引用）：按引用读出、复制进派生模板的 assets/，默认值改成 asset: 引用（4.7、M4）
      const assets: { name: string; bytes: Uint8Array }[] = [];
      for (const def of defs) {
        const v = picked[def.key];
        if (def.type !== 'texture' || typeof v !== 'string') continue;
        const m = /^file:([0-9a-fA-F-]{36})$/.exec(v);
        if (!m) continue;
        const path = resolveFile(m[1]!);
        const image = path ? await readImageFile(path) : null;
        if (!image) return { ok: false, error: 'image-unreadable' };
        const name = `${def.key}.${image.ext}`;
        assets.push({ name, bytes: image.bytes });
        picked[def.key] = `asset:${name}`;
      }
      const clean = sanitizeParams(defs, picked);
      const defaults = Object.fromEntries(Object.keys(picked).map((k) => [k, clean[k]!]));
      const slug = req.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'template';
      const id = `user.${randomBytes(3).toString('hex')}.${slug}`;
      const raw = {
        formatVersion: 1,
        id,
        version: '1.0.0',
        name: req.name,
        category: base.manifest.category,
        extends: { id: base.manifest.id, version: `^${base.manifest.version}` },
        overrides: { defaults, hidden: req.hidden.filter((k) => known.has(k)) },
      };
      const parsed = parseManifest(raw);
      if (!parsed.ok) return { ok: false, error: parsed.issues.map((i) => `${i.path}: ${i.message}`).join('; ') };
      const dir = this.versionDir(id, '1.0.0');
      await mkdir(dir, { recursive: true });
      if (assets.length > 0) {
        await mkdir(join(dir, 'assets'), { recursive: true });
        for (const a of assets) await writeFile(join(dir, 'assets', a.name), a.bytes);
      }
      await writeJsonAtomic(join(dir, 'manifest.json'), raw);
      await writeJsonAtomic(this.metaFile(id, '1.0.0'), { formatVersion: 1, installedAt: new Date(this.now()).toISOString(), trialWarnings: [] });
      const stored: Stored = { source: 'user', manifest: parsed.manifest, files: null, dir, trialWarnings: [] };
      this.templates.set(key(id, '1.0.0'), stored);
      return { ok: true, entry: this.entryOf(stored) };
    });
  }

  // ---- 内部 ----

  private serial<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.queue.then(fn, fn);
    this.queue = run.catch(() => undefined);
    return run;
  }

  private dropExpired(): void {
    const now = this.now();
    for (const [id, st] of this.staged) {
      if (st.expires >= now) continue;
      this.staged.delete(id);
      void rm(st.dir, { recursive: true, force: true });
    }
  }

  private versionDir(id: string, version: string): string {
    return join(this.userDir, id, version);
  }

  private metaFile(id: string, version: string): string {
    return join(this.userDir, id, `${version}.meta.json`);
  }

  private entryOf(s: Stored): TemplateEntry {
    const m = s.manifest;
    return {
      id: m.id,
      version: m.version,
      source: s.source,
      kind: m.extends ? 'derived' : 'script',
      manifest: m,
      baseMissing: m.extends ? this.resolve(m) === null : false,
      trialWarnings: s.trialWarnings,
    };
  }

  /** extends 指向的模板：满足版本范围的最高版本（可能本身是派生模板） */
  private findBase(m: TemplateManifest): Stored | null {
    const ext = m.extends;
    if (!ext) return null;
    const versions = [...this.templates.values()].filter((s) => s.manifest.id === ext.id).map((s) => s.manifest.version);
    const v = pickVersion(versions, ext.version, compareVersionStrings);
    return (v ? this.templates.get(key(ext.id, v)) : undefined) ?? null;
  }

  /** 派生模板的基模板：必须是脚本模板 */
  private resolveBase(m: TemplateManifest): Stored | null {
    const base = this.findBase(m);
    return base && !base.manifest.extends ? base : null;
  }

  private resolve(m: TemplateManifest): ResolvedTemplate | null {
    if (!m.extends) return resolveScript(m);
    const base = this.resolveBase(m);
    if (!base) return null;
    try {
      return resolveDerived(m, base.manifest);
    } catch {
      return null;
    }
  }

  private async readFile(s: Stored, path: string): Promise<Uint8Array | null> {
    if (s.files) return s.files.get(path) ?? null;
    return readInside(s.dir!, path);
  }

  private async loadBuiltins(): Promise<void> {
    const names = await readdir(this.opts.builtinDir).catch(() => [] as string[]);
    for (const name of names.filter((n) => n.endsWith('.allaytpl')).sort()) {
      try {
        const pkg = await readPackage(join(this.opts.builtinDir, name), { builtin: true, appVersion: this.opts.appVersion });
        this.templates.set(key(pkg.manifest.id, pkg.manifest.version), { source: 'builtin', manifest: pkg.manifest, files: pkg.files, dir: null, trialWarnings: [] });
      } catch (error) {
        this.opts.log.error('templates', 'built-in template rejected', { name, error: error instanceof Error ? error.message : String(error) });
      }
    }
    if (this.templates.size === 0) this.opts.log.warn('templates', 'no built-in templates found', { dir: this.opts.builtinDir });
  }

  private async scanUser(): Promise<void> {
    const ids = await readdir(this.userDir).catch(() => [] as string[]);
    for (const id of ids) {
      if (!TEMPLATE_ID_RE.test(id)) continue;
      const versions = await readdir(join(this.userDir, id)).catch(() => [] as string[]);
      for (const version of versions) {
        const dir = this.versionDir(id, version);
        if (!isValidVersion(version) || !(await stat(dir).catch(() => null))?.isDirectory()) continue;
        try {
          const parsed = parseManifest(JSON.parse(await readFile(join(dir, 'manifest.json'), 'utf8')));
          if (!parsed.ok) throw new Error(parsed.issues.map((i) => `${i.path}: ${i.message}`).join('; '));
          const m = parsed.manifest;
          if (m.id !== id || m.version !== version) throw new Error('manifest id/version does not match its folder');
          if (!m.extends && !existsSync(join(dir, 'template.js'))) throw new Error('template.js is missing');
          if (this.templates.has(key(id, version))) throw new Error('shadows a built-in template');
          let trialWarnings: TrialWarning[] = [];
          try {
            const meta = MetaSchema.parse(JSON.parse(await readFile(this.metaFile(id, version), 'utf8')));
            trialWarnings = InstallReportSchema.parse({ warnings: meta.trialWarnings }).warnings;
          } catch {
            // 元数据丢了不影响装载
          }
          this.templates.set(key(id, version), { source: 'user', manifest: m, files: null, dir, trialWarnings });
        } catch (error) {
          this.opts.log.warn('templates', 'skipped installed template', { id, version, error: error instanceof Error ? error.message : String(error) });
        }
      }
    }
  }
}

/** 读目录里的一个相对路径（正斜杠分隔，已确认安全）；不是普通文件时返回 null */
async function readInside(dir: string, rel: string): Promise<Uint8Array | null> {
  const parts = rel.split('/');
  if (parts.some((p) => p === '' || p === '.' || p === '..' || /[\\:]/.test(p))) return null;
  const file = join(dir, ...parts);
  const info = await stat(file).catch(() => null);
  if (!info?.isFile() || info.size > 64 * 1024 * 1024) return null;
  return new Uint8Array(await readFile(file));
}

async function listDir(dir: string, prefix = ''): Promise<string[]> {
  const out: string[] = [];
  for (const d of await readdir(dir, { withFileTypes: true })) {
    if (d.isSymbolicLink()) continue;
    const rel = prefix ? `${prefix}/${d.name}` : d.name;
    if (d.isDirectory()) out.push(...(await listDir(join(dir, d.name), rel)));
    else if (d.isFile()) out.push(rel);
  }
  return out.sort();
}

/** 派生模板里带的图片上限（单张） */
export const MAX_DERIVED_IMAGE_BYTES = 16 * 1024 * 1024;

/** 读用户选的图片：只认 PNG、JPEG、WebP（按文件头判断，不看扩展名） */
export async function readImageFile(path: string): Promise<{ bytes: Uint8Array; ext: 'png' | 'jpg' | 'webp' } | null> {
  try {
    const info = await stat(path);
    if (!info.isFile() || info.size > MAX_DERIVED_IMAGE_BYTES || info.size < 12) return null;
    const bytes = new Uint8Array(await readFile(path));
    const ascii = (from: number, to: number) => String.fromCharCode(...bytes.subarray(from, to));
    if (bytes[0] === 0x89 && ascii(1, 4) === 'PNG') return { bytes, ext: 'png' };
    if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return { bytes, ext: 'jpg' };
    if (ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP') return { bytes, ext: 'webp' };
    return null;
  } catch {
    return null;
  }
}
