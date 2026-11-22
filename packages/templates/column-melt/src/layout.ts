// 093 逐列融化：每一列的先后（随机游走，像老游戏的“融化”转场那样相邻的列错落但连续）、
// 每一列前沿和后沿走过的距离。不依赖 ctx 的纯函数，验收测试直接导入。

export type Direction = 'down' | 'up' | 'left' | 'right';
export const DIRECTIONS: readonly Direction[] = ['down', 'up', 'left', 'right'];

export interface Rng {
  next(): number;
}

/**
 * 每一列的延迟（0–variance）：第一列随机，之后每列在前一列的基础上随机走一小步并夹在范围里，
 * 最后整体平移、拉伸到正好从 0 到 variance（最早的一列在阶段一开始就出发，最晚的一列晚 variance）。
 * 相邻的列差得不多，整体又是参差的，比各列独立随机更像在“流”。
 */
export function columnDelays(count: number, variance: number, rng: Rng): Float64Array {
  const n = Math.max(1, Math.floor(count));
  const v = Math.min(0.95, Math.max(0, variance));
  const out = new Float64Array(n);
  let d = rng.next();
  for (let i = 0; i < n; i++) {
    if (i > 0) d = Math.min(1, Math.max(0, d + (rng.next() - 0.5) * 0.45));
    out[i] = d;
  }
  let lo = Infinity;
  let hi = -Infinity;
  for (const x of out) {
    lo = Math.min(lo, x);
    hi = Math.max(hi, x);
  }
  for (let i = 0; i < n; i++) out[i] = hi > lo ? ((out[i]! - lo) / (hi - lo)) * v : 0;
  return out;
}

/** 一列在阶段进度 p 时自己的进度：延迟 d 之后才开始，阶段结束时所有列一起走完 */
export function columnProgress(p: number, d: number): number {
  if (p <= 0) return 0;
  if (p >= 1) return 1;
  return p <= d ? 0 : Math.min(1, (p - d) / (1 - d));
}

/**
 * 前沿（或后沿）离起始边的距离：f 是缓动后的列进度（0–1），从 from 走到 to。
 * 前沿从 −pad 出发（列中心的尖端刚好在画外，一开始就看得见在动），后沿从 −(drip + pad) 出发（尾巴的两侧也在画外）；
 * 两者都走到 length + drip + pad + trail：连末端的形状、前沿后面的光泽（trail，离前沿最远 SHEEN_REACH 个列宽）也出了画面，
 * 剪辑点时边上不留一道亮线。pad 是抗锯齿软边的余量。
 */
export function travel(f: number, from: number, to: number): number {
  return from + f * (to - from);
}

export interface TravelRange {
  leadFrom: number;
  tailFrom: number;
  to: number;
}

/** 前沿后面的亮线、暗边离前沿最远多少（列宽的倍数） */
export const SHEEN_REACH = 0.4;

export function travelRange(length: number, drip: number, pad: number, trail = 0): TravelRange {
  return { leadFrom: -pad, tailFrom: -(drip + pad), to: length + drip + pad + trail };
}
