// 016 藤蔓蔓生的纯函数部分：树叶的种类和颜色、几层树叶的排法、生长和枯落的先后、藤蔓的长度。
// 不依赖 ctx，验收测试直接导入（tests/unit/T-TPL-C016.vine-overgrow.test.ts）。

/** 树叶的种类（贴图 block/<种类>_leaves）。pale_oak 是 1.21.4 加的 */
export const LEAVES = ['oak', 'spruce', 'birch', 'jungle', 'acacia', 'dark_oak', 'mangrove', 'cherry', 'azalea', 'flowering_azalea', 'pale_oak'] as const;
export type Leaves = (typeof LEAVES)[number];

/** 树叶颜色参数的默认值（foliage 常量，packages/assets/data/tints.json） */
export const DEFAULT_TINT = '#77AB2F';

/**
 * 实际用的树叶颜色：参数保持默认值时按种类取游戏里的颜色——云杉、白桦是固定的 foliage 常量（tints.json），
 * 红树是固定色（凭记忆，#92C648），樱花、杜鹃、开花的杜鹃、苍白橡木的贴图本身带颜色、不着色（白色）。改过的照用。
 */
export function leafTint(leaves: Leaves, tint: string): string {
  if (tint.toUpperCase() !== DEFAULT_TINT) return tint;
  if (leaves === 'spruce') return '#619961';
  if (leaves === 'birch') return '#80A755';
  if (leaves === 'mangrove') return '#92C648';
  if (leaves === 'cherry' || leaves === 'azalea' || leaves === 'flowering_azalea' || leaves === 'pale_oak') return '#FFFFFF';
  return tint;
}

/** 藤蔓的颜色：游戏里藤蔓用生物群系的 foliage 颜色，树叶不着色的种类也照样着色 */
export function vineTint(leaves: Leaves, tint: string): string {
  const t = leafTint(leaves, tint);
  return t === '#FFFFFF' ? DEFAULT_TINT : t;
}

/**
 * 贴图不透明像素（alpha ≥ 128）的平均颜色（sRGB，0–1）。pixels 是 RGBA8；没有不透明像素时是 null。
 * 用来定树叶后面那层底的颜色：树叶自己的颜色压暗，像游戏里“快速”画质下树叶的空隙，而不是一块和树叶无关的色板。
 */
export function averageOpaque(pixels: ArrayLike<number>): [number, number, number] | null {
  let r = 0;
  let g = 0;
  let b = 0;
  let n = 0;
  for (let i = 0; i + 3 < pixels.length; i += 4) {
    if (pixels[i + 3]! < 128) continue;
    r += pixels[i]!;
    g += pixels[i + 1]!;
    b += pixels[i + 2]!;
    n++;
  }
  return n > 0 ? [r / n / 255, g / n / 255, b / n / 255] : null;
}

/** 底的亮度：树叶平均颜色 × 着色 × 这个系数（sRGB） */
export const BACKING_SHADE = 0.42;

export type FallItem = 'leaves' | 'petals' | 'apples' | 'none';
export const FALL_ITEMS: readonly FallItem[] = ['leaves', 'petals', 'apples', 'none'];

/** 一层树叶：网格的偏移（以格计）、离画面的深度（以格计，朝相机为正）、明暗（sRGB） */
export interface LeafLayer {
  dx: number;
  dy: number;
  depth: number;
  shade: number;
  /** 这一层铺多少（0–1）：最里层铺满，外层留空隙，看得出层次 */
  fill: number;
}

/**
 * 几层树叶从里到外：最里层（第 0 层）正好铺满网格、贴在 z = 0、后面垫着深色的底；外面的层错开半格、离相机近一点、更亮，
 * 不铺满。透视下外层只会更大，所以只有最里层要铺满画面。
 */
export function leafLayers(count: number): LeafLayer[] {
  const all: LeafLayer[] = [
    { dx: 0, dy: 0, depth: 0, shade: 0.74, fill: 1 },
    { dx: 0.5, dy: 0.5, depth: 0.12, shade: 0.88, fill: 0.85 },
    { dx: 0.25, dy: -0.3, depth: 0.24, shade: 1, fill: 0.55 },
  ];
  return all.slice(0, Math.max(1, Math.min(3, Math.round(count))));
}

/** 藤蔓从画面上沿垂下的长度（占画面高度的比例）：随机数 r 决定，至少四成，最长垂过下沿 */
export function vineLength(r: number): number {
  return 0.4 + 0.75 * r;
}

/**
 * 一块树叶出现的先后（还没归一化，调用方把全部树叶的值归一化到 0–1）：离最近的藤蔓越近越早，加噪声；
 * 同一处外层比里层晚一点（“一层层长满”）。这样整个画面在进入阶段末尾才盖满，不会早早铺成一面墙。
 * distance 是到最近藤蔓的距离（0–1），noise 是 [-1, 1] 的噪声。
 */
export function growOrder(layer: number, layers: number, distance: number, noise: number): number {
  const l = layers > 1 ? layer / (layers - 1) : 0;
  return 0.7 * distance + 0.22 * (0.5 + 0.5 * noise) + 0.12 * l;
}

/**
 * 一块树叶枯掉的先后（0 最先）：基本随机，外层略早（外层先掉得太多的话，退出阶段前半段画面看不出变化，到后面才一下子露出来）。
 */
export function decayOrder(layer: number, layers: number, r: number): number {
  const l = layers > 1 ? 1 - layer / (layers - 1) : 0;
  return Math.min(1, Math.max(0, 0.15 * l + 0.85 * r));
}
