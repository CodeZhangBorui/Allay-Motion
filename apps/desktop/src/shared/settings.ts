import { DEFAULT_RESOURCE_STACK_SETTINGS, ResourceStackSettingsSchema, type ResourceStackSettings } from '@allay/assets';
import { z } from 'zod';
import { H264ProbeSchema } from './export';

// 设置文件 settings.json 的 schema（docs/01-product-architecture.md 1.9）。
// 读取时每个字段单独兜底：坏掉的字段回到默认值，不连累其他字段。

export const SETTINGS_FORMAT_VERSION = 1;

export const THEMES = ['dark', 'light'] as const;
export const LANGUAGE_PREFS = ['system', 'zh-CN', 'en'] as const;
export const REDUCED_MOTION_PREFS = ['system', 'on', 'off'] as const;

export const ThemeSchema = z.enum(THEMES);
export type Theme = z.infer<typeof ThemeSchema>;
export const LanguagePrefSchema = z.enum(LANGUAGE_PREFS);
export type LanguagePref = z.infer<typeof LanguagePrefSchema>;
export const ReducedMotionPrefSchema = z.enum(REDUCED_MOTION_PREFS);

/** 侧栏宽度（px）与折叠状态。宽度范围比 6.3 的拖动范围宽松，真正的钳制由分栏组件做。 */
export const PanelStateSchema = z.strictObject({
  size: z.number().finite().min(0).max(4000),
  collapsed: z.boolean(),
});
export type PanelState = z.infer<typeof PanelStateSchema>;

export const DEFAULT_LAYOUT = {
  left: { size: 280, collapsed: false },
  right: { size: 320, collapsed: false },
} as const satisfies Record<'left' | 'right', PanelState>;

export const LayoutSchema = z.strictObject({
  left: PanelStateSchema.catch({ ...DEFAULT_LAYOUT.left }),
  right: PanelStateSchema.catch({ ...DEFAULT_LAYOUT.right }),
});

// ---- 编辑器偏好（M4）：预览背景、参考线、缩放、高质量预览、静音、分组折叠（按模板）、最近使用 ----

export const PREVIEW_BACKGROUNDS = ['checker', 'sample', 'solid'] as const;
export const PREVIEW_ZOOMS = ['fit', '100'] as const;
export const RECENT_KINDS = ['color', 'block', 'item', 'texture'] as const;
export const RECENT_MAX = 12;
export const MAX_GROUP_TEMPLATES = 200;
const HexColorSchema = z.string().regex(/^#[0-9A-Fa-f]{6}$/);
const RecentValueSchema = z.string().min(1).max(256);
/** 分组折叠状态：模板 id → 分组 key → 是否折叠。条目数有上限，防止设置文件无限长大 */
const GroupStateSchema = z
  .record(z.string().min(1).max(128), z.record(z.string().min(1).max(64), z.boolean()))
  .refine((g) => Object.keys(g).length <= MAX_GROUP_TEMPLATES, 'too many templates');
const RecentSchema = z.strictObject({
  color: z.array(RecentValueSchema).max(RECENT_MAX),
  block: z.array(RecentValueSchema).max(RECENT_MAX),
  item: z.array(RecentValueSchema).max(RECENT_MAX),
  texture: z.array(RecentValueSchema).max(RECENT_MAX),
});
export type RecentKind = (typeof RECENT_KINDS)[number];

export interface EditorPrefs {
  background: (typeof PREVIEW_BACKGROUNDS)[number];
  solidColor: string;
  guides: boolean;
  zoom: (typeof PREVIEW_ZOOMS)[number];
  hqPreview: boolean;
  muted: boolean;
  groups: Record<string, Record<string, boolean>>;
  recent: Record<RecentKind, string[]>;
}

export function defaultEditorPrefs(): EditorPrefs {
  return {
    background: 'checker',
    solidColor: '#00B140',
    guides: false,
    zoom: 'fit',
    hqPreview: false,
    muted: false,
    groups: {},
    recent: { color: [], block: [], item: [], texture: [] },
  };
}

export const EditorPrefsSchema = z.strictObject({
  background: z.enum(PREVIEW_BACKGROUNDS).catch('checker'),
  solidColor: HexColorSchema.catch('#00B140'),
  guides: z.boolean().catch(false),
  zoom: z.enum(PREVIEW_ZOOMS).catch('fit'),
  hqPreview: z.boolean().catch(false),
  muted: z.boolean().catch(false),
  groups: GroupStateSchema.catch({}),
  recent: RecentSchema.catch(() => defaultEditorPrefs().recent),
});

// ---- 可选模块的开关表（docs/code-editing-and-mcp-plan.md 3.1 第 4 条）----
// 键是 packages/optional 下的目录名；没有列出、或为 false 的模块不加载。主程序不认识任何具体的模块。

export const MAX_OPTIONAL_MODULES = 32;
export const OptionalModuleIdSchema = z.string().regex(/^[a-z][a-z0-9-]{0,31}$/);
export const OptionalModulesSchema = z
  .record(OptionalModuleIdSchema, z.boolean())
  .refine((m) => Object.keys(m).length <= MAX_OPTIONAL_MODULES, 'too many optional modules');

/** 渲染进程可见、可改的部分 */
export const UiSettingsSchema = z.strictObject({
  theme: ThemeSchema.catch('dark'),
  language: LanguagePrefSchema.catch('system'),
  reducedMotion: ReducedMotionPrefSchema.catch('system'),
  layout: LayoutSchema.catch({ left: { ...DEFAULT_LAYOUT.left }, right: { ...DEFAULT_LAYOUT.right } }),
  editor: EditorPrefsSchema.catch(defaultEditorPrefs).default(defaultEditorPrefs),
  optionalModules: OptionalModulesSchema.catch({}).default({}),
});
export type UiSettings = z.infer<typeof UiSettingsSchema>;

export function defaultUiSettings(): UiSettings {
  return {
    theme: 'dark',
    language: 'system',
    reducedMotion: 'system',
    layout: { left: { ...DEFAULT_LAYOUT.left }, right: { ...DEFAULT_LAYOUT.right } },
    editor: defaultEditorPrefs(),
    optionalModules: {},
  };
}

/** 渲染进程发来的修改：只能改 UiSettings 里的已知字段，多一个键都拒绝 */
export const UiSettingsPatchSchema = z.strictObject({
  theme: ThemeSchema.optional(),
  language: LanguagePrefSchema.optional(),
  reducedMotion: ReducedMotionPrefSchema.optional(),
  layout: z
    .strictObject({
      left: PanelStateSchema.optional(),
      right: PanelStateSchema.optional(),
    })
    .optional(),
  /** 编辑器偏好：给出的字段整体替换（groups、recent 也是整体替换） */
  editor: z
    .strictObject({
      background: z.enum(PREVIEW_BACKGROUNDS).optional(),
      solidColor: HexColorSchema.optional(),
      guides: z.boolean().optional(),
      zoom: z.enum(PREVIEW_ZOOMS).optional(),
      hqPreview: z.boolean().optional(),
      muted: z.boolean().optional(),
      groups: GroupStateSchema.optional(),
      recent: RecentSchema.optional(),
    })
    .optional(),
  /** 可选模块的开关表：整体替换 */
  optionalModules: OptionalModulesSchema.optional(),
});
export type UiSettingsPatch = z.infer<typeof UiSettingsPatchSchema>;

/** 只有主进程读写的窗口状态 */
export const WindowStateSchema = z.strictObject({
  x: z.number().int(),
  y: z.number().int(),
  width: z.number().int().min(1).max(100_000),
  height: z.number().int().min(1).max(100_000),
  maximized: z.boolean(),
});
export type WindowState = z.infer<typeof WindowStateSchema>;

export function defaultResourceSettings(): ResourceStackSettings {
  return structuredClone(DEFAULT_RESOURCE_STACK_SETTINGS);
}

/** 导出的应用级设置（M7），只有主进程读写：上次选的输出文件夹、H.264 探测结果的缓存（5.3） */
export const ExportAppSettingsSchema = z.strictObject({
  folder: z.string().min(1).max(1000).nullable(),
  h264: H264ProbeSchema.nullable(),
});
export type ExportAppSettings = z.infer<typeof ExportAppSettingsSchema>;
export function defaultExportAppSettings(): ExportAppSettings {
  return { folder: null, h264: null };
}

export const SettingsFileSchema = z.object({
  formatVersion: z.literal(SETTINGS_FORMAT_VERSION),
  ui: UiSettingsSchema.catch(defaultUiSettings),
  window: WindowStateSchema.optional().catch(undefined),
  /** 资源栈（应用级设置，1.9），只有主进程读写 */
  resources: ResourceStackSettingsSchema.catch(defaultResourceSettings).default(defaultResourceSettings),
  /** 导出（M7），只有主进程读写 */
  export: ExportAppSettingsSchema.catch(defaultExportAppSettings).default(defaultExportAppSettings),
});
export type SettingsFile = z.infer<typeof SettingsFileSchema>;

export function defaultSettingsFile(): SettingsFile {
  return { formatVersion: SETTINGS_FORMAT_VERSION, ui: defaultUiSettings(), resources: defaultResourceSettings(), export: defaultExportAppSettings() };
}

export function applyUiPatch(current: UiSettings, patch: UiSettingsPatch): UiSettings {
  return {
    theme: patch.theme ?? current.theme,
    language: patch.language ?? current.language,
    reducedMotion: patch.reducedMotion ?? current.reducedMotion,
    layout: {
      left: patch.layout?.left ?? current.layout.left,
      right: patch.layout?.right ?? current.layout.right,
    },
    editor: { ...current.editor, ...patch.editor },
    optionalModules: patch.optionalModules ?? current.optionalModules,
  };
}
