// 010 液体淹没：水位随时间走到哪里、水面的起伏、几个方向的坐标换算、默认音效按液体换。
// 不依赖 ctx 的纯函数，验收测试直接导入。

export type Source = 'bottom' | 'top' | 'left' | 'right';
export const SOURCES: readonly Source[] = ['bottom', 'top', 'left', 'right'];

/** 水面起伏的一项：沿边的波数 k、角频率 w、相位、幅度 */
export interface WaveTerm {
  k: number;
  w: number;
  phase: number;
  amp: number;
}

/** 水面在沿边坐标 c、时刻 t 的起伏，值在 [−1, 1] */
export function surfaceWave(c: number, t: number, terms: readonly WaveTerm[]): number {
  let s = 0;
  let a = 0;
  for (const w of terms) {
    s += w.amp * Math.sin(w.k * c + w.w * t + w.phase);
    a += Math.abs(w.amp);
  }
  return a > 0 ? s / a : 0;
}

/**
 * 水位（离来水那一边的距离）走过的范围：进度 0 时水面连同起伏都在来水那一边以外，进度 1 时水面在对边以外
 * （起伏 amp、余量 pad 都算进去），剪辑点时整个画面在水下。
 */
export function levelRange(length: number, amp: number, pad: number): { from: number; to: number } {
  return { from: -amp - pad, to: length + amp + pad };
}

export function levelAt(p: number, range: { from: number; to: number }): number {
  return range.from + (range.to - range.from) * p;
}

/** 舞台坐标 (x, y) → (离来水一边的距离 s, 沿边坐标 c)。length 是沿来水方向的长度 */
export function toFillSpace(source: Source, x: number, y: number, halfW: number, halfH: number): { s: number; c: number } {
  switch (source) {
    case 'top':
      return { s: halfH - y, c: x };
    case 'left':
      return { s: x + halfW, c: y };
    case 'right':
      return { s: halfW - x, c: y };
    default:
      return { s: y + halfH, c: x };
  }
}

/** 水和岩浆各自的默认音效：参数保持某一种液体的默认值时，按当前的液体换成对应的那一个 */
export const DEFAULT_SOUNDS = {
  water: { fill: 'minecraft:item.bucket.empty', drain: 'minecraft:item.bucket.fill' },
  lava: { fill: 'minecraft:item.bucket.empty_lava', drain: 'minecraft:item.bucket.fill_lava' },
} as const;

export function soundFor(value: string | null, kind: 'fill' | 'drain', liquid: 'water' | 'lava'): string | null {
  if (value === null) return null;
  if (value === DEFAULT_SOUNDS.water[kind] || value === DEFAULT_SOUNDS.lava[kind]) return DEFAULT_SOUNDS[liquid][kind];
  return value;
}
