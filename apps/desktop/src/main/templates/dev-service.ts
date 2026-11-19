// 模板开发模式的主进程部分（docs/08-milestones.md MD；docs/code-editing-and-mcp-plan.md H8、H10）：
// 监视用户模板目录并通知界面、把内置模板复制成可编辑的用户模板、往模板文件夹写类型定义和 jsconfig.json、
// 在系统文件管理器里打开模板文件夹。界面接线（热重载、错误浮层、命令）在 MD-b。
import { randomBytes } from 'node:crypto';
import { readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { animationTemplateFiles } from '../../shared/animation/compile';
import { parseAnimation } from '../../shared/animation/schema';
import { analyzeTemplateCode, TemplateCodeError } from '../../shared/template-code';
import { TEMPLATE_API_DTS_NAME, TEMPLATE_JSCONFIG_NAME, templateJsconfigText } from '../../shared/template-dev';
import type { CreateFromAnimationResult, ReadSourceResult, TemplateDevChange, TemplateDevResult, WriteSourceRequest, WriteSourceResult } from '../../shared/templates';
import type { Logger } from '../logger';
import { hashTemplateDir, type TemplateWatcher } from './dev-watcher';
import { readImageFile, type TemplateService } from './service';
import type { TemplateEntry } from '../../shared/templates';

export interface TemplateDevServiceOptions {
  templates: TemplateService;
  watcher: TemplateWatcher;
  /** pnpm templates:api 生成的 template-api.d.ts 的内容 */
  templateApiDts: string;
  /**
   * 在系统文件管理器里打开一个文件夹（Electron 的 shell.openPath）。只会传入模板的文件夹，
   * 绝不传 .js 文件：Windows 上对 .js 调用 openPath 可能交给 Windows Script Host 执行。
   */
  openFolder(dir: string): Promise<string>;
  log: Logger;
}

/** 内置模板 id 的最后一段（allay.builtin.block-wipe → block-wipe） */
function slugOf(id: string): string {
  return (id.split('.').at(-1) ?? 'template').replace(/[^a-z0-9-]+/g, '-').slice(0, 40) || 'template';
}

/**
 * 给从内置模板复制出来的 template.js（esbuild 的产物）的默认导出加上类型注解，外部编辑器据此补全 ctx。
 * 认不出产物的形状时原样返回（只是少了补全）。
 */
export function annotateBundledTemplate(code: string): string {
  const exported = /export\s*\{\s*(\w+) as default\s*\}/.exec(code)?.[1];
  if (!exported) return code;
  // esbuild 常见的形状：var template = {...}; var index_default = template; export { index_default as default };
  const alias = new RegExp(`^var ${exported} = (\\w+);$`, 'm').exec(code)?.[1] ?? exported;
  const decl = new RegExp(`^var ${alias} = \\{$`, 'm').exec(code);
  if (!decl) return code;
  const note = "/** @type {import('./template-api').TemplateModule} */\n";
  return code.slice(0, decl.index) + note + code.slice(decl.index);
}

/** 先写临时文件再改名 */
async function writeFileAtomic(file: string, text: string): Promise<void> {
  const tmp = join(file, '..', `.${randomBytes(6).toString('hex')}.tmp`);
  try {
    await writeFile(tmp, text, 'utf8');
    await rename(tmp, file);
  } catch (error) {
    await rm(tmp, { force: true });
    throw error;
  }
}

export class TemplateDevService {
  private readonly listeners = new Set<(event: TemplateDevChange) => void>();
  private unsubscribe: (() => void) | null = null;

  constructor(private readonly opts: TemplateDevServiceOptions) {}

  /** 开始监视；模板服务对用户目录的写入从此不触发事件 */
  async start(): Promise<void> {
    const { watcher, templates } = this.opts;
    templates.setWriteGuard((id, version, fn) => watcher.ownWrite(id, version, fn));
    this.unsubscribe = watcher.onChange((event) => void this.forward(event));
    await watcher.start();
  }

  close(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.opts.templates.setWriteGuard(null);
    this.opts.watcher.close();
    this.listeners.clear();
  }

  /** 订阅外部改动（模板服务已按新内容刷新过）；返回取消订阅的函数 */
  onChange(listener: (event: TemplateDevChange) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /** 把内置模板复制成可编辑的用户模板，并写好类型定义和 jsconfig.json */
  async copyBuiltin(req: { id: string; version: string; name?: string | undefined }): Promise<TemplateDevResult<{ entry: TemplateEntry }>> {
    // 新 id：user.<6 位随机十六进制>.<原 id 的最后一段>，与“另存为模板”一致；不会以 allay. 开头
    const id = `user.${randomBytes(3).toString('hex')}.${slugOf(req.id)}`;
    const copied = await this.opts.templates.copyBuiltin({ id: req.id, version: req.version }, { id, ...(req.name ? { name: req.name } : {}) }, annotateBundledTemplate);
    if (!copied.ok) return copied;
    const written = await this.writeDevFiles({ id: copied.entry.id, version: copied.entry.version });
    if (!written.ok) return written;
    return { ok: true, entry: copied.entry };
  }

  /** 往用户模板的文件夹写 template-api.d.ts 和 jsconfig.json（覆盖旧的） */
  async writeDevFiles(req: { id: string; version: string }): Promise<TemplateDevResult> {
    const dir = await this.userDir(req.id, req.version);
    if (!dir.ok) return dir;
    await this.opts.watcher.ownWrite(req.id, req.version, async () => {
      await writeFileAtomic(join(dir.path, TEMPLATE_API_DTS_NAME), this.opts.templateApiDts);
      await writeFileAtomic(join(dir.path, TEMPLATE_JSCONFIG_NAME), templateJsconfigText());
    });
    return { ok: true };
  }

  /** 在系统文件管理器里打开用户模板的文件夹（只开文件夹，不开任何文件） */
  async openFolder(req: { id: string; version: string }): Promise<TemplateDevResult> {
    const dir = await this.userDir(req.id, req.version);
    if (!dir.ok) return dir;
    const error = await this.opts.openFolder(dir.path);
    if (error) {
      this.opts.log.warn('templates', 'could not open template folder', { id: req.id, version: req.version, error });
      return { ok: false, error: 'open-failed' };
    }
    return { ok: true };
  }

  // ---- 2026-11：内嵌代码编辑与自建动画 ----

  /**
   * 读 template.js 和内容版本。用户模板的版本是文件夹的内容哈希（与监视事件的 hash 相同）；
   * 内置模板只读，版本是 builtin:<id>@<版本>。派生模板没有自己的代码（not-script）。
   */
  async readSource(req: { id: string; version: string }): Promise<ReadSourceResult> {
    const entry = this.opts.templates.list().find((e) => e.id === req.id && e.version === req.version);
    if (!entry) return { ok: false, error: 'not-found' };
    if (entry.kind !== 'script') return { ok: false, error: 'not-script' };
    if (entry.source === 'builtin') {
      const bundle = await this.opts.templates.read(req.id, req.version);
      if (!bundle) return { ok: false, error: 'not-found' };
      return { ok: true, source: bundle.code, version: `builtin:${req.id}@${req.version}`, readOnly: true };
    }
    const dir = await this.userDir(req.id, req.version);
    if (!dir.ok) return { ok: false, error: dir.error === 'outside' ? 'outside' : 'not-found' };
    const [source, version] = await Promise.all([readFile(join(dir.path, 'template.js'), 'utf8').catch(() => null), hashTemplateDir(dir.path)]);
    if (source === null || version === null) return { ok: false, error: 'not-found' };
    return { ok: true, source, version, readOnly: false };
  }

  /**
   * 写用户模板的 template.js。baseVersion 必须是当前的内容哈希（期间被外部改过就是 conflict，不覆盖）；
   * 语法错误、含 import 的拒绝（invalid，带诊断）；确定性规则的命中照写（热重载会拦下并在浮层里显示，和外部编辑器一样）。
   * 不包在 ownWrite 里：监视服务照常发现这次改动、通知界面热重载。
   */
  async writeSource(req: WriteSourceRequest): Promise<WriteSourceResult> {
    const dir = await this.userDir(req.id, req.version);
    if (!dir.ok) return { ok: false, error: 'not-user' };
    try {
      await analyzeTemplateCode(req.source);
    } catch (error) {
      if (error instanceof TemplateCodeError) return { ok: false, error: 'invalid', diagnostic: error.diagnostic };
      throw error;
    }
    const current = await hashTemplateDir(dir.path);
    if (current === null) return { ok: false, error: 'not-user' };
    if (current !== req.baseVersion) return { ok: false, error: 'conflict', currentVersion: current };
    try {
      await writeFileAtomic(join(dir.path, 'template.js'), req.source);
    } catch (error) {
      this.opts.log.warn('templates', 'could not write template source', { id: req.id, version: req.version, error: String(error) });
      return { ok: false, error: 'io' };
    }
    const version = await hashTemplateDir(dir.path);
    return version ? { ok: true, version } : { ok: false, error: 'io' };
  }

  /**
   * 自建动画转为模板：主进程自己解析和校验动画文档、生成 manifest.json、template.js、animation.json，
   * 新 id 是 user.<6 位随机十六进制>.<名字>，版本 1.0.0。再写好类型定义，方便之后用外部编辑器改。
   */
  async createFromAnimation(text: string, resolveFile: (ref: string) => string | null = () => null): Promise<CreateFromAnimationResult> {
    const parsed = parseAnimation(text);
    if (!parsed.ok) return { ok: false, error: 'invalid', detail: parsed.issues.map((i) => `${i.path}: ${i.message}`).join('; ').slice(0, 2000) };
    // 图片图层的本机图片（file: 引用只在这次运行有效）：读出来复制进模板的 assets/，文档里换成 asset: 引用（同派生模板，4.7）
    const assets: { name: string; bytes: Uint8Array }[] = [];
    for (const l of parsed.doc.layers) {
      if (l.type !== 'image' || typeof l.image !== 'string') continue;
      const m = /^file:([0-9a-fA-F-]{36})$/.exec(l.image);
      if (!m) continue;
      const path = resolveFile(m[1]!);
      const image = path ? await readImageFile(path) : null;
      if (!image) return { ok: false, error: 'invalid', detail: `layer "${l.name}": the image cannot be read` };
      const name = `image-${l.id}.${image.ext}`;
      assets.push({ name, bytes: image.bytes });
      l.image = `asset:${name}`;
    }
    const slug = parsed.doc.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'animation';
    const ref = { id: `user.${randomBytes(3).toString('hex')}.${slug}`, version: '1.0.0' };
    const files = animationTemplateFiles(parsed.doc, ref);
    try {
      await analyzeTemplateCode(files['template.js']);
    } catch (error) {
      return { ok: false, error: 'invalid', detail: error instanceof Error ? error.message.slice(0, 2000) : 'invalid code' };
    }
    const created = await this.opts.templates.createUser(files, assets);
    if (!created.ok) return { ok: false, error: created.error === 'bad-id' ? 'io' : 'invalid', ...(created.detail ? { detail: created.detail } : {}) };
    const dev = await this.writeDevFiles(ref);
    if (!dev.ok) this.opts.log.warn('templates', 'could not write dev files for animation template', { id: ref.id, error: dev.error });
    return created;
  }

  // ---- 内部 ----

  /** 用户模板的文件夹：必须是已知的用户模板，真实路径在用户模板目录之内 */
  private async userDir(id: string, version: string): Promise<{ ok: true; path: string } | { ok: false; error: 'not-user' | 'outside' }> {
    if (!this.opts.templates.userTemplateDir(id, version)) return { ok: false, error: 'not-user' };
    const path = await this.opts.watcher.resolveDir(id, version);
    if (!path) return { ok: false, error: 'outside' };
    return { ok: true, path };
  }

  private async forward(event: { id: string; version: string; change: TemplateDevChange['change']; hash: string | null }): Promise<void> {
    let entry: TemplateEntry | null = null;
    try {
      entry = await this.opts.templates.refreshUser(event.id, event.version);
    } catch (error) {
      this.opts.log.warn('templates', 'refresh after external change failed', { id: event.id, version: event.version, error: String(error) });
    }
    const out: TemplateDevChange = { ...event, valid: entry !== null };
    for (const l of this.listeners) {
      try {
        l(out);
      } catch (error) {
        this.opts.log.warn('templates', 'template change listener failed', { error: String(error) });
      }
    }
  }
}
