// 缓动曲线的求值，只给 EasingField 画小曲线和预览用（模板里的缓动由引擎的 ctx.ease 求值，与这里无关）。
// 名字与 template-sdk 的 EASING_NAMES 一致。

type Fn = (t: number) => number;

const c1 = 1.70158;
const c2 = c1 * 1.525;
const c3 = c1 + 1;
const c4 = (2 * Math.PI) / 3;

function bounceOut(t: number): number {
  const n1 = 7.5625;
  const d1 = 2.75;
  if (t < 1 / d1) return n1 * t * t;
  if (t < 2 / d1) return n1 * (t -= 1.5 / d1) * t + 0.75;
  if (t < 2.5 / d1) return n1 * (t -= 2.25 / d1) * t + 0.9375;
  return n1 * (t -= 2.625 / d1) * t + 0.984375;
}

const pow = (p: number) => ({
  in: (t: number) => t ** p,
  out: (t: number) => 1 - (1 - t) ** p,
  inOut: (t: number) => (t < 0.5 ? 2 ** (p - 1) * t ** p : 1 - (-2 * t + 2) ** p / 2),
});
const quad = pow(2);
const cubic = pow(3);
const quart = pow(4);
const quint = pow(5);

export const EASING_FUNCTIONS: Record<string, Fn> = {
  linear: (t) => t,
  quadIn: quad.in,
  quadOut: quad.out,
  quadInOut: quad.inOut,
  cubicIn: cubic.in,
  cubicOut: cubic.out,
  cubicInOut: cubic.inOut,
  quartIn: quart.in,
  quartOut: quart.out,
  quartInOut: quart.inOut,
  quintIn: quint.in,
  quintOut: quint.out,
  quintInOut: quint.inOut,
  expoIn: (t) => (t === 0 ? 0 : 2 ** (10 * t - 10)),
  expoOut: (t) => (t === 1 ? 1 : 1 - 2 ** (-10 * t)),
  expoInOut: (t) => (t === 0 ? 0 : t === 1 ? 1 : t < 0.5 ? 2 ** (20 * t - 10) / 2 : (2 - 2 ** (-20 * t + 10)) / 2),
  circIn: (t) => 1 - Math.sqrt(1 - t * t),
  circOut: (t) => Math.sqrt(1 - (t - 1) ** 2),
  circInOut: (t) => (t < 0.5 ? (1 - Math.sqrt(1 - (2 * t) ** 2)) / 2 : (Math.sqrt(1 - (-2 * t + 2) ** 2) + 1) / 2),
  backIn: (t) => c3 * t * t * t - c1 * t * t,
  backOut: (t) => 1 + c3 * (t - 1) ** 3 + c1 * (t - 1) ** 2,
  backInOut: (t) => (t < 0.5 ? ((2 * t) ** 2 * ((c2 + 1) * 2 * t - c2)) / 2 : ((2 * t - 2) ** 2 * ((c2 + 1) * (t * 2 - 2) + c2) + 2) / 2),
  elasticOut: (t) => (t === 0 ? 0 : t === 1 ? 1 : 2 ** (-10 * t) * Math.sin((t * 10 - 0.75) * c4) + 1),
  bounceOut,
};

/** 三次贝塞尔 (0,0)-(x1,y1)-(x2,y2)-(1,1)：按 x 求 y（二分） */
export function bezier(x1: number, y1: number, x2: number, y2: number): Fn {
  const coord = (t: number, a: number, b: number) => 3 * (1 - t) * (1 - t) * t * a + 3 * (1 - t) * t * t * b + t * t * t;
  return (x) => {
    if (x <= 0) return 0;
    if (x >= 1) return 1;
    let lo = 0;
    let hi = 1;
    for (let i = 0; i < 30; i++) {
      const mid = (lo + hi) / 2;
      if (coord(mid, x1, x2) < x) lo = mid;
      else hi = mid;
    }
    return coord((lo + hi) / 2, y1, y2);
  };
}

export type EasingValue = string | readonly [number, number, number, number];

export function easingFn(value: EasingValue): Fn {
  if (typeof value === 'string') return EASING_FUNCTIONS[value] ?? EASING_FUNCTIONS.linear!;
  return bezier(value[0], value[1], value[2], value[3]);
}

/** 曲线的 SVG path：w×h 的框，y 向下；pad 给超出 [0,1] 的回弹留余量 */
export function easingPath(value: EasingValue, w: number, h: number, pad = 0.25, samples = 48): string {
  const f = easingFn(value);
  const span = 1 + pad * 2;
  const pts: string[] = [];
  for (let i = 0; i <= samples; i++) {
    const x = i / samples;
    const y = f(x);
    pts.push(`${(x * w).toFixed(2)},${(h - ((y + pad) / span) * h).toFixed(2)}`);
  }
  return `M${pts.join('L')}`;
}
