import { DEFAULT_RESOURCE_STACK_SETTINGS, ResourceStackSettingsSchema, type ResourceStackSettings } from '@allay/assets';
import { z } from 'zod';

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

/** 渲染进程可见、可改的部分 */
export const UiSettingsSchema = z.strictObject({
  theme: ThemeSchema.catch('dark'),
  language: LanguagePrefSchema.catch('system'),
  reducedMotion: ReducedMotionPrefSchema.catch('system'),
  layout: LayoutSchema.catch({ left: { ...DEFAULT_LAYOUT.left }, right: { ...DEFAULT_LAYOUT.right } }),
});
export type UiSettings = z.infer<typeof UiSettingsSchema>;

export function defaultUiSettings(): UiSettings {
  return {
    theme: 'dark',
    language: 'system',
    reducedMotion: 'system',
    layout: { left: { ...DEFAULT_LAYOUT.left }, right: { ...DEFAULT_LAYOUT.right } },
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

export const SettingsFileSchema = z.object({
  formatVersion: z.literal(SETTINGS_FORMAT_VERSION),
  ui: UiSettingsSchema.catch(defaultUiSettings),
  window: WindowStateSchema.optional().catch(undefined),
  /** 资源栈（应用级设置，1.9），只有主进程读写 */
  resources: ResourceStackSettingsSchema.catch(defaultResourceSettings).default(defaultResourceSettings),
});
export type SettingsFile = z.infer<typeof SettingsFileSchema>;

export function defaultSettingsFile(): SettingsFile {
  return { formatVersion: SETTINGS_FORMAT_VERSION, ui: defaultUiSettings(), resources: defaultResourceSettings() };
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
  };
}
