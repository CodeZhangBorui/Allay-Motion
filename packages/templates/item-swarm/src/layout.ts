// 022 掉落物涌入的纯函数部分：掉落物从哪里出发、飞行的曲线、自转怎样落到整格的朝向、落位时的缩放、散开时飞多远才出画。
// 不依赖 ctx，验收测试直接导入（tests/unit/T-TPL-C022.item-swarm.test.ts）。

export type Origin = 'around' | 'left' | 'right' | 'bottom' | 'top';
export const ORIGINS: readonly Origin[] = ['around', 'left', 'right', 'bottom', 'top'];

/** 飞行中的大小（相对一格）：掉落的方块在游戏里约是方块的 1/4，这里画成半格，落位时长满一格 */
export const FLIGHT_SCALE = 0.5;
/** 单个掉落物的飞行占进入阶段的比例（其余是先后的错落） */
export const FLIGHT_SHARE = 0.55;
/** 散开时单个掉落物的动作占退出阶段的比例（其余是从中间往外的先后） */
export const SCATTER_SHARE = 0.55;

/** 散开的路程进度：起步略快、接近匀速，大约走完四分之三时出画（太早出画的话退出阶段后半段是空的） */
export function scatterProgress(p: number): number {
  if (p <= 0) return 0;
  if (p >= 1) return 1;
  return 1 - (1 - p) ** 1.15;
}

/**
 * 飞行的路程进度：缓动（默认越飞越快）和匀速按 6 : 4 混合。纯缓入的话开头很长一段停在画外，
 * 进入阶段的前三成画面是空的。
 */
export function flightProgress(p: number, ease: (x: number) => number): number {
  if (p <= 0) return 0;
  if (p >= 1) return 1;
  return 0.4 * p + 0.6 * ease(p);
}
/** 游戏里掉落物上下浮动：周期 π 秒，高度 0.0625–0.2625 格（经搜索确认，见文档） */
export const BOB_PERIOD = Math.PI;
export const BOB_LOW = 0.0625;
export const BOB_HIGH = 0.2625;

export interface Vec2 {
  x: number;
  y: number;
}

/**
 * 出发点（设计坐标）：around 从格子所在的方向、刚出画的地方飞来；left / right / bottom / top 从那一侧刚出画的地方飞来。
 * r 是三个 [0, 1) 的随机数；size 是格子边长。出发点在舞台外 0.3–0.7 格（飞行中的掉落物只有半格大，刚好看不见）。
 */
export function startPoint(origin: Origin, slot: Vec2, width: number, height: number, size: number, r: readonly number[]): Vec2 {
  const [r0 = 0, r1 = 0, r2 = 0] = r;
  const margin = size * (0.3 + 0.4 * r1);
  if (origin === 'left' || origin === 'right') {
    const sx = origin === 'left' ? -1 : 1;
    return { x: sx * (width / 2 + margin), y: slot.y * 0.5 + (r0 - 0.5) * height * 0.7 };
  }
  if (origin === 'bottom' || origin === 'top') {
    const sy = origin === 'bottom' ? -1 : 1;
    return { x: slot.x * 0.5 + (r0 - 0.5) * width * 0.7, y: sy * (height / 2 + margin) };
  }
  // 四周：从格子的方向（正中心的格子取随机方向）偏 ±25°，沿这个方向刚出画的地方
  const d = Math.hypot(slot.x, slot.y);
  const base = d > size * 0.25 ? Math.atan2(slot.y, slot.x) : r2 * Math.PI * 2;
  const a = base + (r0 - 0.5) * (Math.PI / 3.6);
  const reach = exitDistance({ x: 0, y: 0 }, Math.cos(a), Math.sin(a), width, height, margin);
  return { x: Math.cos(a) * reach, y: Math.sin(a) * reach };
}

/** 二次贝塞尔曲线的控制点：起终点连线的中点，向一侧偏 bend × 距离 */
export function controlPoint(a: Vec2, b: Vec2, bend: number): Vec2 {
  const mx = (a.x + b.x) / 2;
  const my = (a.y + b.y) / 2;
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  return { x: mx - dy * bend, y: my + dx * bend };
}

export function bezier(a: Vec2, c: Vec2, b: Vec2, q: number, out: Vec2): Vec2 {
  const u = 1 - q;
  out.x = u * u * a.x + 2 * u * q * c.x + q * q * b.x;
  out.y = u * u * a.y + 2 * u * q * c.y + q * q * b.y;
  return out;
}

/** 落位时的缩放：飞行中是 FLIGHT_SCALE，最后两成的路程长到一格（带一点过冲），q 是路程进度 */
export function landScale(q: number, backOut: (x: number) => number): number {
  if (q <= 0) return FLIGHT_SCALE;
  if (q >= 1) return 1;
  const k = q < 0.8 ? 0 : backOut((q - 0.8) / 0.2);
  return FLIGHT_SCALE + (1 - FLIGHT_SCALE) * k;
}

/**
 * 绕竖轴的自转：飞行中按 spin（弧度 / 秒）转；最后四分之一的路程转到下一个整 90°（落位时方块正对相机，铺满时没有缝）。
 * phase 是初始角，age 是从出发起的秒数，flight 是飞行时长，q 是路程进度。
 */
export function spinAngle(phase: number, spin: number, age: number, flight: number, q: number): number {
  const free = phase + spin * age;
  if (q <= 0.75) return free;
  const atLand = phase + spin * flight;
  const quarter = Math.PI / 2;
  const target = spin >= 0 ? Math.ceil(atLand / quarter) * quarter : Math.floor(atLand / quarter) * quarter;
  const w = q >= 1 ? 1 : smooth((q - 0.75) / 0.25);
  return free + (target - free) * w;
}

function smooth(x: number): number {
  const t = x <= 0 ? 0 : x >= 1 ? 1 : x;
  return t * t * (3 - 2 * t);
}

/**
 * 散开时沿方向 (dx, dy)（单位向量）飞多远才出画：从 slot 出发，走到舞台矩形外再多 margin。
 * 只算 z = 0 平面上的距离；掉落物散开时朝相机抬起，透视下只会更早出画。
 */
export function exitDistance(slot: Vec2, dx: number, dy: number, width: number, height: number, margin: number): number {
  const hw = width / 2 + margin;
  const hh = height / 2 + margin;
  let t = Infinity;
  if (dx > 1e-9) t = Math.min(t, (hw - slot.x) / dx);
  if (dx < -1e-9) t = Math.min(t, (-hw - slot.x) / dx);
  if (dy > 1e-9) t = Math.min(t, (hh - slot.y) / dy);
  if (dy < -1e-9) t = Math.min(t, (-hh - slot.y) / dy);
  return Math.max(0, t);
}

/** 掉落物上下浮动的高度（格），age 是秒；照游戏是 0.0625–0.2625 格、周期 π 秒的正弦 */
export function bobHeight(age: number, phase: number): number {
  return BOB_LOW + ((BOB_HIGH - BOB_LOW) / 2) * (1 + Math.sin((2 * Math.PI * age) / BOB_PERIOD + phase));
}
