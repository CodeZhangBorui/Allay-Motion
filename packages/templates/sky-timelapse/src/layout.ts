// 060 昼夜流转：一天里的时刻 → 天体角度、天空亮度、星星亮度、日出日落的霞光，以及太阳、月亮在画面上走的轨道。
// 不依赖 ctx 的纯函数，验收测试直接导入。式子是凭记忆写的；1.21.11 起游戏把一天的变化写成了数据（data/minecraft/timeline/day.json），
// 天空亮度、星星亮度、霞光的关键帧和这些式子一致（T-TPL-C060-6，docs/templates/sky-timelapse.md 第 3 节）。

/** 一天 24000 刻：0 日出、6000 正午、12000 日落、18000 午夜 */
export const DAY = 24000;

/** 从 from 走到 to（刻），to 不大于 from 时算到第二天 */
export function timeSpan(from: number, to: number): { from: number; to: number } {
  const f = ((from % DAY) + DAY) % DAY;
  let t = ((to % DAY) + DAY) % DAY;
  if (t <= f) t += DAY;
  return { from: f, to: t };
}

/**
 * 天体角度（0–1）：0 是太阳在头顶，0.25 太阳落到西边的地平线，0.5 在脚下，0.75 从东边升起。
 * 游戏里一天的时刻到天体角度不是线性的：d = frac(时刻 / 24000 − 0.25)，角度 = (2d + (1 − cos(πd)) / 2) / 3。
 */
export function celestialAngle(dayTime: number): number {
  const x = dayTime / DAY - 0.25;
  const d = x - Math.floor(x);
  const e = 0.5 - Math.cos(d * Math.PI) / 2;
  return (d * 2 + e) / 3;
}

/** 天空亮度（0–1）：cos(2π 角度) × 2 + 0.5，钳到 [0, 1]。正午 1，日落前后降到 0，夜里 0 */
export function skyBrightness(angle: number): number {
  const v = Math.cos(angle * Math.PI * 2) * 2 + 0.5;
  return Math.min(1, Math.max(0, v));
}

/** 星星亮度（0–0.5）：1 − (cos(2π 角度) × 2 + 0.25)，钳到 [0, 1]，平方再乘 0.5 */
export function starBrightness(angle: number): number {
  const v = Math.min(1, Math.max(0, 1 - (Math.cos(angle * Math.PI * 2) * 2 + 0.25)));
  return v * v * 0.5;
}

/**
 * 日出日落的霞光：cos(2π 角度) 在 [−0.4, 0.4] 里时有。f = cos / 0.4 × 0.5 + 0.5，
 * 颜色 (0.7 + 0.3f, 0.2 + 0.7f², 0.2)，不透明度 (1 − (1 − sin(πf)) × 0.99)²。没有时返回 null。
 */
export function sunriseGlow(angle: number): { r: number; g: number; b: number; a: number } | null {
  const c = Math.cos(angle * Math.PI * 2);
  if (c < -0.4 || c > 0.4) return null;
  const f = (c / 0.4) * 0.5 + 0.5;
  const a = Math.pow(1 - (1 - Math.sin(f * Math.PI)) * 0.99, 2);
  return { r: f * 0.3 + 0.7, g: f * f * 0.7 + 0.2, b: 0.2, a };
}

/**
 * 太阳在轨道上的位置：轨道是以地平线中点为圆心的椭圆，横半轴 ax、竖半轴 ay。角度 0 时在头顶，0.25 落在右边（西）的地平线。
 * 返回相对地平线中点的坐标；月亮在对面。
 */
export function orbit(angle: number, ax: number, ay: number): { x: number; y: number } {
  const phi = Math.PI / 2 - angle * Math.PI * 2;
  return { x: Math.cos(phi) * ax, y: Math.sin(phi) * ay };
}

/** 月相的顺序（游戏里第 0 相是满月），1.21.11 起每相一张贴图（environment/celestial/moon/<名字>），更早是 4 × 2 的一张 */
export const MOON_PHASES = ['full_moon', 'waning_gibbous', 'third_quarter', 'waning_crescent', 'new_moon', 'waxing_crescent', 'first_quarter', 'waxing_gibbous'] as const;

/** 旧的 moon_phases（128 × 64，4 列 2 行）里第 i 相的位置（贴图坐标 0–1，v 从下往上） */
export function moonPhaseRect(i: number): { u0: number; v0: number; u1: number; v1: number } {
  const k = ((Math.round(i) % 8) + 8) % 8;
  const col = k % 4;
  const row = Math.floor(k / 4);
  return { u0: col / 4, u1: (col + 1) / 4, v0: 1 - (row + 1) / 2, v1: 1 - row / 2 };
}
