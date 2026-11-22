// 模板 manifest 与参数定义的 schema（docs/04-templates.md 4.3、4.4）。TS 类型从 schema 推出。
// 未知字段保留但忽略（looseObject）。校验失败时 zod 的 issue 路径指向具体字段（T-TPL-1）。
import { z } from 'zod';
import type { ParamValue } from './runtime';
import { isValidRange, isValidVersion } from './semver';

/** 当前的 manifest 格式版本。更高的拒绝（提示升级应用），更低的走迁移（migrate.ts） */
export const MANIFEST_FORMAT_VERSION = 1;

export const LocalizedStringSchema = z.union([
  z.string().max(500),
  z.strictObject({ 'zh-CN': z.string().max(500).optional(), en: z.string().max(500).optional() }),
]);
export type LocalizedString = z.infer<typeof LocalizedStringSchema>;

/** 小写反向域名，如 allay.builtin.block-wipe */
export const TEMPLATE_ID_RE = /^[a-z0-9]+(\.[a-z0-9-]+)+$/;
export const TemplateIdSchema = z.string().max(128).regex(TEMPLATE_ID_RE, 'id must be a lower-case reverse domain name');
/** 内置模板保留的前缀：用户模板不得使用 */
export const RESERVED_ID_PREFIX = 'allay.';

export const VersionSchema = z.string().max(64).refine(isValidVersion, 'version must be semver (x.y.z)');
export const VersionRangeSchema = z.string().max(64).refine(isValidRange, 'not a valid version range');

export const PARAM_KEY_RE = /^[a-z][a-zA-Z0-9]*$/;
const ParamKeySchema = z.string().max(64).regex(PARAM_KEY_RE, 'key must match ^[a-z][a-zA-Z0-9]*$');

// ---- 参数值的格式 ----

/** 资源 ID：命名空间:路径（minecraft:block/stone、minecraft:diamond_block） */
export const RESOURCE_ID_RE = /^[a-z0-9_.-]+:[a-z0-9_./-]+$/;
/** 资源 ID：格式对、路径里没有 . 和 .. 段、命名空间不是 asset / file（那两个前缀另有含义） */
export function isResourceId(value: string): boolean {
  if (value.length > 256 || !RESOURCE_ID_RE.test(value)) return false;
  const colon = value.indexOf(':');
  const ns = value.slice(0, colon);
  if (ns === 'asset' || ns === 'file') return false;
  return value
    .slice(colon + 1)
    .split('/')
    .every((seg) => seg !== '' && seg !== '.' && seg !== '..');
}
export const COLOR_RE = /^#[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$/;
/** 模板包里 assets/ 下的相对路径：段名只含字母数字和 _ - .，不能是 . 或 ..，不能以 / 开头或结尾 */
export function isSafeAssetPath(path: string): boolean {
  if (path.length === 0 || path.length > 200) return false;
  return path.split('/').every((seg) => /^[A-Za-z0-9_.-]+$/.test(seg) && seg !== '.' && seg !== '..');
}

/** 模板包 assets/ 里的文件：asset:相对路径 */
export function isAssetRef(value: string): boolean {
  return value.startsWith('asset:') && isSafeAssetPath(value.slice(6));
}
/** 用户选的图片：file:<主进程签发的引用> */
export const FILE_REF_RE = /^file:[0-9a-fA-F-]{36}$/;

export const EASING_NAMES = [
  'linear',
  'quadIn', 'quadOut', 'quadInOut',
  'cubicIn', 'cubicOut', 'cubicInOut',
  'quartIn', 'quartOut', 'quartInOut',
  'quintIn', 'quintOut', 'quintInOut',
  'expoIn', 'expoOut', 'expoInOut',
  'circIn', 'circOut', 'circInOut',
  'backIn', 'backOut', 'backInOut',
  'elasticOut', 'bounceOut',
] as const;

// ---- 参数定义（4.4）----

const ParamValueJson: z.ZodType<ParamValue> = z.lazy(() =>
  z.union([z.number(), z.string(), z.boolean(), z.null(), z.array(ParamValueJson), z.record(z.string(), ParamValueJson)]),
);

export const VisibleWhenSchema = z.strictObject({
  key: ParamKeySchema,
  equals: ParamValueJson.optional(),
  in: z.array(ParamValueJson).max(64).optional(),
  not: ParamValueJson.optional(),
});

const base = {
  key: ParamKeySchema,
  label: LocalizedStringSchema,
  hint: LocalizedStringSchema.optional(),
  group: z.string().max(64).optional(),
  visibleWhen: VisibleWhenSchema.optional(),
};

const finite = z.number().refine(Number.isFinite, 'must be a finite number');
const uiMode = z.enum(['slider', 'field']).optional();
const resourceId = z.string().max(256).refine(isResourceId, 'must be a resource id like minecraft:stone');

const NumberParam = z.looseObject({ ...base, type: z.literal('number'), default: finite, min: finite, max: finite, step: finite.optional(), unit: z.string().max(16).optional(), ui: uiMode });
const IntegerParam = z.looseObject({ ...base, type: z.literal('integer'), default: z.int(), min: z.int(), max: z.int(), ui: uiMode });
const BooleanParam = z.looseObject({ ...base, type: z.literal('boolean'), default: z.boolean() });
/** 图案预览：4×4 格，按行从左上到右下，每格 0–1 表示这一格出现的先后（0 最先）。只给界面画小格用（4.4） */
export const ENUM_PATTERN_CELLS = 16;
const EnumPattern = z.array(z.number().min(0).max(1)).length(ENUM_PATTERN_CELLS);
const EnumParam = z
  .looseObject({
    ...base,
    type: z.literal('enum'),
    default: z.string().max(64),
    options: z.array(z.strictObject({ value: z.string().min(1).max(64), label: LocalizedStringSchema, pattern: EnumPattern.optional() })).min(1).max(64),
    /** 界面提示：'pattern' 用图案小格选择器（每个选项都要带 pattern）；不写时按选项数走分段控件或下拉 */
    ui: z.literal('pattern').optional(),
  })
  .superRefine((p, ctx) => {
    if (p.ui !== 'pattern') return;
    p.options.forEach((o, i) => {
      if (!o.pattern) ctx.addIssue({ code: 'custom', path: ['options', i, 'pattern'], message: "ui: 'pattern' needs a pattern on every option" });
    });
  });
const ColorParam = z.looseObject({
  ...base,
  type: z.literal('color'),
  default: z.string().regex(COLOR_RE, 'must be #RRGGBB or #RRGGBBAA'),
  alpha: z.boolean().optional(),
  palette: z.enum(['dye', 'chat']).optional(),
});
const TextParam = z.looseObject({ ...base, type: z.literal('text'), default: LocalizedStringSchema, maxLength: z.int().min(1).max(10_000).optional(), multiline: z.boolean().optional() });
const BlockParam = z.looseObject({ ...base, type: z.literal('block'), default: resourceId });
export const BlockListEntrySchema = z.strictObject({ id: resourceId, weight: z.number().min(0).max(1000) });
const BlockListParam = z.looseObject({ ...base, type: z.literal('blockList'), default: z.array(BlockListEntrySchema).min(1).max(64), max: z.int().min(1).max(64).optional() });
const ItemParam = z.looseObject({ ...base, type: z.literal('item'), default: resourceId });
const TextureParam = z.looseObject({ ...base, type: z.literal('texture'), default: z.string().max(256), allowFile: z.boolean().optional() });
const SoundParam = z.looseObject({ ...base, type: z.literal('sound'), default: resourceId.nullable() });
const EasingParam = z.looseObject({
  ...base,
  type: z.literal('easing'),
  default: z.union([z.enum(EASING_NAMES), z.tuple([finite, finite, finite, finite])]),
});
const DurationParam = z.looseObject({ ...base, type: z.literal('duration'), default: finite, min: finite, max: finite });
const AngleParam = z.looseObject({ ...base, type: z.literal('angle'), default: finite, snap: z.number().positive().max(360).optional() });
const SeedParam = z.looseObject({ ...base, type: z.literal('seed'), default: z.int() });

/**
 * 字体族的写法（font 参数的 family）：
 * - 资源栈里的字体 ID，如 minecraft:default（游戏默认字体）、minecraft:uniform（Unifont）、minecraft:alt（标准银河字母）、
 *   minecraft:illageralt（灾厄村民文字），以及资源包自己加的字体；
 * - system:sans：系统字体（Worker 里 OffscreenCanvas 的系统字体栈）；旧版本的 allay:fallback（已删除的内置像素字体）当作它；
 * - user:<32 位十六进制>：用户导入的字体文件（内容哈希，文件在应用数据目录里，由主进程读取）；
 * - embedded:default、embedded:uniform：内嵌 Unifont 的普通模式和强制 Unicode 模式（protocol.ts 的 EMBEDDED_*_FONT_ID）。
 *   embedded: 命名空间只认这两个，别的不是字体族（资源包里同名的字体不会被读到）。
 */
export const USER_FONT_RE = /^user:[0-9a-f]{32}$/;
export function isFontFamily(value: string): boolean {
  if (value.startsWith('embedded:')) return value === 'embedded:default' || value === 'embedded:uniform';
  return USER_FONT_RE.test(value) || isResourceId(value);
}
const fontFamily = z.string().max(256).refine(isFontFamily, 'must be a font id like minecraft:default, embedded:default, system:sans or user:<hash>');
/** font 参数的默认值：只给 family 也行，样式缺省为关、描边为 null */
export const FontDefaultSchema = z.strictObject({
  family: fontFamily,
  bold: z.boolean().optional(),
  italic: z.boolean().optional(),
  underline: z.boolean().optional(),
  strikethrough: z.boolean().optional(),
  shadow: z.boolean().optional(),
  outline: z.string().regex(/^#[0-9a-fA-F]{6}$/, 'outline must be #RRGGBB').nullable().optional(),
});
const FontParam = z.looseObject({ ...base, type: z.literal('font'), default: FontDefaultSchema });

export const ParamDefSchema = z.discriminatedUnion('type', [
  NumberParam,
  IntegerParam,
  BooleanParam,
  EnumParam,
  ColorParam,
  TextParam,
  BlockParam,
  BlockListParam,
  ItemParam,
  TextureParam,
  SoundParam,
  EasingParam,
  DurationParam,
  AngleParam,
  SeedParam,
  FontParam,
]);
export type ParamDef = z.infer<typeof ParamDefSchema>;
export type ParamType = ParamDef['type'];
export type ParamDefOf<T extends ParamType> = Extract<ParamDef, { type: T }>;

/** 16 种参数类型（4.4；font 是 2026-11 加的） */
export const PARAM_TYPES = [
  'number', 'integer', 'boolean', 'enum', 'color', 'text', 'block', 'blockList', 'item', 'texture', 'sound', 'easing', 'duration', 'angle', 'seed', 'font',
] as const satisfies readonly ParamType[];

// ---- manifest（4.3）----

const GroupSchema = z.strictObject({ key: z.string().min(1).max(64), label: LocalizedStringSchema, collapsed: z.boolean().optional() });
/**
 * 模板自带的预设（2026-11 反馈：方块排列顺序）：界面的预设菜单里排在用户预设前面，套用方式与用户预设相同
 * （缺的补默认值，多的丢弃，4.7）。key 在模板内唯一，params 只能引用本模板声明的参数。
 * text 参数的值可以是普通字符串，也可以是和参数默认值同样的多语言对象，套用时按界面语言取（preset.ts 的 localizePresetParams）。
 */
export const PRESET_KEY_RE = /^[a-z0-9][a-z0-9-]*$/;
export const ManifestPresetSchema = z.strictObject({
  key: z.string().max(64).regex(PRESET_KEY_RE, 'preset key must match ^[a-z0-9][a-z0-9-]*$'),
  name: LocalizedStringSchema,
  params: z.record(ParamKeySchema, ParamValueJson),
});
export type ManifestPreset = z.infer<typeof ManifestPresetSchema>;
const OutputSchema = z.strictObject({ width: z.int().min(16).max(8192), height: z.int().min(16).max(8192), fps: z.int().min(1).max(240) });

const ManifestShape = z.looseObject({
  formatVersion: z.literal(MANIFEST_FORMAT_VERSION),
  id: TemplateIdSchema,
  version: VersionSchema,
  name: LocalizedStringSchema,
  description: LocalizedStringSchema.optional(),
  author: z.string().max(200).optional(),
  license: z.string().max(200).optional(),
  category: z.enum(['transition', 'overlay', 'title']),
  tags: z.array(z.string().max(40)).max(32).optional(),
  groups: z.array(GroupSchema).max(64).optional(),
  params: z.array(ParamDefSchema).max(128).optional(),
  timeline: z.strictObject({ segments: z.array(z.strictObject({ param: ParamKeySchema, label: LocalizedStringSchema.optional() })).min(1).max(16) }).optional(),
  extends: z.strictObject({ id: TemplateIdSchema, version: VersionRangeSchema }).optional(),
  overrides: z
    .strictObject({
      defaults: z.record(ParamKeySchema, ParamValueJson).optional(),
      hidden: z.array(ParamKeySchema).max(128).optional(),
    })
    .optional(),
  defaultOutput: OutputSchema.optional(),
  presets: z.array(ManifestPresetSchema).max(32).optional(),
  minAppVersion: VersionSchema.optional(),
});

/** 参数默认值自身必须合法：sanitize 之后不变（只做格式检查，不依赖 params.ts，避免循环） */
function defaultProblem(def: ParamDef): string | null {
  switch (def.type) {
    case 'number':
    case 'integer':
    case 'duration':
      if (def.min > def.max) return 'min must not exceed max';
      if (def.default < def.min || def.default > def.max) return 'default is outside [min, max]';
      return null;
    case 'enum': {
      const values = def.options.map((o) => o.value);
      if (new Set(values).size !== values.length) return 'option values must be unique';
      return values.includes(def.default) ? null : 'default is not one of the options';
    }
    case 'color':
      return !def.alpha && def.default.length === 9 ? 'default has alpha but alpha is not enabled' : null;
    case 'text': {
      if (def.maxLength === undefined) return null;
      const texts = typeof def.default === 'string' ? [def.default] : Object.values(def.default);
      return texts.some((t) => [...(t ?? '')].length > def.maxLength!) ? 'default is longer than maxLength' : null;
    }
    case 'blockList':
      return def.max !== undefined && def.default.length > def.max ? 'default has more entries than max' : null;
    case 'texture':
      return def.default === '' || isResourceId(def.default) || isAssetRef(def.default) ? null : 'default must be empty, a resource id or asset:path';
    case 'easing':
      if (typeof def.default === 'string') return null;
      return def.default[0] < 0 || def.default[0] > 1 || def.default[2] < 0 || def.default[2] > 1 ? 'bezier x1 and x2 must be within [0, 1]' : null;
    default:
      return null;
  }
}

export const TemplateManifestSchema = ManifestShape.superRefine((m, ctx) => {
  const params = m.params ?? [];
  const keys = new Map<string, ParamDef>();
  params.forEach((p, i) => {
    if (keys.has(p.key)) ctx.addIssue({ code: 'custom', path: ['params', i, 'key'], message: `duplicate param key "${p.key}"` });
    keys.set(p.key, p);
    const problem = defaultProblem(p);
    if (problem) ctx.addIssue({ code: 'custom', path: ['params', i, 'default'], message: problem });
  });
  const groupKeys = new Set((m.groups ?? []).map((g) => g.key));
  if (groupKeys.size !== (m.groups ?? []).length) ctx.addIssue({ code: 'custom', path: ['groups'], message: 'duplicate group key' });
  params.forEach((p, i) => {
    if (p.group !== undefined && !groupKeys.has(p.group)) ctx.addIssue({ code: 'custom', path: ['params', i, 'group'], message: `unknown group "${p.group}"` });
    if (p.visibleWhen && (!keys.has(p.visibleWhen.key) || p.visibleWhen.key === p.key)) {
      ctx.addIssue({ code: 'custom', path: ['params', i, 'visibleWhen', 'key'], message: `visibleWhen refers to unknown param "${p.visibleWhen.key}"` });
    }
  });
  if (m.extends) {
    // 派生模板：参数定义来自基模板
    if (m.params !== undefined) ctx.addIssue({ code: 'custom', path: ['params'], message: 'a derived template must not declare params' });
    if (m.timeline !== undefined) ctx.addIssue({ code: 'custom', path: ['timeline'], message: 'a derived template must not declare a timeline' });
  } else {
    if (m.params === undefined) ctx.addIssue({ code: 'custom', path: ['params'], message: 'a script template must declare params' });
    if (m.overrides !== undefined) ctx.addIssue({ code: 'custom', path: ['overrides'], message: 'overrides are only for derived templates' });
  }
  const presetKeys = new Set<string>();
  m.presets?.forEach((p, i) => {
    if (presetKeys.has(p.key)) ctx.addIssue({ code: 'custom', path: ['presets', i, 'key'], message: `duplicate preset key "${p.key}"` });
    presetKeys.add(p.key);
    // 派生模板的参数来自基模板，这里查不到，只查脚本模板
    if (m.extends) return;
    for (const [k, v] of Object.entries(p.params)) {
      const def = keys.get(k);
      if (!def) ctx.addIssue({ code: 'custom', path: ['presets', i, 'params', k], message: `preset refers to unknown param "${k}"` });
      // 文字参数写成对象时必须是合法的多语言文字（其余类型不对的值照旧交给清洗，回到默认值）
      else if (def.type === 'text' && v !== null && typeof v === 'object' && !Array.isArray(v) && !LocalizedStringSchema.safeParse(v).success) {
        ctx.addIssue({ code: 'custom', path: ['presets', i, 'params', k], message: 'a text value in a preset must be a string or { "zh-CN"?, "en"? }' });
      }
    }
  });
  m.timeline?.segments.forEach((s, i) => {
    if (keys.get(s.param)?.type !== 'duration') ctx.addIssue({ code: 'custom', path: ['timeline', 'segments', i, 'param'], message: `"${s.param}" is not a duration param` });
  });
});
export type TemplateManifest = z.infer<typeof TemplateManifestSchema>;

export interface ManifestIssue {
  /** 出错字段的路径，如 params.3.default */
  path: string;
  message: string;
}

export function formatIssues(error: z.ZodError): ManifestIssue[] {
  return error.issues.map((i) => ({ path: i.path.map(String).join('.') || '(root)', message: i.message }));
}

export function isDerived(m: TemplateManifest): boolean {
  return m.extends !== undefined;
}

/** 按界面语言取多语言文字：先取对应语言，再退回另一种 */
export function localize(value: LocalizedString | undefined, locale: string): string {
  if (value === undefined) return '';
  if (typeof value === 'string') return value;
  const zh = locale.toLowerCase().startsWith('zh');
  return (zh ? value['zh-CN'] : value.en) ?? value.en ?? value['zh-CN'] ?? '';
}
