// 对动画文档的小步修改（可视化编辑和类型化命令共用；docs/animation-editor.md 第 6、10 节）。
// 都是纯函数：输入轨道或文档，返回新的；不合法的结果由调用方用 schema 再校验一次。
// 求值（sampleTrack）用解析过参数的轨道（resolve.ts），修改用文档里的原样轨道（关键帧的值可能绑定到参数）。
import { ANIM_PROPS, isKeyed, isParamRef, PROP_DEFAULTS, type AnimEasing, type AnimationDoc, type AnimProp, type Keyframe, type Track } from './schema';

/** 两个时刻算同一个关键帧的容差（秒）：小于 60 fps 的半帧 */
export const KEY_EPSILON = 1 / 240;

export type EaseEval = (ease: AnimEasing | undefined) => (x: number) => number;

/** 解析过参数的轨道：值都是数 */
export type ResolvedTrack = number | { keys: readonly { t: number; v: number; ease?: AnimEasing | undefined }[] };

/** 按 t 求值；与 runtime.template.js 的 sample 是同一套规则（T-ANIM-2 核对两边一致） */
export function sampleTrack(track: ResolvedTrack | undefined, fallback: number, t: number, ease: EaseEval): number {
  if (track === undefined) return fallback;
  if (typeof track === 'number') return track;
  const k = track.keys;
  if (k.length === 1 || t <= k[0]!.t) return k[0]!.v;
  if (t >= k[k.length - 1]!.t) return k[k.length - 1]!.v;
  let i = 0;
  while (i < k.length - 2 && t >= k[i + 1]!.t) i++;
  const a = k[i]!;
  const b = k[i + 1]!;
  if (a.ease === 'hold') return a.v;
  const p = (t - a.t) / (b.t - a.t);
  return a.v + (b.v - a.v) * ease(a.ease)(p);
}

export function propValue(layer: { props: Partial<Record<AnimProp, ResolvedTrack | undefined>> }, prop: AnimProp, t: number, ease: EaseEval): number {
  return sampleTrack(layer.props[prop], PROP_DEFAULTS[prop], t, ease);
}

export function keysOf<K extends { t: number }>(track: number | { $param: string } | { keys: readonly K[] } | undefined): readonly K[] {
  return isKeyed(track) ? track.keys : [];
}

export function keyIndexAt(track: Track | ResolvedTrack | undefined, t: number): number {
  return keysOf(track as Track).findIndex((k) => Math.abs(k.t - t) < KEY_EPSILON);
}

export const round = (x: number, digits = 4) => Math.round(x * 10 ** digits) / 10 ** digits;

/**
 * 在 t 处把属性设成 v（自动关键帧）：没有关键帧的属性直接改常量；有关键帧的，t 处有就改它，没有就插一个
 * （缓动沿用前一个关键帧的）。
 */
export function setValueAt(track: Track | undefined, t: number, v: number): Track {
  const value = round(v);
  if (!isKeyed(track)) return value;
  const keys = track.keys.map((k) => ({ ...k }));
  const i = keyIndexAt(track, t);
  if (i >= 0) {
    keys[i]!.v = value;
    return { keys };
  }
  const at = round(t);
  const before = keys.filter((k) => k.t < at).at(-1);
  const key: Keyframe = before?.ease !== undefined ? { t: at, v: value, ease: before.ease } : { t: at, v: value };
  return { keys: [...keys, key].sort((a, b) => a.t - b.t) };
}

/** 切换 t 处的关键帧：有就删（删到只剩常量时变回常量），没有就以当前值加一个 */
export function toggleKeyAt(track: Track | undefined, t: number, current: number): Track | undefined {
  const keys = keysOf(track);
  const i = keyIndexAt(track, t);
  if (i >= 0) {
    const rest = keys.filter((_, j) => j !== i);
    return rest.length === 0 ? round(current) : { keys: rest.map((k) => ({ ...k })) };
  }
  const key: Keyframe = { t: round(t), v: round(current) };
  if (keys.length === 0) return { keys: [key] };
  return { keys: [...keys.map((k) => ({ ...k })), key].sort((a, b) => a.t - b.t) };
}

/** 把第 index 个关键帧挪到 t（夹在 [0, 上限] 里）；会和别的关键帧重合时不动，返回 null */
export function moveKey(track: Track | undefined, index: number, t: number, max: number): Track | null {
  const keys = keysOf(track);
  if (!keys[index]) return null;
  const at = round(Math.min(max, Math.max(0, t)));
  if (keys.some((k, j) => j !== index && Math.abs(k.t - at) < KEY_EPSILON)) return null;
  const next = keys.map((k, j) => (j === index ? { ...k, t: at } : { ...k }));
  return { keys: next.sort((a, b) => a.t - b.t) };
}

export function setKeyEase(track: Track | undefined, index: number, ease: AnimEasing | undefined): Track | null {
  const keys = keysOf(track);
  if (!keys[index]) return null;
  return {
    keys: keys.map((k, j) => {
      if (j !== index) return { ...k };
      const { ease: _old, ...rest } = k;
      return ease === undefined || ease === 'linear' ? rest : { ...rest, ease };
    }),
  };
}

export function removeKey(track: Track | undefined, index: number): Track | undefined {
  const keys = keysOf(track);
  if (!keys[index]) return track;
  const rest = keys.filter((_, j) => j !== index);
  if (rest.length > 0) return { keys: rest.map((k) => ({ ...k })) };
  const v = keys[index]!.v;
  return v;
}

/** 一个图层全部关键帧的时刻（去重、排序）：时间轴上图层那一行的菱形 */
export function layerKeyTimes(layer: { props: Partial<Record<AnimProp, Track | ResolvedTrack | undefined>> }): number[] {
  const out: number[] = [];
  for (const track of Object.values(layer.props)) for (const k of keysOf(track as Track)) if (!out.some((x) => Math.abs(x - k.t) < KEY_EPSILON)) out.push(k.t);
  return out.sort((a, b) => a - b);
}

// ---- 多个关键帧（第三轮：多选、框选、整体拖动、缩放时间、复制粘贴、对齐）----

/** 一个关键帧的地址：图层、属性和它的时刻（按时刻认，增删之后下标会变） */
export interface KeyRef {
  layer: string;
  prop: AnimProp;
  t: number;
}

export const sameKey = (a: KeyRef, b: KeyRef) => a.layer === b.layer && a.prop === b.prop && Math.abs(a.t - b.t) < KEY_EPSILON;

/** 把一组关键帧整体挪 dt 秒（夹在 [0, 时长]）。整组挪不进去或会和同一条轨道上别的关键帧重合时返回 null（不动） */
export function shiftKeys(doc: AnimationDoc, refs: readonly KeyRef[], dt: number, duration: number): { doc: AnimationDoc; refs: KeyRef[] } | null {
  return transformKeys(doc, refs, (t) => t + dt, duration);
}

/** 以 pivot 为中心把一组关键帧的时刻乘以 factor（缩放时间）；同上，挪不进去时返回 null */
export function scaleKeys(doc: AnimationDoc, refs: readonly KeyRef[], pivot: number, factor: number, duration: number): { doc: AnimationDoc; refs: KeyRef[] } | null {
  if (!(factor > 0) || !Number.isFinite(factor)) return null;
  return transformKeys(doc, refs, (t) => pivot + (t - pivot) * factor, duration);
}

/** 对齐：一组关键帧整体挪到最早的那个落在 to 上 */
export function alignKeys(doc: AnimationDoc, refs: readonly KeyRef[], to: number, duration: number): { doc: AnimationDoc; refs: KeyRef[] } | null {
  if (refs.length === 0) return null;
  const first = Math.min(...refs.map((r) => r.t));
  return shiftKeys(doc, refs, to - first, duration);
}

/** 每个关键帧对齐到最近的帧 */
export function snapKeysToFrames(doc: AnimationDoc, refs: readonly KeyRef[], fps: number, duration: number): { doc: AnimationDoc; refs: KeyRef[] } | null {
  return transformKeys(doc, refs, (t) => Math.round(t * fps) / fps, duration);
}

function transformKeys(doc: AnimationDoc, refs: readonly KeyRef[], f: (t: number) => number, duration: number): { doc: AnimationDoc; refs: KeyRef[] } | null {
  const next = structuredClone(doc);
  const moved: KeyRef[] = [];
  // 按轨道分组：同一条轨道上选中的关键帧一起挪，没选中的不动
  const groups = new Map<string, KeyRef[]>();
  for (const r of refs) groups.set(`${r.layer}\u0000${r.prop}`, [...(groups.get(`${r.layer}\u0000${r.prop}`) ?? []), r]);
  for (const list of groups.values()) {
    const layer = next.layers.find((l) => l.id === list[0]!.layer);
    const track = layer?.props[list[0]!.prop];
    if (!layer || !isKeyed(track)) return null;
    const keys = track.keys.map((k) => ({ ...k }));
    const selected = new Set<number>();
    for (const r of list) {
      const i = keys.findIndex((k) => Math.abs(k.t - r.t) < KEY_EPSILON);
      if (i >= 0) selected.add(i);
    }
    for (const i of selected) {
      const t = round(f(keys[i]!.t));
      if (t < -1e-9 || t > duration + 1e-9) return null;
      keys[i]!.t = Math.min(duration, Math.max(0, t));
    }
    const sorted = [...keys].sort((a, b) => a.t - b.t);
    if (sorted.some((k, i) => i > 0 && k.t - sorted[i - 1]!.t < KEY_EPSILON)) return null;
    layer.props[list[0]!.prop] = { keys: sorted };
    for (const i of selected) moved.push({ layer: list[0]!.layer, prop: list[0]!.prop, t: keys[i]!.t });
  }
  return { doc: next, refs: moved };
}

/** 删一组关键帧（删空的轨道变回最后那个值的常量） */
export function deleteKeys(doc: AnimationDoc, refs: readonly KeyRef[]): AnimationDoc {
  const next = structuredClone(doc);
  for (const l of next.layers) {
    for (const prop of Object.keys(l.props) as AnimProp[]) {
      const track = l.props[prop];
      if (!isKeyed(track)) continue;
      const rest = track.keys.filter((k) => !refs.some((r) => r.layer === l.id && r.prop === prop && Math.abs(r.t - k.t) < KEY_EPSILON));
      if (rest.length === track.keys.length) continue;
      l.props[prop] = rest.length > 0 ? { keys: rest } : track.keys.at(-1)!.v;
    }
  }
  return next;
}

/** 复制出来的关键帧：时刻相对最早的那一个；带着原来的图层和属性，粘贴时可以换到别的图层、别的属性 */
export interface KeyClipboard {
  kind: 'allay-keys';
  version: 1;
  keys: { layer: string; prop: AnimProp; dt: number; v: Keyframe['v']; ease?: AnimEasing }[];
}

export function copyKeys(doc: AnimationDoc, refs: readonly KeyRef[]): KeyClipboard | null {
  const out: KeyClipboard['keys'] = [];
  for (const r of refs) {
    const track = doc.layers.find((l) => l.id === r.layer)?.props[r.prop];
    const k = keysOf(track).find((x) => Math.abs(x.t - r.t) < KEY_EPSILON);
    if (k) out.push({ layer: r.layer, prop: r.prop, dt: k.t, v: k.v, ...(k.ease !== undefined ? { ease: k.ease } : {}) });
  }
  if (out.length === 0) return null;
  const t0 = Math.min(...out.map((k) => k.dt));
  for (const k of out) k.dt = round(k.dt - t0);
  return { kind: 'allay-keys', version: 1, keys: out };
}

/**
 * 粘贴到 at 秒。目标：
 * - 给了 layers：复制时只有一个图层的，粘到每个目标图层的同名属性；多个图层的按原图层粘（目标被忽略）。
 * - 给了 prop：复制时只有一条属性的，换成这条属性（跨属性粘贴）。
 * 同一时刻已有关键帧的覆盖。超出时长的丢掉。返回新文档和粘出来的关键帧。
 */
export function pasteKeys(doc: AnimationDoc, clip: KeyClipboard, at: number, duration: number, target: { layers?: readonly string[]; prop?: AnimProp } = {}): { doc: AnimationDoc; refs: KeyRef[] } {
  const next = structuredClone(doc);
  const srcLayers = [...new Set(clip.keys.map((k) => k.layer))];
  const srcProps = [...new Set(clip.keys.map((k) => k.prop))];
  const refs: KeyRef[] = [];
  const destLayers = (layer: string) => (srcLayers.length === 1 && target.layers && target.layers.length > 0 ? target.layers : [layer]);
  const destProp = (prop: AnimProp) => (srcProps.length === 1 && target.prop ? target.prop : prop);
  for (const k of clip.keys) {
    const t = round(at + k.dt);
    if (t > duration + 1e-9) continue;
    for (const layerId of destLayers(k.layer)) {
      const layer = next.layers.find((l) => l.id === layerId);
      if (!layer) continue;
      const prop = destProp(k.prop);
      const track = layer.props[prop];
      const keys = isKeyed(track) ? track.keys.filter((x) => Math.abs(x.t - t) >= KEY_EPSILON).map((x) => ({ ...x })) : [];
      keys.push({ t, v: k.v, ...(k.ease !== undefined ? { ease: k.ease } : {}) });
      layer.props[prop] = { keys: keys.sort((a, b) => a.t - b.t) };
      refs.push({ layer: layerId, prop, t });
    }
  }
  return { doc: next, refs };
}

/** 时间轴上的吸附：t 附近 tolerance 秒内有吸附点就吸过去（最近的），否则不动 */
export function snapTime(t: number, points: readonly number[], tolerance: number): number {
  let best = t;
  let dist = tolerance;
  for (const p of points) {
    const d = Math.abs(p - t);
    if (d <= dist) {
      dist = d;
      best = p;
    }
  }
  return best;
}

// ---- 曲线（第三轮：图表编辑器）----

/**
 * 一段（第 i 个关键帧到下一个）的贝塞尔手柄：缓动的三次贝塞尔控制点（0–1 归一化）。
 * 预设名的缓动没有对应的控制点（弹性、回弹等不是一条三次贝塞尔），返回 null，界面上画曲线、不给手柄，
 * 拖手柄时先换成同样起止的近似贝塞尔（easeToBezier）。
 */
const BEZIER_OF: Partial<Record<string, readonly [number, number, number, number]>> = {
  linear: [0, 0, 1, 1],
  quadIn: [0.11, 0, 0.5, 0],
  quadOut: [0.5, 1, 0.89, 1],
  quadInOut: [0.45, 0, 0.55, 1],
  cubicIn: [0.32, 0, 0.67, 0],
  cubicOut: [0.33, 1, 0.68, 1],
  cubicInOut: [0.65, 0, 0.35, 1],
  quartIn: [0.5, 0, 0.75, 0],
  quartOut: [0.25, 1, 0.5, 1],
  quartInOut: [0.76, 0, 0.24, 1],
  quintIn: [0.64, 0, 0.78, 0],
  quintOut: [0.22, 1, 0.36, 1],
  quintInOut: [0.83, 0, 0.17, 1],
  expoIn: [0.7, 0, 0.84, 0],
  expoOut: [0.16, 1, 0.3, 1],
  expoInOut: [0.87, 0, 0.13, 1],
  circIn: [0.55, 0, 1, 0.45],
  circOut: [0, 0.55, 0.45, 1],
  circInOut: [0.85, 0, 0.15, 1],
  backIn: [0.36, 0, 0.66, -0.56],
  backOut: [0.34, 1.56, 0.64, 1],
  backInOut: [0.68, -0.6, 0.32, 1.6],
};

/** 缓动对应的控制点：贝塞尔原样；有近似的预设名给近似；hold、弹性、回弹为 null */
export function easeToBezier(ease: AnimEasing | undefined): readonly [number, number, number, number] | null {
  if (ease === undefined) return [0, 0, 1, 1];
  if (Array.isArray(ease)) return ease as unknown as readonly [number, number, number, number];
  return BEZIER_OF[ease as string] ?? null;
}

/** 改第 index 段的控制点（x 夹在 0–1，y 夹在 -2–3；四位小数） */
export function setSegmentBezier(track: Track | undefined, index: number, bezier: readonly [number, number, number, number]): Track | null {
  const keys = keysOf(track);
  if (!keys[index] || !keys[index + 1]) return null;
  const c = (x: number, lo: number, hi: number) => round(Math.min(hi, Math.max(lo, x)));
  const b: [number, number, number, number] = [c(bezier[0], 0, 1), c(bezier[1], -2, 3), c(bezier[2], 0, 1), c(bezier[3], -2, 3)];
  return setKeyEase(track, index, b);
}

/** 曲线的导数（速度曲线用）：数值差分，h 是步长（秒） */
export function trackSpeed(track: ResolvedTrack | undefined, fallback: number, t: number, ease: EaseEval, h = 1 / 240): number {
  return (sampleTrack(track, fallback, t + h, ease) - sampleTrack(track, fallback, t - h, ease)) / (2 * h);
}

/**
 * 曲线视图里拖动一组关键帧：时刻整体挪 dt，数值整体加 dv。绑定到参数的值不在这里改（只动时刻），
 * 改参数的默认值走属性面板。挪出时长或和同一条轨道上别的关键帧重合时返回 null（不动）。
 */
export function moveKeysAndValues(base: AnimationDoc, refs: readonly KeyRef[], dt: number, dv: number, duration: number): { doc: AnimationDoc; refs: KeyRef[] } | null {
  const next = structuredClone(base);
  const out: KeyRef[] = [];
  for (const l of next.layers) {
    for (const prop of ANIM_PROPS) {
      const track = l.props[prop];
      if (!isKeyed(track)) continue;
      const mine = refs.filter((r) => r.layer === l.id && r.prop === prop);
      if (mine.length === 0) continue;
      for (const k of track.keys) {
        if (!mine.some((r) => Math.abs(r.t - k.t) < KEY_EPSILON)) continue;
        const t = round(k.t + dt);
        if (t < -1e-9 || t > duration + 1e-9) return null;
        k.t = Math.min(duration, Math.max(0, t));
        if (!isParamRef(k.v)) k.v = round(k.v + dv);
        out.push({ layer: l.id, prop, t: k.t });
      }
      track.keys.sort((a, b) => a.t - b.t);
      if (track.keys.some((k, i) => i > 0 && k.t - track.keys[i - 1]!.t < KEY_EPSILON)) return null;
    }
  }
  return { doc: next, refs: out };
}
