// 可选模块的惰性发现与启停（docs/code-editing-and-mcp-plan.md 3.1、3.2）。
// 按目录发现 packages/optional/*/src/index.ts：Vite 在构建时把每个模块打成单独的惰性代码块，目录为空或不存在时是空表。
// 主程序不认识任何具体的模块：只有设置里通用的 optionalModules 开关表（模块目录名 → 是否启用），默认全关；
// 关着的模块不加载它的代码块。模块入口导出 activate(host)（或默认导出 { id, activate }），返回 Disposable。
import type { Disposable, EditorHost, OptionalModule } from '@allay/host-api';

export interface ModuleExports {
  activate?: OptionalModule['activate'];
  default?: Partial<OptionalModule>;
}

export type ModuleLoader = () => Promise<ModuleExports>;

/** 一个启用中的模块拿到的宿主：停用时由这里注销它注册过的一切 */
export interface ActiveHost extends EditorHost {
  disposeAll(): void;
}

const ID_RE = /^[a-z][a-z0-9-]{0,31}$/;

/** import.meta.glob 的结果按目录名整理成表（路径形如 …/packages/optional/<id>/src/index.ts） */
export function modulesFromGlob(glob: Record<string, ModuleLoader>): Record<string, ModuleLoader> {
  const out: Record<string, ModuleLoader> = {};
  for (const [path, load] of Object.entries(glob)) {
    const m = /\/([^/]+)\/src\/index\.ts$/.exec(path);
    if (m && ID_RE.test(m[1]!)) out[m[1]!] = load;
  }
  return out;
}

/** 这次构建里发现的可选模块（目录名 → 惰性加载函数）。现在 packages/optional 下没有模块，这是空表 */
export function discoveredModules(): Record<string, ModuleLoader> {
  return modulesFromGlob(import.meta.glob<ModuleExports>('../../../../../packages/optional/*/src/index.ts'));
}

interface Active {
  host: ActiveHost;
  handle: Disposable;
}

export class OptionalModuleManager {
  private readonly active = new Map<string, Active>();
  /** 启用失败的模块和原因（诊断用；再次启用成功时清掉） */
  readonly failures = new Map<string, string>();
  private chain: Promise<void> = Promise.resolve();

  constructor(
    private readonly loaders: Record<string, ModuleLoader>,
    private readonly createHost: (id: string) => Promise<ActiveHost>,
    private readonly log: (message: string, error?: unknown) => void = (m, e) => console.warn(`[optional] ${m}`, e ?? ''),
  ) {}

  /** 发现了哪些模块 */
  get available(): string[] {
    return Object.keys(this.loaders).sort();
  }

  /** 启用中的模块 */
  get activeIds(): string[] {
    return [...this.active.keys()].sort();
  }

  /** 按开关表启停：开着的、发现了的、还没启用的加载并 activate；关掉的 dispose。依次执行 */
  sync(switches: Readonly<Record<string, boolean>>): Promise<void> {
    this.chain = this.chain.then(() => this.apply(switches)).catch((error: unknown) => this.log('sync failed', error));
    return this.chain;
  }

  private async apply(switches: Readonly<Record<string, boolean>>): Promise<void> {
    for (const [id, a] of [...this.active]) {
      if (switches[id] === true) continue;
      this.active.delete(id);
      this.stop(id, a);
    }
    for (const [id, load] of Object.entries(this.loaders)) {
      if (switches[id] !== true || this.active.has(id)) continue;
      await this.start(id, load);
    }
  }

  private async start(id: string, load: ModuleLoader): Promise<void> {
    let host: ActiveHost | null = null;
    try {
      const mod = await load();
      const activate = mod.activate ?? mod.default?.activate;
      if (typeof activate !== 'function') throw new Error('module does not export activate(host)');
      host = await this.createHost(id);
      const handle = activate(host);
      if (!handle || typeof handle.dispose !== 'function') throw new Error('activate(host) must return a Disposable');
      this.active.set(id, { host, handle });
      this.failures.delete(id);
    } catch (error) {
      this.failures.set(id, error instanceof Error ? `${error.name}: ${error.message}` : String(error));
      // 一个模块坏了不连累主程序：已经注册的东西撤掉，记日志
      host?.disposeAll();
      this.log(`module ${id} failed to activate`, error);
    }
  }

  private stop(id: string, a: Active): void {
    try {
      a.handle.dispose();
    } catch (error) {
      this.log(`module ${id} failed to dispose`, error);
    }
    a.host.disposeAll();
  }
}
