// 宿主接口（docs/code-editing-and-mcp-plan.md 3.3）：主程序给可选模块（packages/optional/*：内嵌编辑器、MCP）的唯一入口。
// 只有类型，没有运行时代码；可选模块只能引用这个包（eslint.config.js 的依赖方向规则，T-DEV-4）。
//
// 这是草案，按 MD-a 时现有代码能支撑的程度落地。每个成员的注释里写了现状：
// - 「已有」：主程序里已经有对应的实现，接线时直接包一层；
// - 「MD-b」：要等界面接线（热重载管线、命令层、注册表）做完才有实现。
// 现在没有任何可选模块，也没有任何代码实现 EditorHost。
import type { TemplateDiagnostic } from '@allay/template-sdk';

export type { TemplateDiagnostic };

export interface Disposable {
  dispose(): void;
}

/** 一个模板的一个版本 */
export interface TemplateId {
  id: string;
  version: string;
}

/**
 * 写模板源码的结果。baseVersion 是读的时候拿到的内容版本（内容哈希）；
 * 文件在这之后被外部改过时返回 conflict，带上当前的版本，由调用方决定怎么合并。
 */
export type WriteResult =
  | { ok: true; version: string }
  | { ok: false; error: 'conflict'; currentVersion: string }
  | { ok: false; error: 'not-user' | 'invalid' | 'io' };

/** 不落盘的试载：在备用 Worker 里装载并试渲当前帧（H9） */
export type ReloadResult =
  | { ok: true; duration: number; cutTime: number | null; diagnostics: TemplateDiagnostic[] }
  | { ok: false; diagnostics: TemplateDiagnostic[] };

// ---- 模板接口的说明（pnpm templates:api 生成的 template-api.json 就是这个形状）----

export interface SdkApiMember {
  name: string;
  kind: 'property' | 'method';
  optional: boolean;
  /** 成员声明的原文（不含注释）；对象字面量类型的成员写成 `name: { … };`，成员另列在 members 里 */
  signature: string;
  /** 说明 */
  doc: string;
  members?: SdkApiMember[];
}

export interface SdkApiDoc {
  formatVersion: 1;
  /** 生成自哪个文件 */
  source: string;
  /** SetupContext（模板拿到的 ctx）的成员 */
  ctx: SdkApiMember[];
  /** 其他接口（Rng、BlockHandle 等）的成员 */
  types: Record<string, { doc: string; members: SdkApiMember[] }>;
  /** 类型别名的原文（EasingName 等） */
  aliases: Record<string, { doc: string; text: string }>;
  /** 缓动的预设名 */
  easings: string[];
}

// ---- 界面贡献（H1 的注册表；MD-b）----

export type HostLocale = 'zh-CN' | 'en';

export interface PanelContribution {
  id: string;
  /** 文案键（经 registerMessages 注册） */
  titleKey: string;
  location: 'left' | 'right' | 'bottom';
  /**
   * 把面板画进宿主给的容器。容器实际是 HTMLElement；host-api 不依赖 DOM 的类型，这里写成 object。
   * 返回的 Disposable 在面板关闭或模块停用时调用。
   */
  mount(container: object): Disposable;
}

/** 带类型的命令（H2）。界面按钮、快捷键、命令面板、将来的 MCP 调的是同一套命令 */
export interface CommandContribution {
  id: string;
  titleKey: string;
  effect: 'read' | 'write' | 'destructive';
  /** 写操作在撤销历史里的标签（H6） */
  undoLabelKey?: string;
  /** 入参由命令层按命令自己的 schema 校验之后才交进来 */
  run(input: unknown): unknown;
}

export interface EditorHost {
  templates: {
    /** 读用户模板的源码和内容版本。MD-b（主进程已能按 id 和版本定位用户模板的文件夹） */
    read(id: TemplateId): Promise<{ source: string; version: string }>;
    /** 写源码；baseVersion 不是当前版本时返回 conflict。MD-b */
    write(id: TemplateId, source: string, baseVersion: string): Promise<WriteResult>;
    /**
     * 文件在应用之外被改动时回调，参数是新的内容版本。
     * 已有：主进程的监视服务和 templates:changed 事件（window.allay.templates.onChanged，hash 就是这里的 version）。
     */
    onExternalChange(id: TemplateId, cb: (version: string) => void): Disposable;
  };
  engine: {
    /**
     * 模板装载、渲染的诊断。诊断的数据（TemplateDiagnostic）已有：引擎和宿主的错误都带它，装载结果带规则提示；
     * 推送给订阅者的通路随热重载管线在 MD-b 做。
     */
    onDiagnostics(id: TemplateId, cb: (d: TemplateDiagnostic[]) => void): Disposable;
    /** 不落盘的试载（H9）。MD-b */
    requestReload(id: TemplateId, source: string): Promise<ReloadResult>;
  };
  playhead: {
    /** 当前时刻（秒）。MD-b（transportStore 已有，没有对外的读口） */
    get(): number;
    subscribe(cb: (t: number) => void): Disposable;
  };
  domain: {
    /** 方块目录里的全部方块 ID。MD-b（@allay/assets 的目录已有） */
    blockIds(): readonly string[];
    /** 缓动的预设名。已有：SdkApiDoc.easings */
    easings(): readonly string[];
    /** 模板接口的说明。已有：pnpm templates:api 生成的 template-api.json */
    sdkApi(): SdkApiDoc;
  };
  ui: {
    /** MD-b（界面注册表 H1） */
    registerPanel(p: PanelContribution): Disposable;
    /** MD-b（命令层 H2） */
    registerCommand(c: CommandContribution): Disposable;
    /** 注册模块自己的文案；两种语言都要给 */
    registerMessages(locale: HostLocale, m: Record<string, string>): Disposable;
  };
}

/** 可选模块的入口：packages/optional/<名字>/src/index.ts 只导出它 */
export interface OptionalModule {
  /** 与目录名相同 */
  id: string;
  activate(host: EditorHost): Disposable;
}
