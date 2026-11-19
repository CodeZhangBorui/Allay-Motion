// 对动画文档的小步修改（可视化编辑和类型化命令共用；docs/animation-editor.md 第 6 节）。
// 都是纯函数：输入一条轨道，返回新的轨道；不合法的结果由调用方用 schema 再校验一次。
import { PROP_DEFAULTS, type AnimEasing, type AnimProp, type Keyframe, type Layer, type Track } from './schema';

/** 两个时刻算同一个关键帧的容差（秒）：小于 60 fps 的半帧 */
export const KEY_EPSILON = 1 / 240;

export type EaseEval = (ease: AnimEasing | undefined) => (x: number) => number;

/** 按 t 求值；与 runtime.template.js 的 sample 是同一套规则（T-ANIM-2 核对两边一致） */
export function sampleTrack(track: Track | undefined, fallback: number, t: number, ease: EaseEval): number {
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

export function propValue(layer: Layer, prop: AnimProp, t: number, ease: EaseEval): number {
  return sampleTrack(layer.props[prop], PROP_DEFAULTS[prop], t, ease);
}

export function keysOf(track: Track | undefined): readonly Keyframe[] {
  return track !== undefined && typeof track === 'object' ? track.keys : [];
}

export function keyIndexAt(track: Track | undefined, t: number): number {
  return keysOf(track).findIndex((k) => Math.abs(k.t - t) < KEY_EPSILON);
}

const round = (x: number, digits = 4) => Math.round(x * 10 ** digits) / 10 ** digits;

/**
 * 在 t 处把属性设成 v（自动关键帧）：没有关键帧的属性直接改常量；有关键帧的，t 处有就改它，没有就插一个
 * （缓动沿用前一个关键帧的）。
 */
export function setValueAt(track: Track | undefined, t: number, v: number): Track {
  const value = round(v);
  if (track === undefined || typeof track === 'number') return value;
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
  return rest.length === 0 ? keys[index]!.v : { keys: rest.map((k) => ({ ...k })) };
}

/** 一个图层全部关键帧的时刻（去重、排序）：时间轴上图层那一行的菱形 */
export function layerKeyTimes(layer: Layer): number[] {
  const out: number[] = [];
  for (const track of Object.values(layer.props)) for (const k of keysOf(track)) if (!out.some((x) => Math.abs(x - k.t) < KEY_EPSILON)) out.push(k.t);
  return out.sort((a, b) => a - b);
}
