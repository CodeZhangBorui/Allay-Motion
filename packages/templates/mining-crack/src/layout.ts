// 007 挖掘裂纹的纯函数部分：放置和挖掘的先后、裂纹的级数、各段时间的分配、碎屑的数量和初速度。
// 不依赖 ctx，验收测试直接导入（tests/unit/T-TPL-C007.mining-crack.test.ts）。

/** 游戏里每秒 20 刻 */
export const TICK = 1 / 20;
/** 裂纹的级数（destroy_stage_0 … destroy_stage_9） */
export const CRACK_STAGES = 10;
/** 挖掘时每 4 刻放一次敲击声 */
export const HIT_INTERVAL = 4 * TICK;
/** 放置时一块方块“落位”的时长（秒）：游戏里方块是直接出现的，这里留 2 刻多一点的弹出 */
export const POP_TIME = 0.12;
/** 实例总数的预算（02-engine.md 2.11）：方块、垫底、裂纹各占一份，余下的给碎屑，碎屑最多 3000 */
export const INSTANCE_BUDGET = 5000;
export const DEBRIS_BUDGET = 3000;

export type PlaceOrder = 'buildUp' | 'columns' | 'centerOut' | 'diagonal' | 'random';
export const PLACE_ORDERS: readonly PlaceOrder[] = ['buildUp', 'columns', 'centerOut', 'diagonal', 'random'];

export type BreakOrder = 'random' | 'centerOut' | 'edgesIn' | 'topToBottom' | 'bottomToTop' | 'leftToRight' | 'together' | 'reverse';
export const BREAK_ORDERS: readonly BreakOrder[] = ['random', 'centerOut', 'edgesIn', 'topToBottom', 'bottomToTop', 'leftToRight', 'together', 'reverse'];

/**
 * 放置的先后：按格子（i = r × cols + c，r = 0 是最上一行）给出 0–1 的顺序值，0 最先。
 * - buildUp：像玩家砌墙，从最下一行开始一行行往上，每行换一次方向（蛇形）；
 * - columns：一列列从左到右，每列从下往上；
 * 其余三种用 block-kit 的图案（调用方传进来），这里只做前两种。
 */
export function builderOrder(order: 'buildUp' | 'columns', cols: number, rows: number): Float64Array {
  const n = cols * rows;
  const u = new Float64Array(n);
  for (let r = 0; r < rows; r++) {
    const up = rows - 1 - r;
    for (let c = 0; c < cols; c++) {
      const rank = order === 'buildUp' ? up * cols + (up % 2 === 0 ? c : cols - 1 - c) : c * rows + up;
      u[r * cols + c] = n > 1 ? rank / (n - 1) : 0;
    }
  }
  return u;
}

/** 放置时的缩放：从 0.6 弹到略大于 1 再落定（p 是这块方块自己的进度） */
export function placeScale(p: number, backOut: (x: number) => number): number {
  if (p <= 0) return 0;
  if (p >= 1) return 1;
  return 0.6 + 0.4 * backOut(p);
}

/** 退出阶段的时间分配：每块方块的开始时刻散布在 spread 里，裂纹走 crack 秒，碎屑最长活 life 秒，三段之和不超过阶段长度 */
export interface BreakTiming {
  spread: number;
  crack: number;
  life: number;
}

export function breakTiming(outLen: number, crackTime: number, together: boolean): BreakTiming {
  const len = Math.max(1e-4, outLen);
  const crack = Math.min(Math.max(0.02, crackTime), 0.6 * len);
  const life = Math.min(0.7, 0.45 * len, len - crack);
  const rest = Math.max(0, len - crack - life);
  // together：所有方块差不多同时开挖，只留一点错落（最多 0.12 秒）
  const spread = together ? Math.min(rest, 0.12) : rest;
  return { spread, crack, life };
}

/** 时刻 t 这块方块的状态：-1 还没开挖，0–9 裂纹的级数，10 已经碎了 */
export function crackStage(t: number, start: number, crack: number): number {
  if (t < start) return -1;
  if (t >= start + crack) return CRACK_STAGES;
  return Math.min(CRACK_STAGES - 1, Math.floor(((t - start) / crack) * CRACK_STAGES));
}

/** 挖一块方块时的敲击声时刻：开挖时一下，之后每 4 刻一下，碎之前为止 */
export function hitTimes(start: number, crack: number): number[] {
  const out: number[] = [];
  for (let t = start; t < start + crack - 1e-6; t += HIT_INTERVAL) out.push(t);
  return out;
}

/** 每块方块的碎屑数：参数给的数，总数超过预算时减少（方块多的时候每块少几片） */
export function debrisPerBlock(debris: number, blocks: number): number {
  if (blocks <= 0) return 0;
  const budget = Math.min(DEBRIS_BUDGET, INSTANCE_BUDGET - 3 * blocks);
  return Math.max(0, Math.min(Math.round(debris), Math.floor(budget / blocks)));
}

/**
 * 碎屑的初速度（以方块边长 / 秒计），照游戏里方块碎裂时的粒子：方向是从方块中心指向出生点再加一点随机，
 * 速率 (r1 + r2 + 1) × 0.15 × 0.4 格每刻，竖直方向另加 0.1 格每刻。r 是 [0, 1) 的随机数。
 */
export function debrisVelocity(ox: number, oy: number, oz: number, r: readonly number[]): [number, number, number] {
  let dx = ox + (r[0]! * 2 - 1) * 0.4;
  let dy = oy + (r[1]! * 2 - 1) * 0.4;
  let dz = oz + (r[2]! * 2 - 1) * 0.4;
  const len = Math.hypot(dx, dy, dz) || 1;
  const speed = (r[3]! + r[4]! + 1) * 0.15 * 0.4 * 20;
  dx = (dx / len) * speed;
  dy = (dy / len) * speed + 0.1 * 20;
  dz = (dz / len) * speed;
  return [dx, dy, dz];
}

/**
 * 碎屑的重力（格 / 秒²）和阻力（每刻速度乘 0.98）。游戏里方块粒子的重力是 0.04 格每刻²（16 格 / 秒²），
 * 这里加到 1.5 倍：方块在画面上很大，照原值碎屑半秒只落半格，看上去像悬着的灰尘
 */
export const DEBRIS_GRAVITY = 1.5 * 0.04 * 20 * 20;
export const DEBRIS_DRAG = -20 * Math.log(0.98);
