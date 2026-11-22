// 092 图形光圈：每种遮罩的几何（在贴图里的位置、缩放的中心、中心附近完全透空的范围）和光圈大小随时间的曲线。
// 不依赖 ctx 的纯函数，验收测试直接导入。
//
// 遮罩的“形状坐标”以贴图像素为单位（程序画的圆以半径为 1 个单位）。光圈大小 S = 一个形状单位对应多少设计单位：
// S 从 S0（中心附近的透空区域把整个画面装下）按对数匀速缩到几乎为 0；中途可以在 SL 停一下（卡通片结尾那样）。

export type MaskKind = 'circle' | 'spyglass' | 'creeper' | 'skull' | 'flower' | 'globe' | 'image';
export const MASKS: readonly MaskKind[] = ['circle', 'spyglass', 'creeper', 'skull', 'flower', 'globe', 'image'];

export interface MaskGeometry {
  /** 着色器里的画法：0 圆，1 望远镜框，2 旗帜图案，3 自己的图片 */
  shader: 0 | 1 | 2 | 3;
  /** 缩放中心在形状坐标里的位置（贴图像素，左上角为原点、y 向下；圆是 (0, 0)） */
  anchor: readonly [number, number];
  /** 缩放中心附近完全透空的矩形的半宽、半高（形状单位）：S0 按它把整个画面装下 */
  inner: readonly [number, number];
  /** 形状的名义大小（形状单位）：停顿时这么大的东西占画面短边的 linger */
  extent: number;
}

/**
 * 旗帜图案的贴图是 64 × 64，正面在 (1, 1) 起 20 × 40 的一块（对照过游戏文件）。
 * 各图案里选一块实心的地方当缩放中心：苦力怕取鼻子（6 × 3），头颅取头顶（8 × 4），花取花心（4 × 4），地球取中间的大陆（3 × 4）。
 */
export const GEOMETRY: Record<MaskKind, MaskGeometry> = {
  circle: { shader: 0, anchor: [0, 0], inner: [Math.SQRT1_2, Math.SQRT1_2], extent: 2 },
  // 望远镜：256 × 256 的方框，边框 16 像素，里面是镜片
  spyglass: { shader: 1, anchor: [128, 128], inner: [112, 112], extent: 256 },
  creeper: { shader: 2, anchor: [11, 22.5], inner: [3, 1.5], extent: 18 },
  skull: { shader: 2, anchor: [11, 15], inner: [4, 2], extent: 17 },
  flower: { shader: 2, anchor: [11, 21], inner: [2, 2], extent: 18 },
  globe: { shader: 2, anchor: [8.5, 21], inner: [1.5, 2], extent: 19 },
  // 自己的图片：形状坐标以图片的短边为 1、中心为原点。形状不知道，假定中间四分之一是透空的；开头遮罩再淡入，免得突然出现
  image: { shader: 3, anchor: [0, 0], inner: [0.125, 0.125], extent: 1 },
};

/**
 * 起始大小：中心附近的透空矩形（半宽 inner[0]·S、半高 inner[1]·S）装下整个画面，再留 5% 和 pad 的余量。
 * halfW、halfH 是画面中心到边的距离，cx、cy 是光圈中心相对画面中心的偏移（设计单位）。圆按外接圆算。
 */
export function startScale(kind: MaskKind, halfW: number, halfH: number, cx: number, cy: number, pad: number): number {
  const g = GEOMETRY[kind];
  const dx = halfW + Math.abs(cx) + pad;
  const dy = halfH + Math.abs(cy) + pad;
  if (kind === 'circle') return Math.hypot(dx, dy) * 1.02;
  return Math.max(dx / g.inner[0], dy / g.inner[1]) * 1.05;
}

export interface IrisCurve {
  s0: number;
  /** 停顿时的大小；不停时是“整个图形刚好进到画面里”的大小 */
  sl: number;
  /** 停顿占阶段的比例（0 = 不停） */
  lingerTime: number;
}

/**
 * 光圈在关闭阶段进度 p（0–1）时的大小。p ≤ 0 时为 s0，p ≥ 1 时为 0（完全关上）。
 * 分三段：先按对数从 s0 缩到 sl（从图形里面“拉出来”，大小差几十倍也是匀速的观感），有停顿时减速停住；
 * 停 lingerTime；最后从 sl 线性缩到 0，有停顿时加速收死。没有停顿时两段各占一半、中间不减速。
 */
export function irisScale(p: number, c: IrisCurve): number {
  if (p <= 0) return c.s0;
  if (p >= 1) return 0;
  const hold = Math.min(0.8, Math.max(0, c.lingerTime));
  const sl = Math.min(c.s0, Math.max(1e-6, c.sl));
  const a = (1 - hold) * 0.5;
  if (p < a) {
    const u = p / a;
    const k = hold > 0 ? 1 - (1 - u) * (1 - u) : u;
    return Math.exp(Math.log(c.s0) + (Math.log(sl) - Math.log(c.s0)) * k);
  }
  if (p < a + hold) return sl;
  const u = (p - a - hold) / (1 - a - hold);
  return sl * (1 - (hold > 0 ? u * u : u));
}

/** 遮罩外填充的不透明度：关闭阶段开头 12% 里淡入（形状不知道的图片也不会突然冒出一块黑） */
export function fillAlpha(p: number): number {
  if (p <= 0) return 0;
  if (p >= 0.12) return 1;
  const u = p / 0.12;
  return u * u * (3 - 2 * u);
}
