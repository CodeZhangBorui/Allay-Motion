// 宿主接口（docs/code-editing-and-mcp-plan.md 3.3）：主程序给可选模块（packages/optional/*：内嵌编辑器、MCP）的唯一入口。
// 只有类型，没有运行时代码；可选模块只能引用这个包（eslint.config.js 的依赖方向规则，T-DEV-4）。
//
// 这是草案，按现有代码能支撑的程度落地。实现在渲染进程的 app/editorHost.ts（MD-b），每个成员的注释里写了现状：
// - 「已实现」：可选模块调用时可用；
// - 「未实现」：主程序还没有对应的能力，调用时以 HostUnsupportedError 拒绝（不假装成功）。
// 可选模块：packages/optional/code-editor（2026-11）；接入点（按目录的惰性发现、开关表）见 app/optionalModules.ts。
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

// ---- 2026-11 反馈新增（docs/decisions.md“2026-11 反馈：开发模式、代码编辑与动画编辑器”）：只加不改 ----

/** 当前模板的概况（内嵌编辑器据此决定显示什么、能不能写） */
export interface CurrentTemplate extends TemplateId {
  /** 按界面语言取好的名字 */
  name: string;
  /** builtin 只读；user 可写；animation 是自建动画（代码由动画文档生成，改动画而不是代码） */
  source: 'builtin' | 'user' | 'animation';
}

/** 代码视图里的一条诊断（行列从 1 开始；没有位置的放在第 1 行） */
export interface CodeViewDiagnostic {
  severity: 'error' | 'warning' | 'info';
  message: string;
  line?: number;
  column?: number;
}

export interface CodeViewOptions {
  language: 'javascript' | 'json';
  value: string;
  readOnly?: boolean;
  /** 无障碍名称 */
  label: string;
  /** 用户改了文本（每次输入都调用；调用方自己防抖） */
  onChange?(value: string): void;
  /** 用户按了保存（Ctrl+S） */
  onSave?(value: string): void;
  /**
   * 给了这两个时，编辑器的撤销、重做（Ctrl+Z、Ctrl+Shift+Z、Ctrl+Y）交给宿主的历史，编辑器自己不记（2026-11 第二轮：
   * 代码窗口和主窗口共用一份撤销历史）
   */
  onUndo?(): void;
  onRedo?(): void;
  /** 用户点了文本里的某处（偏移量，UTF-16 码元）。代码窗口据此让主窗口跳到它生效的时刻 */
  onPick?(offset: number): void;
}

/** 代码视图里标出的一段（实时预览：这一刻在生效的代码），行从 1 开始，endLine 含 */
export interface CodeViewMark {
  kind: 'layer' | 'segment' | 'hold' | 'edge';
  line: number;
  endLine: number;
  label: string;
}

export interface CodeViewHandle extends Disposable {
  /** 从外面换文本（不触发 onChange） */
  setValue(value: string): void;
  setReadOnly(readOnly: boolean): void;
  setDiagnostics(diagnostics: readonly CodeViewDiagnostic[]): void;
  focus(): void;
  /** 标出几段代码；reveal 时把第一段滚进视野（2026-11 第二轮：实时预览）。旧的提供者可以不实现 */
  setMarks?(marks: readonly CodeViewMark[], reveal: boolean): void;
}

/** 把一个代码编辑器画进容器（容器实际是 HTMLElement，见 PanelContribution.mount） */
export type CodeViewProvider = (container: object, options: CodeViewOptions) => CodeViewHandle;

export interface EditorHost {
  templates: {
    /**
     * 读模板的源码和内容版本（版本是模板文件夹的内容哈希，与 onExternalChange 的 version 相同）。
     * 已实现（2026-11）：内置模板也能读（只读，版本是 builtin:<id>@<版本>），找不到时 reject
     */
    read(id: TemplateId): Promise<{ source: string; version: string }>;
    /**
     * 写用户模板的 template.js；baseVersion 不是当前版本时返回 conflict，内置模板返回 not-user，
     * 语法错误或含 import 返回 invalid。写成功后监视服务照常发现改动、走热重载。已实现（2026-11）
     */
    write(id: TemplateId, source: string, baseVersion: string): Promise<WriteResult>;
    /** 当前模板；没有时为 null。已实现（2026-11） */
    current(): CurrentTemplate | null;
    /** 当前模板变了（换模板、热重载）。已实现（2026-11） */
    onCurrentChange(cb: (current: CurrentTemplate | null) => void): Disposable;
    /**
     * 文件在应用之外被改动时回调，参数是新的内容版本。
     * 已实现：主进程的监视服务和 templates:changed 事件（hash 就是这里的 version；removed 不回调）。
     */
    onExternalChange(id: TemplateId, cb: (version: string) => void): Disposable;
  };
  engine: {
    /**
     * 模板热重载的诊断。已实现：每次热重载完成时推送（成功时是空数组，失败时是原因）。
     */
    onDiagnostics(id: TemplateId, cb: (d: TemplateDiagnostic[]) => void): Disposable;
    /** 不落盘的试载（H9）：只能是当前模板；通过就把预览切到这份代码。已实现 */
    requestReload(id: TemplateId, source: string): Promise<ReloadResult>;
    /** 静态检查（语法、import、确定性规则 H12），不装载、不运行。已实现（2026-11） */
    lint(source: string): Promise<TemplateDiagnostic[]>;
  };
  /** 命令层（H2）：执行一个已注册的命令（参数按命令自己的 schema 校验）。已实现（2026-11） */
  commands: {
    dispatch(id: string, input?: unknown): Promise<unknown>;
  };
  playhead: {
    /** 当前时刻（秒）。已实现 */
    get(): number;
    subscribe(cb: (t: number) => void): Disposable;
  };
  domain: {
    /** 方块目录里的全部方块 ID。已实现 */
    blockIds(): readonly string[];
    /** 缓动的预设名。已实现（SdkApiDoc.easings） */
    easings(): readonly string[];
    /** 模板接口的说明。已实现（pnpm templates:api 生成的 template-api.json） */
    sdkApi(): SdkApiDoc;
  };
  ui: {
    /** 已实现（界面注册表 H1）。id、titleKey 必须以“<模块 id>.”开头；bottom 放在主区可停靠的位置 */
    registerPanel(p: PanelContribution): Disposable;
    /** 已实现（命令层 H2，经同一个 dispatch）。id、titleKey 必须以“<模块 id>.”开头 */
    registerCommand(c: CommandContribution): Disposable;
    /** 注册模块自己的文案；两种语言都要给。键必须以“<模块 id>.”开头。已实现 */
    registerMessages(locale: HostLocale, m: Record<string, string>): Disposable;
    /** 提供代码视图（主程序里显示、编辑代码的地方用它；同一时间只有一个提供者）。已实现（2026-11） */
    registerCodeView(provider: CodeViewProvider): Disposable;
    /** 按当前界面语言取文案（模块自己注册的键，或主程序的键）。已实现（2026-11） */
    t(key: string): string;
    /** 界面语言变了。已实现（2026-11） */
    onLocaleChange(cb: () => void): Disposable;
  };
}

/** 可选模块的入口：packages/optional/<名字>/src/index.ts 只导出它 */
export interface OptionalModule {
  /** 与目录名相同 */
  id: string;
  activate(host: EditorHost): Disposable;
}
