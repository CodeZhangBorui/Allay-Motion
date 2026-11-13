// 缓动与数学辅助（docs/02-engine.md 2.9）。自己实现，不引入动画库（09-compliance.md 9.8）。
import type { EaseFn, EaseLibrary, EasingName, MathHelpers } from '@allay/template-sdk';

const { PI, sqrt, pow, sin } = Math;

function inOut(easeIn: EaseFn): EaseFn {
  return (x) => (x < 0.5 ? easeIn(2 * x) / 2 : 1 - easeIn(2 - 2 * x) / 2);
}
function out(easeIn: EaseFn): EaseFn {
  return (x) => 1 - easeIn(1 - x);
}

const polyIn = (n: number): EaseFn => (x) => pow(x, n);
const expoIn: EaseFn = (x) => (x <= 0 ? 0 : pow(2, 10 * x - 10));
const circIn: EaseFn = (x) => 1 - sqrt(1 - Math.min(1, x * x));
const C1 = 1.70158;
const C3 = C1 + 1;
const backIn: EaseFn = (x) => C3 * x * x * x - C1 * x * x;
const C2 = C1 * 1.525;

const bounceOut: EaseFn = (x) => {
  const n1 = 7.5625;
  const d1 = 2.75;
  if (x < 1 / d1) return n1 * x * x;
  if (x < 2 / d1) return n1 * (x -= 1.5 / d1) * x + 0.75;
  if (x < 2.5 / d1) return n1 * (x -= 2.25 / d1) * x + 0.9375;
  return n1 * (x -= 2.625 / d1) * x + 0.984375;
};

const elasticOut: EaseFn = (x) => {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  return pow(2, -10 * x) * sin((x * 10 - 0.75) * ((2 * PI) / 3)) + 1;
};

export const EASINGS: Readonly<Record<EasingName, EaseFn>> = {
  linear: (x) => x,
  quadIn: polyIn(2),
  quadOut: out(polyIn(2)),
  quadInOut: inOut(polyIn(2)),
  cubicIn: polyIn(3),
  cubicOut: out(polyIn(3)),
  cubicInOut: inOut(polyIn(3)),
  quartIn: polyIn(4),
  quartOut: out(polyIn(4)),
  quartInOut: inOut(polyIn(4)),
  quintIn: polyIn(5),
  quintOut: out(polyIn(5)),
  quintInOut: inOut(polyIn(5)),
  expoIn,
  expoOut: (x) => (x >= 1 ? 1 : 1 - pow(2, -10 * x)),
  expoInOut: (x) => {
    if (x <= 0) return 0;
    if (x >= 1) return 1;
    return x < 0.5 ? pow(2, 20 * x - 10) / 2 : (2 - pow(2, -20 * x + 10)) / 2;
  },
  circIn,
  circOut: out(circIn),
  circInOut: inOut(circIn),
  backIn,
  backOut: (x) => 1 + C3 * pow(x - 1, 3) + C1 * pow(x - 1, 2),
  backInOut: (x) =>
    x < 0.5
      ? (pow(2 * x, 2) * ((C2 + 1) * 2 * x - C2)) / 2
      : (pow(2 * x - 2, 2) * ((C2 + 1) * (x * 2 - 2) + C2) + 2) / 2,
  elasticOut,
  bounceOut,
};

/** CSS cubic-bezier 的求值：先用牛顿法解 x(s) = x，失败时二分 */
export function bezier(x1: number, y1: number, x2: number, y2: number): EaseFn {
  const cx = 3 * x1;
  const bx = 3 * (x2 - x1) - cx;
  const ax = 1 - cx - bx;
  const cy = 3 * y1;
  const by = 3 * (y2 - y1) - cy;
  const ay = 1 - cy - by;
  const sampleX = (s: number) => ((ax * s + bx) * s + cx) * s;
  const sampleY = (s: number) => ((ay * s + by) * s + cy) * s;
  const slopeX = (s: number) => (3 * ax * s + 2 * bx) * s + cx;
  return (x) => {
    if (x <= 0) return 0;
    if (x >= 1) return 1;
    let s = x;
    for (let i = 0; i < 8; i++) {
      const err = sampleX(s) - x;
      if (Math.abs(err) < 1e-7) return sampleY(s);
      const d = slopeX(s);
      if (Math.abs(d) < 1e-7) break;
      s -= err / d;
    }
    let lo = 0;
    let hi = 1;
    s = x;
    for (let i = 0; i < 40; i++) {
      const v = sampleX(s);
      if (Math.abs(v - x) < 1e-7) break;
      if (v < x) lo = s;
      else hi = s;
      s = (lo + hi) / 2;
    }
    return sampleY(s);
  };
}

function isEasingName(value: unknown): value is EasingName {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(EASINGS, value);
}

export const ease: EaseLibrary = {
  ...EASINGS,
  bezier,
  from(value: unknown): EaseFn {
    if (isEasingName(value)) return EASINGS[value];
    if (Array.isArray(value) && value.length === 4 && value.every((v) => typeof v === 'number' && Number.isFinite(v))) {
      const [x1, y1, x2, y2] = value as [number, number, number, number];
      return bezier(Math.min(1, Math.max(0, x1)), y1, Math.min(1, Math.max(0, x2)), y2);
    }
    return EASINGS.linear;
  },
};

export const math: MathHelpers = {
  clamp: (x, min, max) => Math.min(max, Math.max(min, x)),
  lerp: (a, b, t) => a + (b - a) * t,
  invLerp: (a, b, x) => (a === b ? 0 : (x - a) / (b - a)),
  remap: (x, inMin, inMax, outMin, outMax) => outMin + (outMax - outMin) * (inMin === inMax ? 0 : (x - inMin) / (inMax - inMin)),
  smoothstep: (e0, e1, x) => {
    const t = Math.min(1, Math.max(0, e0 === e1 ? (x < e0 ? 0 : 1) : (x - e0) / (e1 - e0)));
    return t * t * (3 - 2 * t);
  },
};

/** ctx.time.segment：返回钳制到 [0, 1] 的进度；duration ≤ 0 时是阶跃 */
export function segment(t: number, start: number, duration: number): number {
  if (duration <= 0) return t >= start ? 1 : 0;
  return Math.min(1, Math.max(0, (t - start) / duration));
}

