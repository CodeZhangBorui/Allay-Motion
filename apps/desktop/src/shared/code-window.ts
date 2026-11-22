// 代码窗口与外部编辑器（docs/animation-editor.md 6.11；docs/decisions.md“动画编辑器的第二轮反馈”）。
// 代码窗口是第二个 BrowserWindow，和主窗口用同一份安全设置（1.6）；两个窗口之间不直接通信，
// 消息都经主进程转发，两端各按这里的 schema 校验。动画文档的唯一主人仍是主窗口的工程状态：
// 代码窗口只显示文本、交回编辑（经主窗口的命令层，进同一份撤销历史）。
import { z } from 'zod';
import { MAX_ANIMATION_CHARS } from './animation/schema';

const Issue = z.strictObject({ message: z.string().max(2000), path: z.string().max(500), line: z.int().min(1).optional(), column: z.int().min(1).optional() });

/** 主窗口 → 代码窗口 */
export const CodeWindowDownSchema = z.discriminatedUnion('type', [
  /** 整份状态：文档原文、解析问题、界面语言和主题、标题。没有动画时 text 为 null */
  z.strictObject({
    type: z.literal('state'),
    text: z.string().max(MAX_ANIMATION_CHARS).nullable(),
    issues: z.array(Issue).max(20),
    revision: z.int().min(0),
    title: z.string().max(200),
    theme: z.enum(['dark', 'light']),
    language: z.enum(['zh-CN', 'en']),
    reducedMotion: z.boolean(),
  }),
  /** 播放头（实时预览开着时才发） */
  z.strictObject({ type: z.literal('time'), t: z.number().min(0).max(30), playing: z.boolean() }),
]);
export type CodeWindowDown = z.infer<typeof CodeWindowDownSchema>;

/** 代码窗口 → 主窗口 */
export const CodeWindowUpSchema = z.discriminatedUnion('type', [
  /** 页面就绪，要一份整状态 */
  z.strictObject({ type: z.literal('ready') }),
  /** 改了文本（代码窗口已经防抖） */
  z.strictObject({ type: z.literal('edit'), text: z.string().max(MAX_ANIMATION_CHARS), baseRevision: z.int().min(0) }),
  /** 在代码里点了某处：主窗口跳到它生效的时刻 */
  z.strictObject({ type: z.literal('seek'), t: z.number().min(0).max(30) }),
  /** 实时预览的开关：开着时主窗口推播放头 */
  z.strictObject({ type: z.literal('live'), on: z.boolean() }),
  /** 撤销、重做走主窗口的历史（与可视化编辑同一份） */
  z.strictObject({ type: z.literal('undo') }),
  z.strictObject({ type: z.literal('redo') }),
  /** 主进程发出：代码窗口关了（代码窗口自己不能发这个） */
  z.strictObject({ type: z.literal('closed') }),
]);
export type CodeWindowUp = z.infer<typeof CodeWindowUpSchema>;

/** 代码窗口的页面（app://renderer/code.html）；它能调的 IPC 通道见 main/ipc-guard.ts 的 CODE_WINDOW_CHANNELS */
export const CODE_WINDOW_PAGE = 'code.html';

// ---- 外部编辑器 ----

/** 打开动画代码用什么：应用自带的代码窗口（默认）、系统给 .json 关联的程序、用户指定的程序 */
export const CodeEditorKindSchema = z.enum(['builtin', 'system', 'custom']);
export type CodeEditorKind = z.infer<typeof CodeEditorKindSchema>;

/** 只有主进程读写（settings.json 的 editor 节）：程序路径只来自主进程的文件对话框（1.6 第 6 条） */
export const EditorAppSettingsSchema = z.object({
  /** 不认识的种类（新版本写的）读成自带的代码窗口；程序路径坏了只丢它（custom 没有程序时，打开会提示重新选） */
  kind: CodeEditorKindSchema.catch('builtin'),
  program: z.string().min(1).max(1000).nullable().catch(null),
});
export type EditorAppSettings = z.infer<typeof EditorAppSettingsSchema>;
export function defaultEditorAppSettings(): EditorAppSettings {
  return { kind: 'builtin', program: null };
}

/** 渲染进程看到的（程序只给文件名，用于显示） */
export interface EditorInfo {
  kind: CodeEditorKind;
  programName: string | null;
}

/** 动画文档文件的键：工程里动画的标识（user.<hex>.animation），主进程据此决定文件名 */
export const AnimationFileKeySchema = z.string().regex(/^user\.[0-9a-f]{6}\.animation$/);

export const OpenExternalSchema = z.strictObject({ key: AnimationFileKeySchema, text: z.string().max(MAX_ANIMATION_CHARS) });
export const SyncFileSchema = OpenExternalSchema;

export type OpenExternalResult = { ok: true } | { ok: false; error: 'no-program' | 'open-failed' | 'io' };

/** 主进程 → 主窗口：外部编辑器改了动画文件 */
export interface AnimationFileChange {
  key: string;
  text: string;
}
