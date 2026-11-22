// 061 穿云：镜头穿过云层的路线、在云里时整个画面白掉的程度。不依赖 ctx 的纯函数，验收测试直接导入。
// 单位是“格”（方块）：云层在 y = 0 到 4 之间，云块 12 × 12 格一块（凭记忆，见 docs/templates/cloud-pass.md）。

// 没有平飞：游戏里的云只有 4 格厚，平着穿过去只看得到地平线上的一条线（docs/templates/cloud-pass.md 第 5 节）
export type Direction = 'up' | 'down';
export const DIRECTIONS: readonly Direction[] = ['up', 'down'];

export const CLOUD_CELL = 12;
export const CLOUD_HEIGHT = 4;
/** 雾的终点：比它远的云完全看不见 */
export const FOG_END = 220;
/** 抬头（或低头）的角度、竖直视角（度） */
export const PITCH = 32;
export const FOV = 70;

/**
 * 镜头离开的距离：开头、结尾时所有视线碰到云层都要比雾的终点远，云才完全看不见（首末帧全透明）。
 * 往上看时视线最陡是 PITCH + FOV / 2，碰到云层的距离 = 高差 / sin(仰角)。
 */
export function startDistance(): number {
  const steepest = ((PITCH + FOV / 2) * Math.PI) / 180;
  return FOG_END * Math.sin(steepest) + 8;
}

/**
 * 镜头沿穿云方向的位置（格）：p 是进入阶段的进度时从 −D 走到云层中间，退出阶段从中间走到另一边 D 以外。
 * 越靠近云层走得越慢（三次缓出），在云里那一段看得清楚。
 */
export function approach(p: number, distance: number, middle: number): number {
  const k = 1 - Math.pow(1 - Math.min(1, Math.max(0, p)), 3);
  return middle - distance * (1 - k);
}

export function leave(p: number, distance: number, middle: number): number {
  const k = Math.pow(Math.min(1, Math.max(0, p)), 3);
  return middle + distance * k;
}

/**
 * 在云里时整个画面白掉的程度：镜头离云层中间越近越白，剪辑点时（在正中间）为 1。
 * depth 是镜头离云层中间的距离（格），half 是云层的半厚。
 */
export function whiteout(depth: number, half: number): number {
  const x = Math.abs(depth) / (half + 1.5);
  if (x >= 1) return 0;
  return 1 - x * x * (3 - 2 * x);
}
