// 091 显像管：每个时刻的画面状态（开口的大小、亮线的亮度、雪花、扫描线），不依赖 ctx 的纯函数，验收测试直接导入。
// 开口是画面上还“亮着”的那块圆角矩形，外面是关掉的屏幕。关机：开口先竖直压成一条亮线，再横向缩成一个点，点慢慢暗掉；
// 开机反过来：先亮出一个点，横向拉成线，再竖直展开，展开的地方先是雪花，雪花和扫描线随后褪去。

export interface CrtState {
  /** 开口的半宽、半高（设计单位） */
  hx: number;
  hy: number;
  /** 开口的圆角半径 */
  radius: number;
  /** 开口里盖住底下画面的比例：0 透出画面，1 完全是亮线的颜色（乘 bright） */
  cover: number;
  /** 亮线、亮点的亮度（0 时开口里是关掉的屏幕的颜色） */
  bright: number;
  /** 开口里雪花的不透明度 */
  staticA: number;
  /** 扫描线的深浅 */
  scanA: number;
  /** 亮线、亮点四周光晕的强度 */
  glowA: number;
  /** 是否画开口外面的“关掉的屏幕”（全开时为 false，整块透明） */
  black: boolean;
}

export interface CrtOptions {
  /** 舞台半宽、半高 */
  halfW: number;
  halfH: number;
  /** 亮线的半粗细 */
  line: number;
  /** 圆角：0–1，乘到 CORNER_MAX 上 */
  curvature: number;
  staticAmount: number;
  scanlines: number;
  glow: number;
}

/** 全屏时圆角的最大半径（设计单位） */
export const CORNER_MAX = 180;

/** 关机的三段（占进入阶段的比例）：竖直压扁、横向收成点、点暗掉 */
export const OFF_VERTICAL: readonly [number, number] = [0, 0.5];
export const OFF_HORIZONTAL: readonly [number, number] = [0.5, 0.78];
export const OFF_DOT: readonly [number, number] = [0.78, 1];
/** 开机的几段（占退出阶段的比例）：亮点、横向拉开、竖直展开；雪花和扫描线的褪去 */
export const ON_DOT: readonly [number, number] = [0, 0.12];
export const ON_HORIZONTAL: readonly [number, number] = [0.1, 0.32];
export const ON_VERTICAL: readonly [number, number] = [0.3, 0.62];
export const ON_STATIC_FADE: readonly [number, number] = [0.45, 1];
export const ON_SCAN_FADE: readonly [number, number] = [0.6, 1];

const clamp01 = (x: number) => (x <= 0 ? 0 : x >= 1 ? 1 : x);
const seg = (x: number, r: readonly [number, number]) => clamp01((x - r[0]) / (r[1] - r[0]));
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const smooth = (x: number) => x * x * (3 - 2 * x);

/** 开口全开时的余量：圆角和软边都在画面外（圆角 r 的角点在里面要求余量 ≥ (1 − 1/√2) r） */
export function openMargin(o: Pick<CrtOptions, 'curvature'>): number {
  return 0.35 * CORNER_MAX * clamp01(o.curvature) + EDGE_MAX + 4;
}

/** 软边的最大宽度（全屏时），越窄的开口软边越窄 */
export const EDGE_MAX = 28;
export function edgeWidth(hx: number, hy: number): number {
  return Math.max(1, Math.min(EDGE_MAX, Math.min(hx, hy) * 0.06));
}

function radiusFor(o: CrtOptions, hx: number, hy: number): number {
  return Math.min(CORNER_MAX * clamp01(o.curvature), Math.min(hx, hy));
}

/** 全开：什么都不画 */
function open(o: CrtOptions): CrtState {
  const m = openMargin(o);
  return { hx: o.halfW + m, hy: o.halfH + m, radius: CORNER_MAX * clamp01(o.curvature), cover: 0, bright: 1, staticA: 0, scanA: 0, glowA: 0, black: false };
}

/** 全黑（停留阶段、剪辑点） */
export function offState(): CrtState {
  return { hx: 0, hy: 0, radius: 0, cover: 1, bright: 0, staticA: 0, scanA: 0, glowA: 0, black: true };
}

/** 关机：a 是进入阶段的进度（0–1）。a = 0 时全开（什么都不画），a = 1 时全黑 */
export function powerOff(a: number, o: CrtOptions): CrtState {
  if (a <= 0) return open(o);
  if (a >= 1) return offState();
  const m = openMargin(o);
  const Wm = o.halfW + m;
  const Hm = o.halfH + m;
  const v = seg(a, OFF_VERTICAL);
  const h = seg(a, OFF_HORIZONTAL);
  const d = seg(a, OFF_DOT);
  // 竖直压扁先慢后快（显像管偏转失电的那一下），横向收得更快
  const hy = h > 0 ? o.line : lerp(Hm, o.line, v * v * v);
  const hx = lerp(Wm, o.line, h * h);
  // 压扁的过程中画面越来越亮，变成线的时候完全是亮线的颜色
  const cover = h > 0 ? 1 : Math.pow(v, 1.6);
  const bright = d > 0 ? Math.pow(1 - d, 2) : 1;
  const dot = d > 0 ? o.line * (1 + 0.6 * (1 - d)) : 0;
  return {
    hx: d > 0 ? dot : hx,
    hy: d > 0 ? dot : hy,
    radius: radiusFor(o, d > 0 ? dot : hx, d > 0 ? dot : hy),
    cover,
    bright,
    staticA: 0,
    scanA: o.scanlines * smooth(clamp01(v / 0.4)) * (1 - h),
    glowA: o.glow * smooth(clamp01((v - 0.6) / 0.4)) * bright,
    black: true,
  };
}

/** 开机：b 是退出阶段的进度（0–1）。b = 0 时全黑，b = 1 时全开 */
export function powerOn(b: number, o: CrtOptions): CrtState {
  if (b <= 0) return offState();
  if (b >= 1) return open(o);
  const m = openMargin(o);
  const Wm = o.halfW + m;
  const Hm = o.halfH + m;
  const dt = seg(b, ON_DOT);
  const h = seg(b, ON_HORIZONTAL);
  const v = seg(b, ON_VERTICAL);
  const out3 = (x: number) => 1 - Math.pow(1 - x, 3);
  const hx = h > 0 ? lerp(o.line, Wm, out3(h)) : o.line * (0.4 + 0.6 * dt);
  const hy = v > 0 ? lerp(o.line, Hm, out3(v)) : hx < o.line ? hx : o.line;
  // 竖直展开时亮色退成雪花和画面
  const cover = 1 - smooth(v);
  const bright = h > 0 ? 1 : dt;
  return {
    hx,
    hy,
    radius: radiusFor(o, hx, hy),
    cover,
    bright,
    staticA: v > 0 ? o.staticAmount * (1 - smooth(seg(b, ON_STATIC_FADE))) : 0,
    scanA: v > 0 ? o.scanlines * (1 - smooth(seg(b, ON_SCAN_FADE))) : 0,
    glowA: o.glow * bright * (1 - smooth(v)),
    black: true,
  };
}
