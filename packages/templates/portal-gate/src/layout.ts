// 017 传送门穿越的纯函数部分：4 × 5 门框的格子和搭建顺序、阶段里各步的时间、镜头推到多近传送门正好铺满画面、穿过时碎片怎么散开。
// 不依赖 ctx，验收测试直接导入（tests/unit/T-TPL-C017.portal-gate.test.ts）。

/** 最小的下界传送门框：外框 4 × 5（里面 2 × 3），连四个角共 14 块（游戏里角可以不放，这里放上） */
export const FRAME_W = 4;
export const FRAME_H = 5;

export type BuildOrder = 'bottomUp' | 'clockwise' | 'random';
export const BUILD_ORDERS: readonly BuildOrder[] = ['bottomUp', 'clockwise', 'random'];

/** 门框的格子（以格计，原点在门框中心，+y 向上） */
export interface FrameCell {
  x: number;
  y: number;
}

/**
 * 门框 14 块按搭建顺序排好：
 * - bottomUp：像玩家搭门框，先铺底下一排（从左到右），再两边的柱子交替往上，最后封顶（从左到右）；
 * - clockwise：从左下角起，沿左边往上、顶上往右、右边往下、底下往左，绕一圈；
 * - random：按随机数 r（14 个 [0, 1)）打乱。
 */
export function frameCells(order: BuildOrder, r: readonly number[] = []): FrameCell[] {
  const xs = [-1.5, -0.5, 0.5, 1.5];
  const bottom = xs.map((x) => ({ x, y: -2 }));
  const top = xs.map((x) => ({ x, y: 2 }));
  const left = [-1, 0, 1].map((y) => ({ x: -1.5, y }));
  const right = [-1, 0, 1].map((y) => ({ x: 1.5, y }));
  if (order === 'clockwise') {
    // 左下角 → 左边往上 → 左上角 → 顶上往右 → 右边往下 → 右下角 → 底下往左
    return [bottom[0]!, ...left, top[0]!, top[1]!, top[2]!, top[3]!, ...[...right].reverse(), bottom[3]!, bottom[2]!, bottom[1]!];
  }
  const build = [...bottom, left[0]!, right[0]!, left[1]!, right[1]!, left[2]!, right[2]!, ...top];
  if (order === 'random') {
    return build.map((c, i) => ({ c, k: r[i] ?? i / 14 })).sort((a, b) => a.k - b.k).map((e) => e.c);
  }
  return build;
}

/** 进入阶段里各步占的比例：搭框、点火（传送门亮起）、推镜头 */
export interface InSchedule {
  /** 搭框：每块的放置在 [0, buildEnd] 里均匀铺开 */
  buildEnd: number;
  /** 点火的时刻 */
  ignite: number;
  /** 传送门从下往上亮起的时长 */
  light: number;
  /** 推镜头从这里开始，到 1 结束 */
  zoomStart: number;
}

/** igniteAt 是点火的时刻在进入阶段里的位置（0.3–0.8）；搭框在它之前 5% 结束，传送门亮起后开始推镜头 */
export function inSchedule(igniteAt: number): InSchedule {
  const ignite = Math.min(0.8, Math.max(0.3, igniteAt));
  const light = 0.07;
  return { buildEnd: ignite - 0.05, ignite, light, zoomStart: ignite + light };
}

/**
 * 镜头离传送门多近时传送门（里面 2 × 3 格）正好铺满画面：垂直视角 fov、宽高比 aspect，格子边长 size。
 * 留 3% 的余量（宽、高都只用到传送门的 97%）。
 */
export function coverDistance(size: number, fovDeg: number, aspect: number): number {
  const t = Math.tan((fovDeg * Math.PI) / 360);
  const byWidth = (0.97 * size) / (t * aspect);
  const byHeight = (0.97 * 1.5 * size) / t;
  return Math.min(byWidth, byHeight);
}

/**
 * 门框的格子边长：门框（4 × 5）的高占画面高的 66%，竖屏时再限制宽不超过画面宽的 80%。
 */
export function frameSize(width: number, height: number): number {
  return Math.min((0.66 * height) / FRAME_H, (0.8 * width) / FRAME_W);
}

/** 传送门分成的碎片：每格 4 × 4 块，里面 2 × 3 格一共 8 × 12 块 */
export const TILE_DIV = 4;

/**
 * 穿过传送门时一块碎片的位置：从 (x, y) 沿离开中心的方向往外飞 reach，同时朝镜头走 depth；
 * e 是这块碎片自己的进度（已缓动）。返回 (x, y, z)。
 */
export function scatter(x: number, y: number, dirX: number, dirY: number, reach: number, depth: number, e: number): [number, number, number] {
  return [x + dirX * reach * e, y + dirY * reach * e, depth * e];
}
