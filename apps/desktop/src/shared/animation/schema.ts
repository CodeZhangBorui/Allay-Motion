// 动画文档（docs/animation-editor.md 第 3 节）：自建动画唯一的真相，是一份可读的 JSON 文本。
// 可视化编辑和代码编辑改的都是它；预览、导出、“转为模板”都从它生成一份普通的模板代码（compile.ts），
// 经与内置模板、用户模板同一条装载路径交给引擎 Worker（AGENTS.md 硬性规则 2、3、5）。
// 文件、进程、线程边界都用这里的 zod schema 校验。
import { EASING_NAMES, isResourceId } from '@allay/template-sdk';
import { z } from 'zod';

export const ANIMATION_KIND = 'allay-animation';
export const ANIMATION_FORMAT_VERSION = 1;
/** 文本上限：正常的动画不过几十 KB */
export const MAX_ANIMATION_CHARS = 512 * 1024;
export const MAX_LAYERS = 64;
export const MAX_KEYS = 256;

const finite = z.number().refine(Number.isFinite, 'must be a finite number');
const hex = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'must be #RRGGBB');
const resourceId = z.string().max(256).refine(isResourceId, 'must be a resource id like minecraft:stone');

/** 缓动：预设名、三次贝塞尔控制点，或 hold（保持到下一个关键帧再跳变） */
export const AnimEasingSchema = z.union([z.enum(EASING_NAMES), z.literal('hold'), z.tuple([finite, finite, finite, finite])]);
export type AnimEasing = z.infer<typeof AnimEasingSchema>;

/** 关键帧：t 秒时取值 v；ease 是从这个关键帧到下一个的缓动（缺省 linear） */
export const KeyframeSchema = z.strictObject({
  t: finite.min(0).max(30),
  v: finite,
  ease: AnimEasingSchema.optional(),
});
export type Keyframe = z.infer<typeof KeyframeSchema>;

/** 一条属性轨：常量，或按时间排好序的关键帧 */
export const TrackSchema = z.union([
  finite,
  z.strictObject({ keys: z.array(KeyframeSchema).min(1).max(MAX_KEYS) }).refine((tr) => tr.keys.every((k, i) => i === 0 || k.t > tr.keys[i - 1]!.t), 'keys must be sorted by t without duplicates'),
]);
export type Track = z.infer<typeof TrackSchema>;

/** 每个图层都有的可动画属性：位置（设计单位，原点在画面中心，+y 向上）、旋转（度）、缩放、不透明度 */
export const ANIM_PROPS = ['x', 'y', 'z', 'rotX', 'rotY', 'rotZ', 'scale', 'opacity'] as const;
export type AnimProp = (typeof ANIM_PROPS)[number];
export const PROP_DEFAULTS: Record<AnimProp, number> = { x: 0, y: 0, z: 0, rotX: 0, rotY: 0, rotZ: 0, scale: 1, opacity: 1 };

const PropsSchema = z
  .strictObject(Object.fromEntries(ANIM_PROPS.map((p) => [p, TrackSchema.optional()])) as Record<AnimProp, z.ZodOptional<typeof TrackSchema>>)
  .default({});

export const LAYER_ID_RE = /^[a-z0-9][a-z0-9-]{0,31}$/;

const LayerBase = {
  id: z.string().regex(LAYER_ID_RE, 'id must be lower-case letters, digits and dashes'),
  name: z.string().trim().min(1).max(60),
  /** 图层在 [from, to) 秒内可见；缺省是整段 */
  from: finite.min(0).max(30).optional(),
  to: finite.min(0).max(30).optional(),
  props: PropsSchema,
};

export const LAYER_TYPES = ['block', 'item', 'text', 'rect'] as const;
export type LayerType = (typeof LAYER_TYPES)[number];

export const LayerSchema = z.discriminatedUnion('type', [
  /** 方块：边长 size 设计单位的立方体 */
  z.strictObject({ ...LayerBase, type: z.literal('block'), block: resourceId, size: finite.min(1).max(4000).default(160) }),
  /** 物品：高 size 设计单位 */
  z.strictObject({ ...LayerBase, type: z.literal('item'), item: resourceId, size: finite.min(1).max(4000).default(200) }),
  /** 文字：size 是一个字体像素对应多少设计单位 */
  z.strictObject({
    ...LayerBase,
    type: z.literal('text'),
    text: z.string().min(1).max(500),
    size: finite.min(0.5).max(100).default(8),
    color: hex.default('#FFFFFF'),
    shadow: z.boolean().default(true),
    align: z.enum(['left', 'center', 'right']).default('center'),
  }),
  /** 矩形色块 */
  z.strictObject({ ...LayerBase, type: z.literal('rect'), width: finite.min(1).max(8000).default(400), height: finite.min(1).max(8000).default(240), color: hex.default('#3CB7F4') }),
]);
export type Layer = z.infer<typeof LayerSchema>;

/** 音效：at 秒时播放 */
export const AnimSoundSchema = z.strictObject({
  at: finite.min(0).max(30),
  sound: resourceId,
  gain: finite.min(0).max(2).default(1),
});

export const AnimationDocSchema = z
  .strictObject({
    kind: z.literal(ANIMATION_KIND),
    formatVersion: z.literal(ANIMATION_FORMAT_VERSION),
    name: z.string().trim().min(1).max(60),
    category: z.enum(['transition', 'overlay', 'title']).default('overlay'),
    /** 秒 */
    duration: finite.min(0.1).max(30),
    /** 转场类必填：剪辑点（秒） */
    cutTime: finite.min(0).max(30).nullable().default(null),
    /** 正交相机（默认，2D 排版），或透视相机（fov 是垂直视角，度） */
    camera: z.discriminatedUnion('type', [z.strictObject({ type: z.literal('ortho') }), z.strictObject({ type: z.literal('perspective'), fov: finite.min(5).max(120) })]).default({ type: 'ortho' }),
    /** 后面的图层画在前面 */
    layers: z.array(LayerSchema).max(MAX_LAYERS).default([]),
    sounds: z.array(AnimSoundSchema).max(64).default([]),
  })
  .superRefine((doc, ctx) => {
    if (doc.category === 'transition' && doc.cutTime === null) ctx.addIssue({ code: 'custom', path: ['cutTime'], message: 'a transition needs a cutTime' });
    if (doc.cutTime !== null && doc.cutTime > doc.duration) ctx.addIssue({ code: 'custom', path: ['cutTime'], message: 'cutTime must not exceed duration' });
    const seen = new Set<string>();
    doc.layers.forEach((l, i) => {
      if (seen.has(l.id)) ctx.addIssue({ code: 'custom', path: ['layers', i, 'id'], message: `duplicate layer id "${l.id}"` });
      seen.add(l.id);
    });
  });
export type AnimationDoc = z.infer<typeof AnimationDocSchema>;

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
  return track !== undefined && typeof track === 'object' ? track.keys : null;
}
