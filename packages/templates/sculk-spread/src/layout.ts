// 015 幽匿蔓延：每一格什么时候变成幽匿（从几个起点按带随机权重的最短路蔓延，成片、边缘参差），
// 进度到阈值的映射，退去的顺序。不依赖 ctx 的纯函数，验收测试直接导入。

export interface Rng {
  next(): number;
}

/**
 * 网格上从 seeds（格子序号）出发的最短路距离，四邻接，每条边的权重是 0.35–1.65 之间的随机数（同一条边两个方向相同），
 * 再归一化到 [0, 1]：起点为 0，最晚变成幽匿的那一格为 1。O(n²) 的简单实现（格子不超过几千个）。
 * unit 是一条平均的边（权重 1）归一化以后有多长，脉络爬过一格用的时间按它定。
 */
export function spreadTimes(cols: number, rows: number, seeds: readonly number[], rng: Rng): { times: Float32Array; unit: number } {
  const n = cols * rows;
  // 边的权重：右边、下边各一条
  const right = new Float32Array(n);
  const down = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    right[i] = 0.35 + 1.3 * rng.next();
    down[i] = 0.35 + 1.3 * rng.next();
  }
  const dist = new Float64Array(n).fill(Infinity);
  const done = new Uint8Array(n);
  for (const s of seeds) if (s >= 0 && s < n) dist[s] = 0;
  for (let k = 0; k < n; k++) {
    let best = -1;
    let bd = Infinity;
    for (let i = 0; i < n; i++) {
      if (!done[i] && dist[i]! < bd) {
        bd = dist[i]!;
        best = i;
      }
    }
    if (best < 0) break;
    done[best] = 1;
    const x = best % cols;
    const y = Math.floor(best / cols);
    const relax = (j: number, w: number) => {
      if (!done[j] && bd + w < dist[j]!) dist[j] = bd + w;
    };
    if (x + 1 < cols) relax(best + 1, right[best]!);
    if (x > 0) relax(best - 1, right[best - 1]!);
    if (y + 1 < rows) relax(best + cols, down[best]!);
    if (y > 0) relax(best - cols, down[best - cols]!);
  }
  let hi = 0;
  for (const d of dist) if (Number.isFinite(d)) hi = Math.max(hi, d);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = Number.isFinite(dist[i]!) && hi > 0 ? dist[i]! / hi : 0;
  return { times: out, unit: hi > 0 ? 1 / hi : 1 };
}

/**
 * 进入阶段：进度 a（0–1）映射成阈值 A = a(1 + 2ε) − ε。格子在 s < A 时已经是幽匿；
 * 脉络从已经变成幽匿的邻格爬进来（还没变的格子 A − s_邻 > 0 的那几条边）。a = 0 时没有一格、也没有脉络，a = 1 时全部是幽匿。
 */
export const EPS = 0.02;
export function spreadThreshold(a: number): number {
  if (a <= 0) return -EPS;
  if (a >= 1) return 1 + EPS;
  return a * (1 + 2 * EPS) - EPS;
}

/** 退去之后脉络还留一会儿（占阈值的宽度） */
export const LINGER = 0.08;

/**
 * 退出阶段：最后变成幽匿的格子最先退去。格子在 1 − s < B 时退去，退了以后脉络再留 LINGER。
 * B = b(1 + 2ε + LINGER) − ε：b = 0 时一格都没退，b = 1 时全部退完、留着的脉络也没了。
 */
export function recedeThreshold(b: number): number {
  if (b <= 0) return -EPS;
  if (b >= 1) return 1 + EPS + LINGER;
  return b * (1 + 2 * EPS + LINGER) - EPS;
}

/**
 * 格子退去的时刻（退出阶段的进度，0–1，不含缓动）：1 − s = B 时退去。灵魂粒子从那时候冒出来。
 */
export function recedeAt(s: number): number {
  return Math.min(1, Math.max(0, (1 - s + EPS) / (1 + 2 * EPS + LINGER)));
}

/** 格子变成幽匿的时刻（进入阶段的进度，不含缓动） */
export function convertAt(s: number): number {
  return Math.min(1, Math.max(0, (s + EPS) / (1 + 2 * EPS)));
}
