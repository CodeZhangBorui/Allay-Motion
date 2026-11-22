// 066 烧穿：火线往上推进的位置、烧穿的先后（阈值场）、边缘发光的映射、火星的出生时刻。
// 不依赖 ctx 的纯函数，验收测试直接导入。

/** 火线的起伏：几个正弦叠起来（系数在 setup 里随机定好），值在 [−1, 1] */
export interface WaveTerm {
  k: number;
  phase: number;
  amp: number;
}

export function frontWave(x: number, terms: readonly WaveTerm[]): number {
  let s = 0;
  let a = 0;
  for (const w of terms) {
    s += w.amp * Math.sin(w.k * x + w.phase);
    a += Math.abs(w.amp);
  }
  return a > 0 ? s / a : 0;
}

export interface FrontRange {
  /** 进度为 0、1 时火线基准的高度（设计单位，+y 向上） */
  from: number;
  to: number;
}

/**
 * 火线基准走过的范围：进度 0 时火线连同上面的火苗都在画面下边以外，进度 1 时火线和火苗都在画面上边以外，
 * 起伏 amp、火苗高 flame、发光带 glow、余量 pad 都算进去。火线 y = 基准 + amp × 起伏。
 */
export function frontRange(halfH: number, amp: number, flame: number, glow: number, pad: number): FrontRange {
  return { from: -halfH - amp - flame - pad, to: halfH + amp + glow + flame + pad };
}

export function frontAt(x: number, p: number, range: FrontRange, amp: number, terms: readonly WaveTerm[]): number {
  return range.from + (range.to - range.from) * p + amp * frontWave(x, terms);
}

/**
 * 退出阶段的阈值：每格的烧穿时刻 h ∈ [0, 1]。进度 b 映射成 P = b(1 + w + ε) − w：
 * h < P 的格子已经烧穿；P ≤ h < P + w 的格子正在发光（离 P 越近越亮）。b = 0 时没有一格烧穿、也没有一格发光，
 * b = 1 时全部烧穿（同 pixel-dissolve 的做法，docs/decisions.md M6a）。
 */
export function burnThreshold(b: number, rim: number): number {
  if (b <= 0) return -rim;
  if (b >= 1) return 1 + 1e-3;
  return b * (1 + rim + 1e-3) - rim;
}

/** 把一组原始值线性归一化到 [0, 1]（原地） */
export function normalize(values: Float32Array): void {
  let lo = Infinity;
  let hi = -Infinity;
  for (const v of values) {
    lo = Math.min(lo, v);
    hi = Math.max(hi, v);
  }
  for (let i = 0; i < values.length; i++) values[i] = hi > lo ? (values[i]! - lo) / (hi - lo) : 0;
}

/**
 * 阈值 h 的格子在退出阶段什么时候开始发光、什么时候烧穿（阶段进度）：P(b) = h 时烧穿，P(b) = h − w 时开始发光。
 * 用来让火星从正在烧穿的边上冒出来。
 */
export function burnProgress(h: number, rim: number): { glowAt: number; burnAt: number } {
  const span = 1 + rim + 1e-3;
  return { glowAt: Math.max(0, h / span), burnAt: Math.min(1, (h + rim) / span) };
}
