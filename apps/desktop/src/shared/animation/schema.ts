// 动画文档（docs/animation-editor.md 第 3 节）：自建动画唯一的真相，是一份可读的 JSON 文本。
// 可视化编辑和代码编辑改的都是它；预览、导出、“转为模板”都从它生成一份普通的模板代码（compile.ts），
// 经与内置模板、用户模板同一条装载路径交给引擎 Worker（AGENTS.md 硬性规则 2、3、5）。
// 文件、进程、线程边界都用这里的 zod schema 校验。
import { EASING_NAMES, FILE_REF_RE, FontDefaultSchema, isAssetRef, isResourceId, LocalizedStringSchema, PARAM_KEY_RE } from '@allay/template-sdk';
import { z } from 'zod';
import { PathSchema } from './path';

export const ANIMATION_KIND = 'allay-animation';
/**
 * 格式版本。2（2026-11 第三轮）：值可以绑定到参数（{"$param": 键}）、参数表、音效的 id / 速率 / 空间位置。
 * 第 1 版的文档读入时迁移（版本号改成 2，音效补上 id；第 1 版的写法在第 2 版里都合法）。更高的版本拒绝
 */
export const ANIMATION_FORMAT_VERSION = 2;
export const MAX_PARAMS = 32;
/** 文本上限：正常的动画不过几十 KB */
export const MAX_ANIMATION_CHARS = 512 * 1024;
export const MAX_LAYERS = 64;
export const MAX_KEYS = 256;

const finite = z.number().refine(Number.isFinite, 'must be a finite number');
const hex = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'must be #RRGGBB');
const resourceId = z.string().max(256).refine(isResourceId, 'must be a resource id like minecraft:stone');
/** 贴图：资源栈里的贴图 ID（minecraft:block/stone、minecraft:gui/sprites/…）、模板包里的 asset:路径，或空（不画） */
const textureRef = z.string().max(256).refine((v) => v === '' || isResourceId(v) || isAssetRef(v), 'must be a texture id, asset:path or empty');
/** 图片图层还可以是用户选的本机图片（file:引用，这次运行签发的；工程保存时记下路径，打开时重新签发） */
const imageRef = z.string().max(256).refine((v) => v === '' || isResourceId(v) || isAssetRef(v) || FILE_REF_RE.test(v), 'must be a texture id, asset:path, file reference or empty');

/** 缓动：预设名、三次贝塞尔控制点，或 hold（保持到下一个关键帧再跳变） */
export const AnimEasingSchema = z.union([z.enum(EASING_NAMES), z.literal('hold'), z.tuple([finite, finite, finite, finite])]);
export type AnimEasing = z.infer<typeof AnimEasingSchema>;

// ---- 参数绑定（第 2 版）----

/** 绑定到参数：{"$param": "title"}。转成模板后这个值就是 manifest 里的参数，用户在属性面板里改 */
export const ParamRefSchema = z.strictObject({ $param: z.string().max(64).regex(PARAM_KEY_RE, 'param key must match ^[a-z][a-zA-Z0-9]*$') });
export type ParamRef = z.infer<typeof ParamRefSchema>;
export const isParamRef = (v: unknown): v is ParamRef => typeof v === 'object' && v !== null && !Array.isArray(v) && typeof (v as { $param?: unknown }).$param === 'string';
const bindable = <T extends z.ZodType>(s: T) => z.union([s, ParamRefSchema]);

/** 关键帧：t 秒时取值 v（可以绑定到数值参数）；ease 是从这个关键帧到下一个的缓动（缺省 linear） */
export const KeyframeSchema = z.strictObject({
  t: finite.min(0).max(30),
  v: bindable(finite),
  ease: AnimEasingSchema.optional(),
});
export type Keyframe = z.infer<typeof KeyframeSchema>;

/** 一条属性轨：常量（可以绑定到数值参数），或按时间排好序的关键帧 */
export const TrackSchema = z.union([
  finite,
  ParamRefSchema,
  z.strictObject({ keys: z.array(KeyframeSchema).min(1).max(MAX_KEYS) }).refine((tr) => tr.keys.every((k, i) => i === 0 || k.t > tr.keys[i - 1]!.t), 'keys must be sorted by t without duplicates'),
]);
export type Track = z.infer<typeof TrackSchema>;
export type KeyedTrack = Extract<Track, { keys: unknown }>;
/** 有关键帧的轨道（常量、绑定到参数的常量都不是） */
export const isKeyed = <T extends { keys: readonly unknown[] }>(track: number | ParamRef | T | undefined): track is T => typeof track === 'object' && track !== null && 'keys' in track;

/** 每个图层都有的可动画属性：位置（设计单位，原点在画面中心，+y 向上）、旋转（度）、缩放、不透明度 */
/** progress（第三轮）：沿路径走到哪里（0–1），只在图层有路径时有意义 */
export const ANIM_PROPS = ['x', 'y', 'z', 'rotX', 'rotY', 'rotZ', 'scale', 'opacity', 'progress'] as const;
export type AnimProp = (typeof ANIM_PROPS)[number];
export const PROP_DEFAULTS: Record<AnimProp, number> = { x: 0, y: 0, z: 0, rotX: 0, rotY: 0, rotZ: 0, scale: 1, opacity: 1, progress: 0 };

const PropsSchema = z
  .strictObject(Object.fromEntries(ANIM_PROPS.map((p) => [p, TrackSchema.optional()])) as Record<AnimProp, z.ZodOptional<typeof TrackSchema>>)
  .default({});

export const LAYER_ID_RE = /^[a-z0-9][a-z0-9-]{0,31}$/;

// ---- 复制器（第三轮）----

/** 方块排列（同方块擦除、方块坠落模板的“方块排列”参数，docs/decisions.md“方块排列顺序”） */
export const ARRANGEMENT_NAMES = ['random', 'columns', 'rows', 'diagonal', 'checker', 'rings'] as const;
export const REPEAT_MODES = ['grid', 'linear', 'radial'] as const;
export const REPEAT_ORDERS = ['index', 'reverse', 'center', 'random'] as const;
export const MAX_COPIES = 256;

/**
 * 复制器：把这个图层复制成一组（网格、一条线、一圈），每一份按序号错开 stagger 秒播放这个图层自己的动画。
 * 随机（抖动、random 顺序、random 方块排列）都来自 ctx.random('repeat:<图层 id>:<seed>')，画面只取决于 t（硬性规则 2）。
 * blocks + arrangement 只对方块图层有效：每一份放方块列表里的哪一种，规则同模板的“方块排列”。
 */
export const RepeatSchema = z
  .strictObject({
    mode: z.enum(REPEAT_MODES),
    /** 一条线、一圈的份数 */
    count: z.int().min(1).max(MAX_COPIES).default(8),
    /** 网格的列数、行数 */
    cols: z.int().min(1).max(64).default(4),
    rows: z.int().min(1).max(64).default(3),
    /** 网格的格距；一条线时是每一份相对上一份的位移（设计单位） */
    spacing: z.strictObject({ x: finite.min(-4000).max(4000), y: finite.min(-4000).max(4000) }).default({ x: 200, y: 200 }),
    /** 一圈的半径、展开的角度（度，360 是整圈）、每一份是否朝外转 */
    radius: finite.min(0).max(4000).default(300),
    arc: finite.min(1).max(360).default(360),
    orient: z.boolean().default(true),
    /** 每一份比上一份晚多少秒开始（按 order 排的名次） */
    stagger: finite.min(0).max(5).default(0),
    order: z.enum(REPEAT_ORDERS).default('index'),
    seed: z.int().min(0).max(2 ** 31 - 1).default(1),
    /** 每一份的随机偏移的幅度：位置（设计单位）、旋转（度）、缩放（比例，0.2 是 ±20%） */
    jitter: z.strictObject({ x: finite.min(0).max(4000), y: finite.min(0).max(4000), rot: finite.min(0).max(180), scale: finite.min(0).max(1) }).optional(),
    blocks: z.array(z.strictObject({ id: resourceId, weight: finite.min(0).max(1000) })).min(1).max(16).optional(),
    arrangement: z.enum(ARRANGEMENT_NAMES).optional(),
  })
  .refine((r) => r.mode !== 'grid' || r.cols * r.rows <= MAX_COPIES, { message: `a grid may have at most ${MAX_COPIES} copies`, path: ['cols'] });
export type Repeat = z.infer<typeof RepeatSchema>;

const LayerBase = {
  id: z.string().regex(LAYER_ID_RE, 'id must be lower-case letters, digits and dashes'),
  name: z.string().trim().min(1).max(60),
  /** 图层在 [from, to) 秒内可见；缺省是整段 */
  from: finite.min(0).max(30).optional(),
  to: finite.min(0).max(30).optional(),
  props: PropsSchema,
  /** 父级图层的 id（第三轮）：这个图层的变换接在父级的变换后面，不透明度乘以父级的，父级不可见时它也不可见 */
  parent: z.string().regex(LAYER_ID_RE).optional(),
  /** 隐藏：不画（预览和导出都不画） */
  hidden: z.boolean().optional(),
  /** 独显：有图层独显时只画独显的图层和它们的子图层（预览和导出都是） */
  solo: z.boolean().optional(),
  /** 锁定：界面上不能选中拖动、不能改（画面不受影响） */
  locked: z.boolean().optional(),
  /** 复制器（第三轮）：组图层不能复制 */
  repeat: RepeatSchema.optional(),
  /** 路径动画（第三轮）：位置沿这条路径走（progress 属性是走到哪里），x、y 是相对路径的偏移 */
  path: PathSchema.optional(),
};

export const LAYER_TYPES = ['block', 'item', 'text', 'rect', 'ellipse', 'line', 'image', 'group'] as const;

// ---- 形状的填充、描边，和混合方式（第三轮）----

/** 渐变填充：linear 沿 angle（度，0 是从左到右、90 是从下到上）由 from 过渡到 to；radial 从中心的 from 到边缘的 to */
export const GradientSchema = z.strictObject({ type: z.enum(['linear', 'radial']), from: hex, to: hex, angle: finite.min(-360).max(360).default(90) });
export type Gradient = z.infer<typeof GradientSchema>;
/** 描边：画在形状里面（不改变外框），width 是设计单位 */
export const StrokeSchema = z.strictObject({ color: hex, width: finite.min(0.5).max(400) });
/** 混合方式：在线性、预乘 alpha 的画面上算（docs/animation-editor.md 10.12）。方块和组没有 */
export const BLEND_MODES = ['normal', 'add', 'multiply', 'screen'] as const;
const blend = z.enum(BLEND_MODES).optional();
const shapeFill = { color: bindable(hex).default('#3CB7F4'), gradient: GradientSchema.optional(), stroke: StrokeSchema.optional() };
export type LayerType = (typeof LAYER_TYPES)[number];

// 内容字段都可以绑定到参数（第 2 版）：方块、物品、文字、颜色、字体、大小
export const LayerSchema = z.discriminatedUnion('type', [
  /** 方块：边长 size 设计单位的立方体 */
  z.strictObject({ ...LayerBase, type: z.literal('block'), block: bindable(resourceId), size: bindable(finite.min(1).max(4000)).default(160) }),
  /** 物品：高 size 设计单位 */
  z.strictObject({ ...LayerBase, type: z.literal('item'), item: bindable(resourceId), size: bindable(finite.min(1).max(4000)).default(200), blend }),
  /** 文字：size 是一个字体像素对应多少设计单位；font 是 font 参数的值（字体族与样式），不给时用 minecraft:default */
  z.strictObject({
    ...LayerBase,
    type: z.literal('text'),
    text: bindable(z.string().min(1).max(500)),
    size: bindable(finite.min(0.5).max(100)).default(8),
    color: bindable(hex).default('#FFFFFF'),
    shadow: z.boolean().default(true),
    align: z.enum(['left', 'center', 'right']).default('center'),
    font: bindable(FontDefaultSchema).optional(),
    blend,
  }),
  /** 矩形色块：radius 是圆角半径（超过短边一半时按一半算） */
  z.strictObject({
    ...LayerBase,
    type: z.literal('rect'),
    width: bindable(finite.min(1).max(8000)).default(400),
    height: bindable(finite.min(1).max(8000)).default(240),
    radius: bindable(finite.min(0).max(4000)).optional(),
    ...shapeFill,
    blend,
  }),
  /** 椭圆（宽高相等是圆） */
  z.strictObject({ ...LayerBase, type: z.literal('ellipse'), width: bindable(finite.min(1).max(8000)).default(240), height: bindable(finite.min(1).max(8000)).default(240), ...shapeFill, blend }),
  /** 线段：沿 x 方向长 width、粗 height，中心在原点；round 时两端是半圆 */
  z.strictObject({
    ...LayerBase,
    type: z.literal('line'),
    width: bindable(finite.min(1).max(8000)).default(400),
    height: bindable(finite.min(0.5).max(400)).default(12),
    color: bindable(hex).default('#FFFFFF'),
    gradient: GradientSchema.optional(),
    cap: z.enum(['butt', 'round']).default('round'),
    blend,
  }),
  /**
   * 图片（第三轮）：原版贴图、GUI 精灵、模板包里的图片或用户选的本机图片，铺成 width × height 的四边形。
   * nineSlice 是九宫格边框 [左, 上, 右, 下]（贴图像素，GUI 按钮、面板拉伸时边框不变形），pixelSize 是边框一个贴图像素多大
   */
  z.strictObject({
    ...LayerBase,
    type: z.literal('image'),
    image: bindable(imageRef),
    width: bindable(finite.min(1).max(8000)).default(256),
    height: bindable(finite.min(1).max(8000)).default(256),
    nineSlice: z.tuple([z.int().min(0).max(512), z.int().min(0).max(512), z.int().min(0).max(512), z.int().min(0).max(512)]).optional(),
    pixelSize: finite.min(0.25).max(100).default(8),
    blend,
  }),
  /** 组（空对象）：只有变换，不画任何东西；子图层用 parent 指向它 */
  z.strictObject({ ...LayerBase, type: z.literal('group') }),
]);
export type Layer = z.infer<typeof LayerSchema>;

/**
 * 音效：at 秒时播放。id 在第 2 版里加上（界面里选中、拖动要用；第 1 版的文档迁移时按序号补上）。
 * position 是空间音效的声源位置（单位是格，+x 右、+y 上、-z 正前方，同 ctx.audio.cue 的 position）
 */
export const AnimSoundSchema = z.strictObject({
  id: z.string().regex(LAYER_ID_RE, 'id must be lower-case letters, digits and dashes').optional(),
  at: finite.min(0).max(30),
  sound: bindable(resourceId),
  gain: finite.min(0).max(2).default(1),
  rate: finite.min(0.5).max(2).optional(),
  position: z.strictObject({ x: finite.min(-64).max(64), y: finite.min(-64).max(64), z: finite.min(-64).max(64) }).optional(),
});
export type AnimSound = z.infer<typeof AnimSoundSchema>;

// ---- 参数表（第 2 版）：转成模板时就是 manifest 的 params ----

const paramBase = {
  key: z.string().max(64).regex(PARAM_KEY_RE, 'key must match ^[a-z][a-zA-Z0-9]*$'),
  label: LocalizedStringSchema,
  group: z.string().max(64).optional(),
};
export const ANIM_PARAM_TYPES = ['number', 'duration', 'block', 'item', 'text', 'color', 'font', 'sound', 'texture'] as const;
export type AnimParamType = (typeof ANIM_PARAM_TYPES)[number];
export const AnimParamSchema = z.discriminatedUnion('type', [
  z.strictObject({ ...paramBase, type: z.literal('number'), default: finite, min: finite, max: finite, step: finite.positive().optional(), unit: z.string().max(16).optional() }),
  /** 整段动画的时长：所有时刻按“新时长 ÷ 默认时长”等比伸缩 */
  z.strictObject({ ...paramBase, type: z.literal('duration'), default: finite.min(0.1).max(30), min: finite.min(0.1).max(30), max: finite.min(0.1).max(30) }),
  z.strictObject({ ...paramBase, type: z.literal('block'), default: resourceId }),
  z.strictObject({ ...paramBase, type: z.literal('item'), default: resourceId }),
  z.strictObject({ ...paramBase, type: z.literal('text'), default: z.string().min(1).max(500), multiline: z.boolean().optional() }),
  z.strictObject({ ...paramBase, type: z.literal('color'), default: hex }),
  z.strictObject({ ...paramBase, type: z.literal('font'), default: FontDefaultSchema }),
  z.strictObject({ ...paramBase, type: z.literal('sound'), default: resourceId }),
  /** 贴图参数（第三轮，图片图层用）：转为模板后用户可以从资源栈选，或选本机图片（manifest 里 allowFile） */
  z.strictObject({ ...paramBase, type: z.literal('texture'), default: textureRef }),
]);
export type AnimParam = z.infer<typeof AnimParamSchema>;

/** 第 1 版 → 第 2 版：版本号改成 2，音效按序号补上 id。其他版本、不是对象的原样交给 schema（照常报错） */
export function migrateAnimation(raw: unknown): unknown {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return raw;
  const doc = raw as Record<string, unknown>;
  if (doc.formatVersion !== 1) return raw;
  const sounds = Array.isArray(doc.sounds) ? doc.sounds.map((snd: unknown, i) => (typeof snd === 'object' && snd !== null && !('id' in snd) ? { id: `sound-${i + 1}`, ...snd } : snd)) : doc.sounds;
  return { ...doc, formatVersion: 2, ...(sounds !== undefined ? { sounds } : {}) };
}

const AnimationDocShape = z
  .strictObject({
    kind: z.literal(ANIMATION_KIND),
    formatVersion: z.literal(ANIMATION_FORMAT_VERSION),
    name: z.string().trim().min(1).max(60),
    category: z.enum(['transition', 'overlay', 'title']).default('overlay'),
    /** 秒；可以绑定到 duration 参数 */
    duration: bindable(finite.min(0.1).max(30)),
    /** 转场类必填：剪辑点（秒） */
    cutTime: finite.min(0).max(30).nullable().default(null),
    /** 正交相机（默认，2D 排版），或透视相机（fov 是垂直视角，度） */
    camera: z.discriminatedUnion('type', [z.strictObject({ type: z.literal('ortho') }), z.strictObject({ type: z.literal('perspective'), fov: finite.min(5).max(120) })]).default({ type: 'ortho' }),
    /** 后面的图层画在前面 */
    layers: z.array(LayerSchema).max(MAX_LAYERS).default([]),
    sounds: z.array(AnimSoundSchema).max(64).default([]),
    /** 暴露给模板用户的参数（第 2 版） */
    params: z.array(AnimParamSchema).max(MAX_PARAMS).default([]),
  })
  .superRefine((doc, ctx) => {
    const params = new Map<string, AnimParam>();
    doc.params.forEach((p, i) => {
      if (params.has(p.key)) ctx.addIssue({ code: 'custom', path: ['params', i, 'key'], message: `duplicate param key "${p.key}"` });
      params.set(p.key, p);
      if ((p.type === 'number' || p.type === 'duration') && !(p.min <= p.default && p.default <= p.max)) ctx.addIssue({ code: 'custom', path: ['params', i, 'default'], message: 'default must be within [min, max]' });
    });
    // 每个绑定都指向存在、类型对得上的参数
    for (const site of bindingSites(doc)) {
      const p = params.get(site.value.$param);
      const allowed: readonly AnimParamType[] = BINDABLE_TYPES[site.kind];
      if (!p) ctx.addIssue({ code: 'custom', path: site.path, message: `unknown param "${site.value.$param}"` });
      else if (!allowed.includes(p.type)) ctx.addIssue({ code: 'custom', path: site.path, message: `param "${p.key}" is a ${p.type} param; this value needs ${allowed.join(' or ')}` });
    }
    const durationParam = isParamRef(doc.duration) ? params.get(doc.duration.$param) : undefined;
    const duration = isParamRef(doc.duration) ? (durationParam?.type === 'duration' ? durationParam.default : null) : doc.duration;
    if (doc.category === 'transition' && doc.cutTime === null) ctx.addIssue({ code: 'custom', path: ['cutTime'], message: 'a transition needs a cutTime' });
    if (doc.cutTime !== null && duration !== null && doc.cutTime > duration) ctx.addIssue({ code: 'custom', path: ['cutTime'], message: 'cutTime must not exceed duration' });
    doc.layers.forEach((l, i) => {
      if (l.repeat && l.type === 'group') ctx.addIssue({ code: 'custom', path: ['layers', i, 'repeat'], message: 'a group cannot be repeated' });
      if (l.repeat?.blocks && l.type !== 'block') ctx.addIssue({ code: 'custom', path: ['layers', i, 'repeat', 'blocks'], message: 'only block layers can use a block list' });
    });
    const seen = new Set<string>();
    doc.layers.forEach((l, i) => {
      if (seen.has(l.id)) ctx.addIssue({ code: 'custom', path: ['layers', i, 'id'], message: `duplicate layer id "${l.id}"` });
      seen.add(l.id);
    });
    // 父级：要存在，不能是自己，不能成环
    const parentOf = new Map(doc.layers.map((l) => [l.id, l.parent]));
    doc.layers.forEach((l, i) => {
      if (l.parent === undefined) return;
      if (!parentOf.has(l.parent)) ctx.addIssue({ code: 'custom', path: ['layers', i, 'parent'], message: `unknown parent layer "${l.parent}"` });
      else if (l.parent === l.id) ctx.addIssue({ code: 'custom', path: ['layers', i, 'parent'], message: 'a layer cannot be its own parent' });
      else {
        const visited = new Set<string>([l.id]);
        for (let p: string | undefined = l.parent; p !== undefined; p = parentOf.get(p)) {
          if (visited.has(p)) {
            ctx.addIssue({ code: 'custom', path: ['layers', i, 'parent'], message: 'parent layers form a cycle' });
            break;
          }
          visited.add(p);
        }
      }
    });
    const soundIds = new Set<string>();
    doc.sounds.forEach((snd, i) => {
      if (snd.id === undefined) return;
      if (soundIds.has(snd.id)) ctx.addIssue({ code: 'custom', path: ['sounds', i, 'id'], message: `duplicate sound id "${snd.id}"` });
      soundIds.add(snd.id);
    });
  });

/** 读入时先迁移旧版本（第 1 版 → 第 2 版），再校验 */
export const AnimationDocSchema = z.preprocess(migrateAnimation, AnimationDocShape);
export type AnimationDoc = z.infer<typeof AnimationDocShape>;

// ---- 绑定的位置与类型 ----

/** 各处的值能绑定到哪些类型的参数 */
export const BINDABLE_TYPES = {
  number: ['number'],
  duration: ['duration'],
  block: ['block'],
  item: ['item'],
  text: ['text'],
  color: ['color'],
  font: ['font'],
  sound: ['sound'],
  texture: ['texture'],
} as const satisfies Record<string, readonly AnimParamType[]>;
export type BindingKind = keyof typeof BINDABLE_TYPES;

export interface BindingSite {
  path: (string | number)[];
  value: ParamRef;
  kind: BindingKind;
}

/** 文档里所有绑定到参数的地方（校验、实时预览、界面显示用） */
export function bindingSites(doc: Pick<AnimationDoc, 'duration' | 'layers' | 'sounds'>): BindingSite[] {
  const out: BindingSite[] = [];
  const at = (path: (string | number)[], value: unknown, kind: BindingKind) => {
    if (isParamRef(value)) out.push({ path, value, kind });
  };
  at(['duration'], doc.duration, 'duration');
  doc.layers.forEach((l, i) => {
    const base = ['layers', i];
    if (l.type === 'block') at([...base, 'block'], l.block, 'block');
    if (l.type === 'item') at([...base, 'item'], l.item, 'item');
    if (l.type === 'text') {
      at([...base, 'text'], l.text, 'text');
      at([...base, 'color'], l.color, 'color');
      at([...base, 'font'], l.font, 'font');
    }
    if (l.type === 'rect' || l.type === 'ellipse' || l.type === 'line') {
      at([...base, 'color'], l.color, 'color');
      at([...base, 'width'], l.width, 'number');
      at([...base, 'height'], l.height, 'number');
    }
    if (l.type === 'rect') at([...base, 'radius'], l.radius, 'number');
    if (l.type === 'image') {
      at([...base, 'image'], l.image, 'texture');
      at([...base, 'width'], l.width, 'number');
      at([...base, 'height'], l.height, 'number');
    }
    if (l.type === 'block' || l.type === 'item' || l.type === 'text') at([...base, 'size'], l.size, 'number');
    for (const [prop, track] of Object.entries(l.props)) {
      if (isParamRef(track)) at([...base, 'props', prop], track, 'number');
      else if (isKeyed(track)) track.keys.forEach((k, j) => at([...base, 'props', prop, 'keys', j, 'v'], k.v, 'number'));
    }
  });
  doc.sounds.forEach((snd, i) => at(['sounds', i, 'sound'], snd.sound, 'sound'));
  return out;
}

/** 解析的结果：失败时带上出错的位置（JSON 语法错误给行列，schema 错误给路径和对应的行） */
export type AnimationParse =
  | { ok: true; doc: AnimationDoc }
  | { ok: false; issues: { message: string; path: string; line?: number; column?: number }[] };

/**
 * JSON 语法错误的位置。V8 的错误信息不一定带位置（新版本只给出错的片段），所以自己扫一遍找第一个出错的字符。
 * 只用于提示：扫描器认可的就交给 JSON.parse，它说不合法而扫描器没找到时不给位置（不猜）。
 */
export function jsonErrorOffset(text: string): number | null {
  let i = 0;
  const ws = () => {
    while (i < text.length && ' \t\r\n'.includes(text[i]!)) i++;
  };
  const fail = (): never => {
    throw i;
  };
  const lit = (word: string) => {
    for (const ch of word) {
      if (text[i] !== ch) fail();
      i++;
    }
  };
  const str = () => {
    i++;
    while (i < text.length && text[i] !== '"') {
      if (text.charCodeAt(i) < 0x20) fail();
      if (text[i] === '\\') {
        i++;
        if (text[i] === 'u') {
          if (!/^[0-9a-fA-F]{4}$/.test(text.slice(i + 1, i + 5))) fail();
          i += 4;
        } else if (!'"\\/bfnrt'.includes(text[i] ?? '')) fail();
      }
      i++;
    }
    if (text[i] !== '"') fail();
    i++;
  };
  const num = () => {
    const m = /^-?(0|[1-9]\d*)(\.\d+)?([eE][+-]?\d+)?/.exec(text.slice(i));
    if (!m) fail();
    i += m![0].length;
  };
  const value = (): void => {
    ws();
    const c = text[i];
    if (c === '{') {
      i++;
      ws();
      if (text[i] === '}') return void i++;
      for (;;) {
        ws();
        if (text[i] !== '"') fail();
        str();
        ws();
        if (text[i] !== ':') fail();
        i++;
        value();
        ws();
        if (text[i] === ',') {
          i++;
          continue;
        }
        if (text[i] === '}') return void i++;
        fail();
      }
    }
    if (c === '[') {
      i++;
      ws();
      if (text[i] === ']') return void i++;
      for (;;) {
        value();
        ws();
        if (text[i] === ',') {
          i++;
          continue;
        }
        if (text[i] === ']') return void i++;
        fail();
      }
    }
    if (c === '"') return str();
    if (c === 't') return lit('true');
    if (c === 'f') return lit('false');
    if (c === 'n') return lit('null');
    return num();
  };
  try {
    value();
    ws();
    return i < text.length ? i : null;
  } catch (at) {
    return typeof at === 'number' ? Math.min(at, text.length) : null;
  }
}

function jsonErrorPosition(text: string): { line: number; column: number } | undefined {
  const at = jsonErrorOffset(text);
  return at === null ? undefined : offsetToLineColumn(text, at);
}

export function offsetToLineColumn(text: string, offset: number): { line: number; column: number } {
  let line = 1;
  let last = 0;
  for (let i = 0; i < offset && i < text.length; i++) {
    if (text.charCodeAt(i) === 10) {
      line++;
      last = i + 1;
    }
  }
  return { line, column: offset - last + 1 };
}

/**
 * 粗略地找 schema 路径在文本里的行：沿路径逐段找 "key": 或数组的第 n 个元素。找不到时不给位置（不猜）。
 * 只用于提示，按格式化过的文本（serializeAnimation 的输出）最准。
 */
function pathLine(text: string, path: readonly PropertyKey[]): { line: number; column: number } | undefined {
  let from = 0;
  for (const seg of path) {
    if (typeof seg === 'number') continue;
    const i = text.indexOf(`"${String(seg)}"`, from);
    if (i < 0) return from > 0 ? offsetToLineColumn(text, from) : undefined;
    from = i;
  }
  return from > 0 ? offsetToLineColumn(text, from) : undefined;
}

export function parseAnimation(text: string): AnimationParse {
  if (text.length > MAX_ANIMATION_CHARS) return { ok: false, issues: [{ message: 'animation is too large', path: '' }] };
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, issues: [{ message, path: '', ...jsonErrorPosition(text) }] };
  }
  const parsed = AnimationDocSchema.safeParse(json);
  if (parsed.success) return { ok: true, doc: parsed.data };
  return {
    ok: false,
    issues: parsed.error.issues.slice(0, 20).map((i) => ({ message: i.message, path: i.path.join('.'), ...pathLine(text, i.path) })),
  };
}

/** 稳定的文本形式：两格缩进；关键帧一条一行，读起来像表格 */
export function serializeAnimation(doc: AnimationDoc): string {
  const raw = JSON.stringify(doc, null, 2);
  // 把 { "t": …, "v": …, "ease": … } 这种小对象压成一行
  return `${raw.replace(/\{\n\s+"t": ([^\n]+),\n\s+"v": ([^\n]+?)(?:,\n\s+"ease": ([^\n]+?))?\n\s+\}/g, (_m, t: string, v: string, e?: string) => (e ? `{ "t": ${t}, "v": ${v}, "ease": ${e} }` : `{ "t": ${t}, "v": ${v} }`))}\n`;
}

/** 新建动画的起点：一个居中的方块，从下方弹上来 */
export function newAnimationDoc(name: string, layerName = 'Block'): AnimationDoc {
  return AnimationDocSchema.parse({
    kind: ANIMATION_KIND,
    formatVersion: ANIMATION_FORMAT_VERSION,
    name,
    category: 'overlay',
    duration: 2,
    cutTime: null,
    camera: { type: 'ortho' },
    layers: [
      {
        id: 'block-1',
        name: layerName,
        type: 'block',
        block: 'minecraft:grass_block',
        size: 220,
        props: {
          y: { keys: [{ t: 0, v: -700, ease: 'backOut' }, { t: 0.6, v: 0 }] },
          rotX: 20,
          rotY: { keys: [{ t: 0, v: -45, ease: 'cubicOut' }, { t: 1.2, v: 45 }] },
          opacity: { keys: [{ t: 1.6, v: 1, ease: 'quadIn' }, { t: 2, v: 0 }] },
        },
      },
    ],
    sounds: [],
  });
}

// ---- 求值（编辑器里画曲线、算当前值用；Worker 里的同一套逻辑在 runtime.template.js，单元测试核对两者一致）----

export function trackKeys(track: Track | undefined): Keyframe[] | null {
  return isKeyed(track) ? track.keys : null;
}
