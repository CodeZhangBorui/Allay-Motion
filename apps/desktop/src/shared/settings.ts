import {
  DEFAULT_RESOURCE_STACK_SETTINGS,
  MAX_VANILLA_SOURCES,
  PackSourceSchema,
  VanillaSourceSchema,
  vanillaLayerId,
  type PackEntry,
  type ResourceStackSettings,
  type VanillaSourceEntry,
} from '@allay/assets';
import { defaultEditorAppSettings, EditorAppSettingsSchema } from './code-window';
import { z } from 'zod';
import { H264ProbeSchema } from './export';
import { ShortcutOverridesPatchSchema, sanitizeShortcutOverrides, type ShortcutOverrides } from './shortcuts';
import { UpdatePrefsPatchSchema, UpdatePrefsSchema, defaultUpdatePrefs } from './updates';

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

export const LayoutSchema = z.object({
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
  /** 空间音效（2026-11 反馈）：按原版的线性衰减和方位定位处理带声源位置的 cue；预览和导出共用。工程里也记一份 */
  spatialAudio: boolean;
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
    spatialAudio: false,
    groups: {},
    recent: { color: [], block: [], item: [], texture: [] },
  };
}

export const EditorPrefsSchema = z.object({
  background: z.enum(PREVIEW_BACKGROUNDS).catch('checker'),
  solidColor: HexColorSchema.catch('#00B140'),
  guides: z.boolean().catch(false),
  zoom: z.enum(PREVIEW_ZOOMS).catch('fit'),
  hqPreview: z.boolean().catch(false),
  muted: z.boolean().catch(false),
  spatialAudio: z.boolean().catch(false).default(false),
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

/** 自定义快捷键（6.11）：坏掉的条目各自回到默认，不连累其他设置 */
const ShortcutOverridesFileSchema = z.unknown().transform((raw): ShortcutOverrides => sanitizeShortcutOverrides(raw));

/**
 * 渲染进程可见、可改的部分。读文件用：每个字段单独兜底，不认识的键忽略（新版本写的文件给旧版本读时，
 * 不至于因为一个新键整节退回默认值、重新弹出引导、把关掉的自动更新打开）。渲染进程发来的修改另有严格的 UiSettingsPatchSchema
 */
export const UiSettingsSchema = z.object({
  theme: ThemeSchema.catch('dark'),
  language: LanguagePrefSchema.catch('system'),
  reducedMotion: ReducedMotionPrefSchema.catch('system'),
  layout: LayoutSchema.catch({ left: { ...DEFAULT_LAYOUT.left }, right: { ...DEFAULT_LAYOUT.right } }),
  editor: EditorPrefsSchema.catch(defaultEditorPrefs).default(defaultEditorPrefs),
  optionalModules: OptionalModulesSchema.catch({}).default({}),
  /**
   * 开发模式（docs/06-ui-design.md 6.15）：视图菜单里的开关。打开时左栏多一个“开发”标签页、状态栏有指示，
   * 可选模块（内嵌代码编辑器等）随它启用。没有这个字段的旧设置文件读成 false
   */
  devMode: z.boolean().catch(false).default(false),
  /**
   * 首次启动引导（6.10）是否已经走完或跳过。新装时为 false；没有这个字段的旧设置文件读成 true（migrateSettingsFile），
   * 老用户升级后不被拉进引导
   */
  onboardingCompleted: z.boolean().catch(true).default(true),
  /**
   * 新手引导（6.14：首次启动引导之后带用户认一遍主界面）是否已经看完或跳过。新装时为 false；
   * 没有这个字段的旧设置文件读成 true（migrateSettingsFile），老用户不被拉进来，可以从帮助菜单打开
   */
  tourCompleted: z.boolean().catch(true).default(true),
  shortcuts: ShortcutOverridesFileSchema.default({}),
  /** 自动更新（docs/decisions.md“自动更新”）：没有这个字段的旧设置文件用默认值 */
  updates: UpdatePrefsSchema.catch(defaultUpdatePrefs).default(defaultUpdatePrefs),
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
    devMode: false,
    onboardingCompleted: false,
    tourCompleted: false,
    shortcuts: {},
    updates: defaultUpdatePrefs(),
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
      spatialAudio: z.boolean().optional(),
      groups: GroupStateSchema.optional(),
      recent: RecentSchema.optional(),
    })
    .optional(),
  /** 可选模块的开关表：整体替换 */
  optionalModules: OptionalModulesSchema.optional(),
  devMode: z.boolean().optional(),
  onboardingCompleted: z.boolean().optional(),
  tourCompleted: z.boolean().optional(),
  /** 自定义快捷键：整张表替换 */
  shortcuts: ShortcutOverridesPatchSchema.optional(),
  /** 自动更新的设置：整体替换 */
  updates: UpdatePrefsPatchSchema.optional(),
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

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
/** 日志里给出被丢掉的那一项（截断，免得一条坏数据把日志撑大） */
const shown = (v: unknown): string => (JSON.stringify(v) ?? String(v)).slice(0, 300);

/** 读文件时的一条原版来源：id 按来源重新算，所以 id 坏了不要紧；开关坏了算开着；不认识的键忽略 */
const VanillaSourceEntryFileSchema = z.object({ source: VanillaSourceSchema, enabled: z.boolean().catch(true) });
/** 读文件时的一个资源包：id 不能重新算（文件夹包的 id 是随机的），必须在；不认识的键忽略 */
const PackEntryFileSchema = z.object({ id: z.string().min(1).max(256), name: z.string().catch(''), source: PackSourceSchema, enabled: z.boolean().catch(true) });

/**
 * 读 settings.json 里的资源栈（只有主进程读写）。各部分单独兜底，坏一处只丢那一处，不连累同意、游戏目录和其余条目：
 * - vanilla 的三个字段各自回到默认值；
 * - vanillaSources、packs 里过不了 schema 的条目、和前面重复的条目各自丢掉，其余照常；
 * - 原版来源的 id 按来源重新算（vanillaLayerId）：同一个来源总是同一个层 id，旧文件里对不上的以算出来的为准；
 * - 不认识的键忽略（新版本写的文件给旧版本读时不至于整节作废）。
 * 丢掉、改掉了什么写进 notes，由读设置的一方写日志。整节都不是对象时用默认值。
 */
export function readResourceSettings(raw: unknown, notes: string[] = []): ResourceStackSettings {
  const out = defaultResourceSettings();
  if (raw === undefined) return out;
  if (!isRecord(raw)) {
    notes.push(`resources is not an object, using defaults: ${shown(raw)}`);
    return out;
  }
  const v = raw.vanilla;
  if (isRecord(v)) {
    const consent = z.boolean().nullable().safeParse(v.consent);
    if (consent.success) out.vanilla.consent = consent.data;
    else notes.push(`resources.vanilla.consent reset: ${shown(v.consent)}`);
    const enabled = z.boolean().safeParse(v.enabled);
    if (enabled.success) out.vanilla.enabled = enabled.data;
    else notes.push(`resources.vanilla.enabled reset: ${shown(v.enabled)}`);
    const dir = z.string().min(1).nullable().safeParse(v.dir);
    if (dir.success) out.vanilla.dir = dir.data;
    else notes.push(`resources.vanilla.dir reset: ${shown(v.dir)}`);
  } else if (v !== undefined) {
    notes.push(`resources.vanilla reset: ${shown(v)}`);
  }

  const sources = raw.vanillaSources;
  if (Array.isArray(sources)) {
    const seen = new Set<string>();
    sources.forEach((item, i) => {
      const parsed = VanillaSourceEntryFileSchema.safeParse(item);
      if (!parsed.success) return void notes.push(`resources.vanillaSources[${i}] dropped: ${shown(item)}`);
      const id = vanillaLayerId(parsed.data.source);
      if (seen.has(id)) return void notes.push(`resources.vanillaSources[${i}] dropped (duplicate of ${id})`);
      if (out.vanillaSources.length >= MAX_VANILLA_SOURCES) return void notes.push(`resources.vanillaSources[${i}] dropped (more than ${MAX_VANILLA_SOURCES})`);
      seen.add(id);
      const stored = isRecord(item) ? item.id : undefined;
      if (stored !== id) notes.push(`resources.vanillaSources[${i}] id ${shown(stored)} → ${id}`);
      const entry: VanillaSourceEntry = { id, source: parsed.data.source, enabled: parsed.data.enabled };
      out.vanillaSources.push(entry);
    });
  } else if (sources !== undefined) {
    notes.push(`resources.vanillaSources reset: ${shown(sources)}`);
  }

  const packs = raw.packs;
  if (Array.isArray(packs)) {
    const seen = new Set<string>();
    packs.forEach((item, i) => {
      const parsed = PackEntryFileSchema.safeParse(item);
      if (!parsed.success) return void notes.push(`resources.packs[${i}] dropped: ${shown(item)}`);
      if (seen.has(parsed.data.id)) return void notes.push(`resources.packs[${i}] dropped (duplicate id ${parsed.data.id})`);
      // vanilla 开头的 id 留给原版来源：撞上了资源栈就组不起来
      if (parsed.data.id.startsWith('vanilla')) return void notes.push(`resources.packs[${i}] dropped (id ${parsed.data.id} is reserved for vanilla sources)`);
      seen.add(parsed.data.id);
      const entry: PackEntry = parsed.data;
      out.packs.push(entry);
    });
  } else if (packs !== undefined) {
    notes.push(`resources.packs reset: ${shown(packs)}`);
  }
  return out;
}

/** 导出的应用级设置（M7），只有主进程读写：上次选的输出文件夹、H.264 探测结果的缓存（5.3） */
export const ExportAppSettingsSchema = z.object({
  folder: z.string().min(1).max(1000).nullable().catch(null),
  /** 探测结果的缓存坏了重新探测就是，不连累输出文件夹 */
  h264: H264ProbeSchema.nullable().catch(null),
});
export type ExportAppSettings = z.infer<typeof ExportAppSettingsSchema>;
export function defaultExportAppSettings(): ExportAppSettings {
  return { folder: null, h264: null };
}

/**
 * 工程的应用级设置（6.11），只有主进程读写：新工程“保存”“另存为”时对话框默认打开的文件夹。
 * 文件夹只来自主进程的文件夹对话框（1.6 第 6 条）。
 */
export const ProjectAppSettingsSchema = z.object({
  folder: z.string().min(1).max(1000).nullable(),
});
export type ProjectAppSettings = z.infer<typeof ProjectAppSettingsSchema>;
export function defaultProjectAppSettings(): ProjectAppSettings {
  return { folder: null };
}

export const SettingsFileSchema = z.object({
  formatVersion: z.literal(SETTINGS_FORMAT_VERSION),
  ui: UiSettingsSchema.catch(defaultUiSettings),
  window: WindowStateSchema.optional().catch(undefined),
  /** 资源栈（应用级设置，1.9），只有主进程读写。坏掉的条目各自丢掉（readResourceSettings） */
  resources: z
    .unknown()
    .transform((raw): ResourceStackSettings => readResourceSettings(raw))
    .default(defaultResourceSettings),
  /** 导出（M7），只有主进程读写 */
  export: ExportAppSettingsSchema.catch(defaultExportAppSettings).default(defaultExportAppSettings),
  /** 工程（6.11），只有主进程读写 */
  project: ProjectAppSettingsSchema.catch(defaultProjectAppSettings).default(defaultProjectAppSettings),
  /** 打开动画代码用的编辑器（2026-11），只有主进程读写；旧设置文件没有这一节时是应用自带的 */
  editor: EditorAppSettingsSchema.catch(defaultEditorAppSettings).default(defaultEditorAppSettings),
});
export type SettingsFile = z.infer<typeof SettingsFileSchema>;

/** 新装（没有设置文件）时的设置：引导还没走过 */
export function defaultSettingsFile(): SettingsFile {
  return {
    formatVersion: SETTINGS_FORMAT_VERSION,
    ui: defaultUiSettings(),
    resources: defaultResourceSettings(),
    export: defaultExportAppSettings(),
    project: defaultProjectAppSettings(),
    editor: defaultEditorAppSettings(),
  };
}

/**
 * 已有设置文件、但它整个不能用（损坏、版本不对）时的设置：用默认值，只是引导算已经走过——
 * 有设置文件就说明不是第一次启动（docs/decisions.md 界面增强）。
 */
export function fallbackSettingsFile(): SettingsFile {
  const s = defaultSettingsFile();
  return { ...s, ui: { ...s.ui, onboardingCompleted: true, tourCompleted: true } };
}

/**
 * 读设置文件（JSON 解析之后）：校验每个字段并做平滑升级。formatVersion 没有变（新字段都可缺省）：
 * - 没有 ui.onboardingCompleted（引导上线之前写的文件，或 ui 整块坏了）：读成 true；
 * - 没有 ui.tourCompleted（新手引导上线之前写的文件）：跟着 onboardingCompleted 明确记着的值，没有记就读成 true；
 * - 没有 ui.shortcuts、project：用默认值。
 * 整个不能用时返回 null（调用方把文件留档，换 fallbackSettingsFile）。
 * notes 收集读的时候丢掉、改掉的条目（资源栈里坏掉的原版来源、资源包等），由调用方写日志。
 */
export function migrateSettingsFile(json: unknown, notes?: string[]): SettingsFile | null {
  const parsed = SettingsFileSchema.safeParse(json);
  if (!parsed.success) return null;
  // schema 里已经按同样的规则读过一遍；这里再读一遍只是为了把丢掉了什么记下来
  const resources = notes ? readResourceSettings((json as { resources?: unknown }).resources, notes) : parsed.data.resources;
  const rawUi = (json as { ui?: unknown }).ui;
  const hasFlag = (key: 'onboardingCompleted' | 'tourCompleted') => typeof rawUi === 'object' && rawUi !== null && typeof (rawUi as Record<string, unknown>)[key] === 'boolean';
  const ui = { ...parsed.data.ui };
  // 新手引导跟在首次启动引导后面：首次启动引导明确记着没走完（新装后中途退出）时，新手引导也还没看；否则算看过
  if (!hasFlag('tourCompleted')) ui.tourCompleted = hasFlag('onboardingCompleted') ? ui.onboardingCompleted : true;
  if (!hasFlag('onboardingCompleted')) ui.onboardingCompleted = true;
  return { ...parsed.data, ui, resources };
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
    devMode: patch.devMode ?? current.devMode,
    onboardingCompleted: patch.onboardingCompleted ?? current.onboardingCompleted,
    tourCompleted: patch.tourCompleted ?? current.tourCompleted,
    shortcuts: patch.shortcuts ?? current.shortcuts,
    updates: patch.updates ?? current.updates,
  };
}
