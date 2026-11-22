// 011 关门的纯函数部分：门的种类和贴图、门扇的尺寸和排法、关门和开门的角度曲线。
// 不依赖 ctx，验收测试直接导入（tests/unit/T-TPL-C011.door-shut.test.ts）。

/** 门的种类（贴图 block/<种类>_door_top、_bottom）。copper 是 1.21 加的，pale_oak 是 1.21.4 加的 */
export const DOORS = ['oak', 'spruce', 'birch', 'jungle', 'acacia', 'dark_oak', 'mangrove', 'cherry', 'bamboo', 'crimson', 'warped', 'pale_oak', 'iron', 'copper'] as const;
export type Door = (typeof DOORS)[number];

/** 默认的关门、开门音效（木门）；保持默认时按门的种类换成游戏里那种门的音效 */
export const WOODEN_CLOSE = 'minecraft:block.wooden_door.close';
export const WOODEN_OPEN = 'minecraft:block.wooden_door.open';

/** 各种门在游戏里用的音效组（对照过 26.2 和 1.21.1 的 sounds.json；copper_door 1.20.1 没有） */
export function doorSoundFamily(door: Door): string {
  if (door === 'iron') return 'iron_door';
  if (door === 'cherry') return 'cherry_wood_door';
  if (door === 'bamboo') return 'bamboo_wood_door';
  if (door === 'crimson' || door === 'warped') return 'nether_wood_door';
  if (door === 'copper') return 'copper_door';
  return 'wooden_door';
}

/** 参数里的音效：保持木门的默认值时换成这种门的音效；用户改过的照用 */
export function doorSound(value: string | null, door: Door, kind: 'close' | 'open'): string | null {
  const wooden = kind === 'close' ? WOODEN_CLOSE : WOODEN_OPEN;
  if (value !== wooden) return value;
  return `minecraft:block.${doorSoundFamily(door)}.${kind}`;
}

/** 门的厚度：3 个像素（门宽 16 像素） */
export const DOOR_THICKNESS = 3 / 16;

export type DoorLayout = 'auto' | 'double' | 'single';
export const DOOR_LAYOUTS: readonly DoorLayout[] = ['auto', 'double', 'single'];

export interface DoorGrid {
  /** 每行几扇（1 单开，2 对开） */
  leaves: 1 | 2;
  /** 几行（竖屏对开时门不够高，叠两行） */
  rows: number;
  /** 门扇的宽（设计单位）；高是两倍 */
  width: number;
}

/**
 * 门扇的尺寸和排法：门是 1 × 2 格，贴图像素保持正方形，所以门扇宽 = max(每扇该占的宽, 盖满高度要的宽)。
 * auto 在横屏和方屏用对开、竖屏用单开（竖屏对开要叠两行）。门比画面大 1%：门的外沿在画外，剪辑点不露边。
 * 一行对开的门要比半个画面宽出 25% 以上才盖得住高度时，改成叠几行。
 */
export function doorGrid(width: number, height: number, layout: DoorLayout): DoorGrid {
  const leaves: 1 | 2 = layout === 'single' || (layout === 'auto' && width < height) ? 1 : 2;
  const base = width / leaves;
  const needed = (height * 1.01) / 2;
  const rows = needed > base * 1.25 ? Math.ceil(needed / (base * 1.25)) : 1;
  return { leaves, rows, width: Math.max(base * 1.01, needed / rows) };
}

/**
 * 透视（垂直视角，度）的上限：门扇绕门轴转动时扫过一个圆柱，半径是门扇外沿那条棱到门轴的距离 √(L² + T²)；
 * 相机离门轴的水平距离是 cx（单开时门轴在画面左边、相机在中间，cx = L / 2；对开时 cx = L）、离画面 D。
 * 横屏、方屏单开时门扇比画面还宽，视角大（D 小）时相机落在圆柱里，门转到某个角度就扫过相机，
 * 那几帧相机在门扇里面，画面只剩门里垫底的颜色。这里要求相机离门轴比那条棱远 10%，换算成视角的上限；
 * 对开和竖屏单开时上限都在参数范围（60°）以上。height 是舞台高（ctx.createStageCamera 让 z = 0 平面正好铺满它）。
 */
export function maxPerspective(height: number, grid: DoorGrid): number {
  const L = grid.width;
  const reach = 1.1 * Math.hypot(L, L * DOOR_THICKNESS);
  const cx = grid.leaves === 1 ? L / 2 : L;
  const d2 = reach * reach - cx * cx;
  if (d2 <= 0) return 180;
  return (2 * Math.atan(height / 2 / Math.sqrt(d2)) * 180) / Math.PI;
}

/** 关门时门撞上门框的时刻在进入阶段里的位置（其余是回弹） */
export const SLAM_AT = 0.8;

/**
 * 门开到多大的角度（度）就整扇在画面外：门轴在画面边上（或画外），门扇朝相机这一侧转开，
 * 和画面的夹角 θ 满足 tan θ ≥ 2D / W 时整扇门在视锥外（D 是相机到 z = 0 平面的距离，W 是舞台宽）。
 * 再加 3° 的余量（门的厚度在门轴外侧，门轴比画面边缘还靠外 1%）。最多 90°。
 */
export function openLimit(width: number, distance: number): number {
  return Math.min(90, (Math.atan((2 * distance) / width) * 180) / Math.PI + 3);
}

/**
 * 关门的角度（度，0 = 关上）：p 是进入阶段的进度，open 是起始角（openLimit）。先越关越快（ease，默认二次缓入），
 * 在 SLAM_AT 撞上门框，之后回弹一下（bounce 度）再落定；p = 1 时正好是 0。
 */
export function closeAngle(p: number, ease: (x: number) => number, bounce: number, open: number): number {
  if (p <= 0) return open;
  if (p >= 1) return 0;
  if (p < SLAM_AT) {
    const q = p / SLAM_AT;
    return open * (1 - ease(q));
  }
  const tau = (p - SLAM_AT) / (1 - SLAM_AT);
  return bounce * Math.sin(Math.PI * tau) * (1 - tau);
}

/** 开门的角度（度）：被推开，一开始快、越开越慢（二次缓出），p = 1 时到 open（刚好出画） */
export function openAngle(p: number, open: number): number {
  if (p <= 0) return 0;
  if (p >= 1) return open;
  return open * (1 - (1 - p) ** 2);
}

/**
 * 门扇转到 angle 度时面的明暗系数（sRGB，乘在贴图上）：关上时朝南（0.8），转到 90° 时朝东或朝西（0.6），
 * 中间按 cos² 插值。游戏里门是直接开关的，没有中间角度；这是把游戏的面明暗推到连续的角度上。
 */
export function swingShade(angleDeg: number): number {
  const c = Math.cos((angleDeg * Math.PI) / 180);
  return 0.6 + 0.2 * c * c;
}
