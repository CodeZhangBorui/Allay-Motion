// 带种子的二维 simplex 噪声（docs/02-engine.md 2.9），返回 [−1, 1]。
// 算法是 Stefan Gustavson 的公开 simplex 噪声；排列表由 cyrb128 + sfc32 按种子生成。
import { cyrb128, sfc32 } from './random';

const F2 = 0.5 * (Math.sqrt(3) - 1);
const G2 = (3 - Math.sqrt(3)) / 6;
const GRAD = [
  [1, 1], [-1, 1], [1, -1], [-1, -1],
  [1, 0], [-1, 0], [0, 1], [0, -1],
] as const;

export type Noise2D = (x: number, y: number) => number;

export function createNoise2D(seed: number | string, key: string): Noise2D {
  const next = sfc32(cyrb128(`${seed}:noise:${key}`));
  const p = new Uint8Array(256);
  for (let i = 0; i < 256; i++) p[i] = i;
  for (let i = 255; i > 0; i--) {
    const j = Math.floor(next() * (i + 1));
    const tmp = p[i]!;
    p[i] = p[j]!;
    p[j] = tmp;
  }
  const perm = new Uint8Array(512);
  for (let i = 0; i < 512; i++) perm[i] = p[i & 255]!;

  const corner = (gi: number, x: number, y: number): number => {
    let t = 0.5 - x * x - y * y;
    if (t < 0) return 0;
    t *= t;
    const g = GRAD[gi & 7]!;
    return t * t * (g[0] * x + g[1] * y);
  };

  return (xin, yin) => {
    const s = (xin + yin) * F2;
    const i = Math.floor(xin + s);
    const j = Math.floor(yin + s);
    const t = (i + j) * G2;
    const x0 = xin - (i - t);
    const y0 = yin - (j - t);
    const i1 = x0 > y0 ? 1 : 0;
    const j1 = x0 > y0 ? 0 : 1;
    const x1 = x0 - i1 + G2;
    const y1 = y0 - j1 + G2;
    const x2 = x0 - 1 + 2 * G2;
    const y2 = y0 - 1 + 2 * G2;
    const ii = i & 255;
    const jj = j & 255;
    const n0 = corner(perm[ii + perm[jj]!]!, x0, y0);
    const n1 = corner(perm[ii + i1 + perm[jj + j1]!]!, x1, y1);
    const n2 = corner(perm[ii + 1 + perm[jj + 1]!]!, x2, y2);
    // 70 把结果缩放到大约 [−1, 1]，再钳制保证不越界
    return Math.max(-1, Math.min(1, 70 * (n0 + n1 + n2)));
  };
}
