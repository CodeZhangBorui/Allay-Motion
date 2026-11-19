// 工程文件的读写（docs/01-product-architecture.md 1.9）与最近的工程。
// 路径只在主进程：渲染进程拿到的是句柄（打开、保存过的工程）和最近工程的 id。路径的来源只有主进程的对话框
// 和这里记下的最近工程列表（它本身也只来自对话框选过的路径）。
import { randomUUID } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import { basename, dirname, extname, join } from 'node:path';
import {
  MAX_PROJECT_BYTES,
  MAX_RECENTS,
  PROJECT_FORMAT_VERSION,
  ProjectFileSchema,
  type ProjectData,
  type ProjectOpenResult,
  type ProjectSaveResult,
  type RecentProject,
} from '../../shared/project';
import type { FileGrants } from '../file-grants';
import type { Logger } from '../logger';
import { writeJsonAtomic } from '../settings-store';
import { z } from 'zod';

type Json = ProjectData['params'][string];

const FILE_REF = /^file:([0-9a-fA-F-]{36})$/;

const RecentsFileSchema = z.object({
  formatVersion: z.literal(1),
  items: z.array(z.strictObject({ path: z.string().min(1).max(4096), name: z.string().max(200), at: z.string().max(64) })).max(MAX_RECENTS).catch([]),
});

export interface ProjectServiceOptions {
  userDataDir: string;
  appVersion: string;
  grants: FileGrants;
  log: Logger;
}

export class ProjectService {
  /** 句柄 → 路径 */
  private readonly handles = new Map<string, string>();
  private recentsList: { path: string; name: string; at: string }[] = [];
  /** 最近工程的路径 → 这次运行里的 id */
  private readonly recentIds = new Map<string, string>();
  private loaded: Promise<void> | null = null;
  private queue: Promise<unknown> = Promise.resolve();

  constructor(private readonly opts: ProjectServiceOptions) {}

  private get recentsFile(): string {
    return join(this.opts.userDataDir, 'recents.json');
  }

  private load(): Promise<void> {
    this.loaded ??= (async () => {
      try {
        const raw: unknown = JSON.parse(await readFile(this.recentsFile, 'utf8'));
        const parsed = RecentsFileSchema.safeParse(raw);
        this.recentsList = parsed.success ? parsed.data.items : [];
      } catch {
        this.recentsList = [];
      }
    })();
    return this.loaded;
  }

  private serial<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.queue.then(fn, fn);
    this.queue = run.catch(() => undefined);
    return run;
  }

  private idFor(path: string): string {
    let id = this.recentIds.get(path);
    if (!id) {
      id = randomUUID();
      this.recentIds.set(path, id);
    }
    return id;
  }

  private async remember(path: string): Promise<void> {
    await this.load();
    const name = basename(path, extname(path));
    this.recentsList = [{ path, name, at: new Date().toISOString() }, ...this.recentsList.filter((r) => r.path !== path)].slice(0, MAX_RECENTS);
    await writeJsonAtomic(this.recentsFile, { formatVersion: 1, items: this.recentsList }).catch((error: unknown) => this.opts.log.warn('project', 'failed to write recents', { error }));
  }

  private register(path: string): string {
    for (const [h, p] of this.handles) if (p === path) return h;
    const handle = randomUUID();
    this.handles.set(handle, path);
    return handle;
  }

  async recents(): Promise<RecentProject[]> {
    await this.load();
    return this.recentsList.map((r) => ({ id: this.idFor(r.path), name: r.name, folder: dirname(r.path) }));
  }

  /** 打开一个路径（来自主进程的对话框或最近工程列表） */
  async openPath(path: string): Promise<ProjectOpenResult> {
    let bytes: Buffer;
    try {
      const info = await stat(path);
      if (!info.isFile()) return { ok: false, error: 'missing' };
      if (info.size > MAX_PROJECT_BYTES) return { ok: false, error: 'too-large' };
      bytes = await readFile(path);
    } catch {
      return { ok: false, error: 'missing' };
    }
    let raw: unknown;
    try {
      raw = JSON.parse(bytes.toString('utf8'));
    } catch {
      return { ok: false, error: 'unreadable' };
    }
    if (raw && typeof raw === 'object' && typeof (raw as { formatVersion?: unknown }).formatVersion === 'number' && (raw as { formatVersion: number }).formatVersion > PROJECT_FORMAT_VERSION) {
      return { ok: false, error: 'too-new' };
    }
    const parsed = ProjectFileSchema.safeParse(raw);
    if (!parsed.success) return { ok: false, error: 'invalid' };
    const file = parsed.data;
    const params: Record<string, Json> = { ...file.params };
    const missingFiles: string[] = [];
    // files：texture 参数的本机图片。还在的签发新的引用，丢了的回到默认值并提示（1.9）
    for (const [key, p] of Object.entries(file.files)) {
      delete params[key];
      try {
        const info = await stat(p);
        if (!info.isFile()) throw new Error('not a file');
        params[key] = `file:${this.opts.grants.grant(p)}`;
      } catch {
        missingFiles.push(key);
      }
    }
    const name = basename(path, extname(path));
    const handle = this.register(path);
    await this.remember(path);
    const data: ProjectData = {
      name: file.name || name,
      template: file.template,
      params,
      output: file.output,
      export: file.export,
      preview: file.preview,
      audio: file.audio,
      resourceHint: file.resourceHint,
      ...(file.animation ? { animation: file.animation } : {}),
    };
    return { ok: true, handle, name, data, missingFiles };
  }

  openRecent(id: string): Promise<ProjectOpenResult> {
    return this.serial(async () => {
      await this.load();
      const entry = this.recentsList.find((r) => this.recentIds.get(r.path) === id);
      if (!entry) return { ok: false, error: 'missing' } as const;
      const result = await this.openPath(entry.path);
      // 打不开的从列表里去掉
      if (!result.canceled && !result.ok && result.error === 'missing') {
        this.recentsList = this.recentsList.filter((r) => r.path !== entry.path);
        await writeJsonAtomic(this.recentsFile, { formatVersion: 1, items: this.recentsList }).catch(() => undefined);
      }
      return result;
    });
  }

  /** 已有句柄的工程保存到原处；句柄未知时由调用方转为“另存为” */
  pathOf(handle: string): string | null {
    return this.handles.get(handle) ?? null;
  }

  /** 写到一个路径（来自主进程的保存对话框或已有句柄） */
  saveTo(path: string, data: ProjectData): Promise<ProjectSaveResult> {
    return this.serial(async () => {
      const params: Record<string, Json> = {};
      const files: Record<string, string> = {};
      for (const [key, value] of Object.entries(data.params)) {
        const m = typeof value === 'string' ? FILE_REF.exec(value) : null;
        if (!m) {
          params[key] = value;
          continue;
        }
        // file: 引用换成本机路径；引用无效（不是这次运行签发的）就不存，打开时回到默认值
        const p = this.opts.grants.resolve(m[1]!);
        if (p) files[key] = p;
      }
      const file = {
        formatVersion: PROJECT_FORMAT_VERSION,
        appVersion: this.opts.appVersion,
        name: data.name,
        template: data.template,
        params,
        output: data.output,
        export: data.export,
        preview: data.preview,
        ...(data.audio ? { audio: data.audio } : {}),
        files,
        resourceHint: data.resourceHint,
        // 自建动画（docs/animation-editor.md 3.3）：旧工程没有这一项
        ...(data.animation ? { animation: data.animation } : {}),
      };
      try {
        await writeJsonAtomic(path, file);
      } catch (error) {
        this.opts.log.warn('project', 'save failed', { error });
        return { ok: false, error: 'not-writable' } as const;
      }
      const handle = this.register(path);
      await this.remember(path);
      return { ok: true, handle, name: basename(path, extname(path)) } as const;
    });
  }
}
