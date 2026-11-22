// 094 故障色块：覆盖率随时间怎么走（一阵阵闪出来、越来越多，退出时一阵阵消失），每一步的抖动。
// 不依赖 ctx 的纯函数，验收测试直接导入。

/** 第 k 阵（0 起）在阶段里的位置：均匀分布，最后一阵也留出余地涨满 */
export function burstAt(k: number, bursts: number): number {
  const n = Math.max(1, Math.floor(bursts));
  return ((k + 0.35) / (n + 0.35)) * 0.9;
}

/** 一阵闪的形状：瞬间到顶，很快落回去（不是落到 0，底子还在往上涨） */
function flash(x: number): number {
  return x < 0 ? 0 : Math.exp(-x / 0.05);
}

/**
 * 进入阶段的覆盖率（0–1）：底子按 p^1.6 涨，每一阵在它上面猛地多出一截再回落；第 k 阵比前一阵更强。
 * p ≤ 0 时为 0，p ≥ 1 时为 1（剪辑点前后完全盖满）。
 */
export function coverIn(p: number, bursts: number): number {
  if (p <= 0) return 0;
  if (p >= 1) return 1;
  const n = Math.max(1, Math.floor(bursts));
  let c = Math.pow(p, 1.6);
  for (let k = 0; k < n; k++) c += 0.45 * ((k + 1) / n) * flash(p - burstAt(k, n));
  return Math.min(1, Math.max(0, c));
}

/** 退出阶段：时间上倒过来，一阵阵退下去。b ≤ 0 时为 1，b ≥ 1 时为 0 */
export function coverOut(b: number, bursts: number): number {
  if (b <= 0) return 1;
  if (b >= 1) return 0;
  return coverIn(1 - b, bursts);
}

/** 每一步（floor(t × 步频)）的整数散列，[0, 1)：覆盖率按它抖一下，画面一跳一跳的 */
export function stepJitter(step: number, seed: number): number {
  let x = (Math.imul(step | 0, 0x9e3779b1) ^ Math.imul(seed | 0, 0x85ebca6b)) >>> 0;
  x ^= x >>> 16;
  x = Math.imul(x, 0x7feb352d) >>> 0;
  x ^= x >>> 15;
  x = Math.imul(x, 0x846ca68b) >>> 0;
  x ^= x >>> 16;
  return (x >>> 8) / 16777216;
}

/** 抖动后的覆盖率：两端（0 和 1）不抖，中间乘 0.8–1.2 再钳到 [0, 1] */
export function jittered(cover: number, jitter: number): number {
  if (cover <= 0 || cover >= 1) return cover;
  return Math.min(1, Math.max(0, cover * (0.8 + 0.4 * jitter)));
}
