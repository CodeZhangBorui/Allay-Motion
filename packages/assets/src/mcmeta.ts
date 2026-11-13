// .mcmeta 的解析：资源包的 pack.mcmeta（3.5）和贴图的动画元数据（3.6）。
// 各版本的字段不一样，一律宽松解析：认不出的字段忽略，类型不对的字段当作缺失，不抛错。
import { z } from 'zod';

/** 游戏刻：1/20 秒 */
export const TICKS_PER_SECOND = 20;

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text.replace(/^\uFEFF/, '')) as unknown;
  } catch {
    return undefined;
  }
}

/** 取对象里某个字段，类型不符合 schema 时当作缺失 */
function field<T>(obj: unknown, key: string, schema: z.ZodType<T>): T | undefined {
  if (typeof obj !== 'object' || obj === null || Array.isArray(obj)) return undefined;
  const r = schema.safeParse((obj as Record<string, unknown>)[key]);
  return r.success ? r.data : undefined;
}

// ---------------------------------------------------------------------------
// pack.mcmeta

export interface PackMeta {
  /** pack.description 若是文本组件，取出其中的纯文本 */
  description?: string;
  packFormat?: number;
}

/** 文本组件 → 纯文本（字符串、数组、带 text/extra 的对象） */
export function textComponentToPlain(value: unknown, depth = 0): string {
  if (depth > 16) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) return value.map((v) => textComponentToPlain(v, depth + 1)).join('');
  if (typeof value === 'object' && value !== null) {
    const o = value as Record<string, unknown>;
    const text = typeof o.text === 'string' ? o.text : typeof o.translate === 'string' ? o.translate : '';
    const extra = Array.isArray(o.extra) ? o.extra.map((v) => textComponentToPlain(v, depth + 1)).join('') : '';
    return text + extra;
  }
  return '';
}

/** 去掉 § 格式代码 */
export function stripFormatting(text: string): string {
  return text.replace(/§./gu, '');
}

export function parsePackMeta(text: string): PackMeta {
  const root = parseJson(text);
  const pack = field(root, 'pack', z.record(z.string(), z.unknown()));
  const out: PackMeta = {};
  if (!pack) return out;
  const desc = pack.description;
  if (desc !== undefined) {
    const plain = stripFormatting(textComponentToPlain(desc)).trim();
    if (plain) out.description = plain.slice(0, 500);
  }
  // 1.21.9 起有 min_format/max_format，旧版只有 pack_format
  const fmt = field(pack, 'pack_format', z.number().int()) ?? field(pack, 'min_format', z.number().int());
  if (fmt !== undefined) out.packFormat = fmt;
  return out;
}

// ---------------------------------------------------------------------------
// 动画贴图

export interface AnimationFrame {
  index: number;
  /** 这一帧持续的游戏刻数，至少 1 */
  time: number;
}

export interface AnimationMeta {
  frametime: number;
  /** 未写 frames 时为 undefined，表示按图里的帧顺序播放 */
  frames?: AnimationFrame[];
  width?: number;
  height?: number;
  interpolate: boolean;
}

const PositiveInt = z.number().int().positive();
const NonNegInt = z.number().int().nonnegative();

/** 解析贴图的 .mcmeta。没有 animation 字段时返回 null */
export function parseAnimationMeta(text: string): AnimationMeta | null {
  const root = parseJson(text);
  const anim = field(root, 'animation', z.record(z.string(), z.unknown()));
  if (!anim) return null;
  const frametime = field(anim, 'frametime', PositiveInt) ?? 1;
  const out: AnimationMeta = { frametime, interpolate: field(anim, 'interpolate', z.boolean()) ?? false };
  const width = field(anim, 'width', PositiveInt);
  const height = field(anim, 'height', PositiveInt);
  if (width !== undefined) out.width = width;
  if (height !== undefined) out.height = height;
  const rawFrames = field(anim, 'frames', z.array(z.unknown()));
  if (rawFrames) {
    const frames: AnimationFrame[] = [];
    for (const f of rawFrames) {
      const asIndex = NonNegInt.safeParse(f);
      if (asIndex.success) {
        frames.push({ index: asIndex.data, time: frametime });
        continue;
      }
      const index = field(f, 'index', NonNegInt);
      if (index === undefined) continue;
      frames.push({ index, time: field(f, 'time', PositiveInt) ?? frametime });
    }
    out.frames = frames;
  }
  return out;
}

export interface AnimationLayout {
  frameWidth: number;
  frameHeight: number;
  /** 图里的帧数（按行优先排列） */
  frameCount: number;
  /** 播放序列；越界的帧序号已经去掉 */
  sequence: AnimationFrame[];
  /** 一个循环的总刻数 */
  cycleTicks: number;
}

/**
 * 帧尺寸与播放序列。与游戏一致：只写了 width 时高度取整张图的高；只写了 height 时宽度取整张图的宽；
 * 都没写时每帧是正方形，边长取宽和高中较小的一个（帧纵向排列时就是图片宽度）。
 * 图片尺寸不能整除帧尺寸、或序列为空时返回 null（调用方按静态贴图处理并报警告）。
 */
export function layoutAnimation(meta: AnimationMeta, imageWidth: number, imageHeight: number): AnimationLayout | null {
  let fw: number;
  let fh: number;
  if (meta.width !== undefined) {
    fw = meta.width;
    fh = meta.height ?? imageHeight;
  } else if (meta.height !== undefined) {
    fw = imageWidth;
    fh = meta.height;
  } else {
    fw = fh = Math.min(imageWidth, imageHeight);
  }
  if (fw <= 0 || fh <= 0 || imageWidth % fw !== 0 || imageHeight % fh !== 0) return null;
  const frameCount = (imageWidth / fw) * (imageHeight / fh);
  const sequence = (meta.frames ?? Array.from({ length: frameCount }, (_, index) => ({ index, time: meta.frametime }))).filter(
    (f) => f.index < frameCount,
  );
  if (sequence.length === 0) return null;
  const cycleTicks = sequence.reduce((sum, f) => sum + f.time, 0);
  return { frameWidth: fw, frameHeight: fh, frameCount, sequence, cycleTicks };
}

/** 浮点误差的容差：0.3 × 20 这类乘积可能落在整数下方一点点 */
const TICK_EPSILON = 1e-9;

/**
 * 时刻 t（秒）显示图里的第几帧。等价于 02-engine.md 2.8 的
 * `sequence[floor(t × 20 / frametime) mod length]`，并推广到每帧时长不同的情况。v1 忽略 interpolate。
 */
export function animationFrameAt(layout: AnimationLayout, t: number): number {
  const first = layout.sequence[0];
  if (first === undefined || !Number.isFinite(t)) return first?.index ?? 0;
  const ticks = Math.floor(t * TICKS_PER_SECOND + TICK_EPSILON);
  let pos = ((ticks % layout.cycleTicks) + layout.cycleTicks) % layout.cycleTicks;
  for (const f of layout.sequence) {
    if (pos < f.time) return f.index;
    pos -= f.time;
  }
  return first.index;
}

/** 第 index 帧在整张图里的位置（像素，左上角为原点） */
export function frameRect(layout: AnimationLayout, imageWidth: number, index: number): { x: number; y: number; width: number; height: number } {
  const perRow = imageWidth / layout.frameWidth;
  return {
    x: (index % perRow) * layout.frameWidth,
    y: Math.floor(index / perRow) * layout.frameHeight,
    width: layout.frameWidth,
    height: layout.frameHeight,
  };
}

// ---------------------------------------------------------------------------
// 界面贴图的九宫格（1.20.2 起的 gui.scaling）

export interface NineSlice {
  width: number;
  height: number;
  border: { left: number; top: number; right: number; bottom: number };
}

export function parseGuiNineSlice(text: string): NineSlice | null {
  const root = parseJson(text);
  const gui = field(root, 'gui', z.record(z.string(), z.unknown()));
  const scaling = field(gui, 'scaling', z.record(z.string(), z.unknown()));
  if (!scaling || scaling.type !== 'nine_slice') return null;
  const width = field(scaling, 'width', PositiveInt);
  const height = field(scaling, 'height', PositiveInt);
  if (width === undefined || height === undefined) return null;
  const uniform = field(scaling, 'border', NonNegInt);
  if (uniform !== undefined) return { width, height, border: { left: uniform, top: uniform, right: uniform, bottom: uniform } };
  const b = field(scaling, 'border', z.object({ left: NonNegInt, top: NonNegInt, right: NonNegInt, bottom: NonNegInt }));
  return b ? { width, height, border: { left: b.left, top: b.top, right: b.right, bottom: b.bottom } } : null;
}
