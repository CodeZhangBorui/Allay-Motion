// 008 活塞合拢的纯函数部分：格子的排法、每一排的“送料”时间表（按刻算）、活塞头和方块在某一刻的位置。
// 不依赖 ctx，验收测试直接导入（tests/unit/T-TPL-C008.piston-push.test.ts）。
//
// 一排从外往里的格子编号 c = 0（挨着画面中线）… m − 1（最外一格，活塞在这里）。每一排的动作（以“刻”计）：
//   1. 活塞从画外（第 m 格）滑进第 m − 1 格，2 刻；
//   2. 第 j 块方块（j = 1 … m − 1）在活塞前面（第 m − 2 格）出现，1 刻；
//   3. 除了最后一块，放完之后活塞伸出 2 刻（方块整排往里推一格）、收回 2 刻（游戏里活塞伸出、收回各 2 刻）。
// 第 j 块方块被它之后的每一次推送推一格，最后停在第 j − 1 格：第 1 块到中线，两边的第 1 块在最后一推时撞在一起。
// 退出是这个过程倒着放：粘性活塞伸出够到方块、收回把整排拉出去一格、最外的方块消失……

export type Axis = 'auto' | 'horizontal' | 'vertical';
export const AXES: readonly Axis[] = ['auto', 'horizontal', 'vertical'];

/** 活塞伸出、收回各 2 刻，放一块方块 1 刻，活塞滑进来 2 刻 */
export const PUSH_TICKS = 2;
export const PLACE_TICKS = 1;
export const SLIDE_TICKS = 2;

export interface PistonGrid {
  /** 推的方向沿 x（左右两边推向中间）还是 y（上下两边） */
  horizontal: boolean;
  /** 格子边长（设计单位） */
  size: number;
  /** 排数（每边几个活塞） */
  rows: number;
  /** 每边从中线到边上的格数（含活塞那一格） */
  cells: number;
}

/** 每边至少几格（两块方块 + 活塞）：少于这个数时活塞只推一次或不推，看不出是活塞在推 */
export const MIN_CELLS = 3;

/**
 * 格子：rows 排铺满垂直于推送方向的那一边（多 1%，边上不露缝），格子边长 = 那一边 × 1.01 / 排数；
 * 每边从中线往外 ceil(半边长 / 边长) 格，最外一格是活塞（可能有一部分在画外）。
 * 格数不到 MIN_CELLS 时（方屏、排数少）自动多加几排、格子变小。auto 沿长边推：横屏左右、竖屏上下（方屏左右）。
 */
export function pistonGrid(width: number, height: number, axis: Axis, rows: number): PistonGrid {
  const horizontal = axis === 'horizontal' || (axis === 'auto' && width >= height);
  const along = horizontal ? width : height;
  const across = horizontal ? height : width;
  let r = Math.max(1, Math.round(rows));
  let size = (across * 1.01) / r;
  while (Math.ceil(along / 2 / size) < MIN_CELLS && r < 64) {
    r++;
    size = (across * 1.01) / r;
  }
  return { horizontal, size, rows: r, cells: Math.ceil(along / 2 / size) };
}

/** 一排的动作共多少刻：滑进 2 + 放 (m − 1) 块 + 推 (m − 2) 次（每次伸出、收回共 4 刻） */
export function rowTicks(cells: number): number {
  return SLIDE_TICKS + (cells - 1) * PLACE_TICKS + Math.max(0, cells - 2) * 2 * PUSH_TICKS;
}

/** 第 j 块方块（从 1 起）出现的时刻（刻） */
export function placeTick(j: number): number {
  return SLIDE_TICKS + (j - 1) * (PLACE_TICKS + 2 * PUSH_TICKS);
}

const clamp01 = (x: number): number => (x <= 0 ? 0 : x >= 1 ? 1 : x);

export interface RowState {
  /** 活塞底座所在的格（可以是小数：滑进来的途中） */
  pistonCell: number;
  /** 活塞头伸出的格数（0 收回，1 伸出一格） */
  head: number;
  /** 每块方块所在的格（第 j 块是下标 j − 1）；还没出现的是 NaN */
  blockCell: Float64Array;
  /** 每块方块的出现进度（0–1；1 是完全出现） */
  blockPop: Float64Array;
}

/**
 * 一排在第 tau 刻的样子（进入阶段；退出阶段用 rowTicks − tau 倒着取）。
 * 推送是匀速的（游戏里活塞每刻走 0.5 格，伸出、收回都是两刻的硬推），方块和活塞头一起走。
 */
export function rowState(tau: number, cells: number, out: RowState): RowState {
  const m = cells;
  out.pistonCell = m - clamp01(tau / SLIDE_TICKS);
  out.head = 0;
  const pushes = Math.max(0, m - 2);
  for (let j = 1; j <= m - 1; j++) {
    const tj = placeTick(j);
    if (tau < tj) {
      out.blockCell[j - 1] = Number.NaN;
      out.blockPop[j - 1] = 0;
      continue;
    }
    out.blockPop[j - 1] = clamp01((tau - tj) / PLACE_TICKS);
    // 第 j 块之后的每一次推送（第 k 次推送紧跟着第 k 块的放置）
    let shift = 0;
    for (let k = j; k <= pushes; k++) shift += clamp01((tau - placeTick(k) - PLACE_TICKS) / PUSH_TICKS);
    out.blockCell[j - 1] = m - 2 - shift;
  }
  for (let k = 1; k <= pushes; k++) {
    const start = placeTick(k) + PLACE_TICKS;
    if (tau >= start && tau < start + 2 * PUSH_TICKS) {
      out.head = tau < start + PUSH_TICKS ? clamp01((tau - start) / PUSH_TICKS) : 1 - clamp01((tau - start - PUSH_TICKS) / PUSH_TICKS);
    }
  }
  return out;
}

export function emptyRowState(cells: number): RowState {
  return { pistonCell: cells, head: 0, blockCell: new Float64Array(Math.max(1, cells - 1)), blockPop: new Float64Array(Math.max(1, cells - 1)) };
}

/** 第 k 次推送开始伸出、开始收回的时刻（刻），k 从 1 起 */
export function pushTicks(cells: number): { extend: number; retract: number }[] {
  const out: { extend: number; retract: number }[] = [];
  for (let k = 1; k <= Math.max(0, cells - 2); k++) {
    const start = placeTick(k) + PLACE_TICKS;
    out.push({ extend: start, retract: start + PUSH_TICKS });
  }
  return out;
}

/**
 * 每一排开始的先后：stagger = 0 时所有排同时动，1 时后一排在前一排做到一半时开始。
 * 返回每排的开始时刻（占阶段的比例）和一排动作的长度（占阶段的比例）；最后一排恰好在 1 做完。
 */
export function rowSchedule(rows: number, stagger: number): { start: Float64Array; length: number } {
  const s = clamp01(stagger);
  const n = Math.max(1, rows);
  // 第 r 排比第 0 排晚 r × gap；最后一排结束在 1：(n − 1) × gap + length = 1，gap = s × length / 2
  const length = 1 / (1 + (n - 1) * s * 0.5);
  const gap = n > 1 ? (1 - length) / (n - 1) : 0;
  return { start: Float64Array.from({ length: n }, (_, r) => r * gap), length };
}
