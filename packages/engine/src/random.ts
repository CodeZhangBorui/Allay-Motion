// 确定性随机流（docs/02-engine.md 2.9）：对 "${seed}:${key}" 做 cyrb128 哈希，用结果初始化 sfc32。
import type { Rng } from '@allay/template-sdk';

/** cyrb128：把字符串散列成 4 个 32 位整数 */
export function cyrb128(str: string): [number, number, number, number] {
  let h1 = 1779033703;
  let h2 = 3144134277;
  let h3 = 1013904242;
  let h4 = 2773480762;
  for (let i = 0; i < str.length; i++) {
    const k = str.charCodeAt(i);
    h1 = h2 ^ Math.imul(h1 ^ k, 597399067);
    h2 = h3 ^ Math.imul(h2 ^ k, 2869860233);
    h3 = h4 ^ Math.imul(h3 ^ k, 951274213);
    h4 = h1 ^ Math.imul(h4 ^ k, 2716044179);
  }
  h1 = Math.imul(h3 ^ (h1 >>> 18), 597399067);
  h2 = Math.imul(h4 ^ (h2 >>> 22), 2869860233);
  h3 = Math.imul(h1 ^ (h3 >>> 17), 951274213);
  h4 = Math.imul(h2 ^ (h4 >>> 19), 2716044179);
  h1 ^= h2 ^ h3 ^ h4;
  h2 ^= h1;
  h3 ^= h1;
  h4 ^= h1;
  return [h1 >>> 0, h2 >>> 0, h3 >>> 0, h4 >>> 0];
}

/** sfc32：返回 [0, 1) 的生成器 */
export function sfc32(seed: readonly [number, number, number, number]): () => number {
  let [a, b, c, d] = seed;
  return () => {
    a |= 0;
    b |= 0;
    c |= 0;
    d |= 0;
    const t = (((a + b) | 0) + d) | 0;
    d = (d + 1) | 0;
    a = b ^ (b >>> 9);
    b = (c + (c << 3)) | 0;
    c = (c << 21) | (c >>> 11);
    c = (c + t) | 0;
    return (t >>> 0) / 4294967296;
  };
}

export function createRng(seed: number | string, key: string): Rng {
  const next = sfc32(cyrb128(`${seed}:${key}`));
  const rng: Rng = {
    next,
    range: (a, b) => a + (b - a) * next(),
    int: (a, b) => {
      const lo = Math.ceil(Math.min(a, b));
      const hi = Math.floor(Math.max(a, b));
      return lo + Math.floor(next() * (hi - lo + 1));
    },
    pick: <T>(items: readonly T[]): T => {
      if (items.length === 0) throw new RangeError('pick() from an empty array');
      return items[Math.floor(next() * items.length)] as T;
    },
    shuffle: <T>(items: T[]): T[] => {
      for (let i = items.length - 1; i > 0; i--) {
        const j = Math.floor(next() * (i + 1));
        const tmp = items[i] as T;
        items[i] = items[j] as T;
        items[j] = tmp;
      }
      return items;
    },
  };
  return rng;
}
