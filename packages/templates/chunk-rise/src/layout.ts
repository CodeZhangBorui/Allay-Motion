// 012 区块升起的纯函数部分：生物群系的方块组、地形高度和每一柱用什么方块、镜头和视野落在地面上的范围、区块升起的先后。
// 不依赖 ctx，验收测试直接导入（tests/unit/T-TPL-C012.chunk-rise.test.ts）。

export type Biome = 'plains' | 'desert' | 'snowy' | 'nether' | 'end';
export const BIOMES: readonly Biome[] = ['plains', 'desert', 'snowy', 'nether', 'end'];

export type ChunkOrder = 'nearFirst' | 'centerOut' | 'random';
export const CHUNK_ORDERS: readonly ChunkOrder[] = ['nearFirst', 'centerOut', 'random'];

/** 一种地表：顶面、最上面一格的侧面、往下三格的侧面、再往下的侧面各用哪张贴图（贴图表里的下标） */
export interface Surface {
  top: number;
  side: number;
  fill: number;
  deep: number;
}

/** 一个生物群系：用到的贴图（block/…，最多 8 张）、各贴图乘的颜色（草、水用游戏的着色常量），几种地表 */
export interface Palette {
  textures: readonly string[];
  tints: readonly string[];
  /** 普通地面 */
  ground: Surface;
  /** 水边、低处（平原的沙滩） */
  shore: Surface;
  /** 高处露出来的（平原的石头） */
  peak: Surface;
  /** 水面（或岩浆、冰）；没有水的群系是 null */
  liquid: Surface | null;
  /** 地面上随噪声零星出现的另一种（下界的灵魂沙、绯红菌岩） */
  patch: Surface | null;
  /** 水面的高度（格）；低于它的柱子变成水 */
  liquidLevel: number;
}

/** 草和水的着色：平原的草 #91BD59、默认的水 #3F76E4（方块目录的着色常量，packages/assets/data/tints.json） */
export const GRASS_TINT = '#91BD59';
export const WATER_TINT = '#3F76E4';

export function palette(biome: Biome): Palette {
  switch (biome) {
    case 'desert':
      return {
        textures: ['block/sand', 'block/sandstone', 'block/stone', 'block/sandstone_top', 'block/water_still'],
        tints: ['#FFFFFF', '#FFFFFF', '#FFFFFF', '#FFFFFF', WATER_TINT],
        ground: { top: 0, side: 0, fill: 1, deep: 2 },
        shore: { top: 0, side: 0, fill: 1, deep: 2 },
        peak: { top: 3, side: 1, fill: 1, deep: 2 },
        liquid: { top: 4, side: 4, fill: 0, deep: 2 },
        patch: null,
        liquidLevel: -3,
      };
    case 'snowy':
      return {
        textures: ['block/snow', 'block/grass_block_snow', 'block/dirt', 'block/stone', 'block/packed_ice'],
        tints: ['#FFFFFF', '#FFFFFF', '#FFFFFF', '#FFFFFF', '#FFFFFF'],
        ground: { top: 0, side: 1, fill: 2, deep: 3 },
        shore: { top: 0, side: 1, fill: 2, deep: 3 },
        peak: { top: 0, side: 3, fill: 3, deep: 3 },
        liquid: { top: 4, side: 4, fill: 2, deep: 3 },
        patch: null,
        liquidLevel: -1,
      };
    case 'nether':
      return {
        textures: ['block/netherrack', 'block/soul_sand', 'block/crimson_nylium', 'block/crimson_nylium_side', 'block/lava_still'],
        tints: ['#FFFFFF', '#FFFFFF', '#FFFFFF', '#FFFFFF', '#FFFFFF'],
        ground: { top: 0, side: 0, fill: 0, deep: 0 },
        shore: { top: 1, side: 1, fill: 0, deep: 0 },
        peak: { top: 2, side: 3, fill: 0, deep: 0 },
        liquid: { top: 4, side: 4, fill: 0, deep: 0 },
        patch: { top: 2, side: 3, fill: 0, deep: 0 },
        liquidLevel: -2,
      };
    case 'end':
      return {
        textures: ['block/end_stone'],
        tints: ['#FFFFFF'],
        ground: { top: 0, side: 0, fill: 0, deep: 0 },
        shore: { top: 0, side: 0, fill: 0, deep: 0 },
        peak: { top: 0, side: 0, fill: 0, deep: 0 },
        liquid: null,
        patch: null,
        liquidLevel: -99,
      };
    default:
      return {
        textures: ['block/grass_block_top', 'block/grass_block_side', 'block/dirt', 'block/stone', 'block/sand', 'block/water_still', 'block/gravel'],
        tints: [GRASS_TINT, '#FFFFFF', '#FFFFFF', '#FFFFFF', '#FFFFFF', WATER_TINT, '#FFFFFF'],
        ground: { top: 0, side: 1, fill: 2, deep: 3 },
        shore: { top: 4, side: 4, fill: 4, deep: 3 },
        peak: { top: 3, side: 3, fill: 3, deep: 3 },
        liquid: { top: 5, side: 5, fill: 6, deep: 3 },
        patch: null,
        liquidLevel: -1,
      };
  }
}

/**
 * 地形高度（格，整数）：两层噪声（波长约 26 格和 9 格）叠起来，relief 是起伏的幅度（0 平地，1 约 −5.5 到 +8.5 格）。
 * n1、n2 是 [-1, 1] 的噪声值。
 */
export function terrainHeight(n1: number, n2: number, relief: number): number {
  // 整体抬高一点：水只积在最低的几处，沙滩是水边的一圈，大部分是草地
  return Math.round(relief * (1.5 + 7 * (0.7 * n1 + 0.3 * n2)));
}

/**
 * 一柱用哪种地表，和它的顶面高度：低于水面的变成水（顶面在水面上）；和水面一样高的一圈是水边；
 * PEAK_LEVEL 及以上露出高处的方块；patchNoise > 0.55 的地方换成零星的那一种。
 */
export function columnSurface(p: Palette, height: number, patchNoise: number): { surface: Surface; top: number } {
  if (p.liquid && height < p.liquidLevel) return { surface: p.liquid, top: p.liquidLevel };
  if (p.liquid && height === p.liquidLevel) return { surface: p.shore, top: height };
  if (height >= PEAK_LEVEL) return { surface: p.peak, top: height };
  if (p.patch && patchNoise > 0.55) return { surface: p.patch, top: height };
  return { surface: p.ground, top: height };
}

/** 这个高度及以上露出高处的方块（平原的石头、雪原的石头、下界的绯红菌岩） */
export const PEAK_LEVEL = 4;

export interface Ray {
  /** 方向（单位向量） */
  dx: number;
  dy: number;
  dz: number;
}

/**
 * 镜头：看向原点，俯角 tilt（度，90 是正上方往下看），离原点 distance 格。返回位置和视野四个角的方向。
 * 画面的四个角：水平方向 ±tan(半视角) × 宽高比、竖直方向 ±tan(半视角)。
 */
export function cameraRig(tiltDeg: number, distance: number, fovDeg: number, aspect: number): { x: number; y: number; z: number; corners: Ray[] } {
  const tilt = (tiltDeg * Math.PI) / 180;
  const y = distance * Math.sin(tilt);
  const z = distance * Math.cos(tilt);
  // 镜头坐标系：forward 指向原点，right 沿 +x，up = right × forward
  const fwd = [0, -Math.sin(tilt), -Math.cos(tilt)];
  const right = [1, 0, 0];
  const up = [0, Math.cos(tilt), -Math.sin(tilt)];
  const th = Math.tan((fovDeg * Math.PI) / 360);
  const corners: Ray[] = [];
  for (const [sx, sy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]] as const) {
    const d = [0, 1, 2].map((k) => fwd[k]! + sx * th * aspect * right[k]! + sy * th * up[k]!);
    const len = Math.hypot(d[0]!, d[1]!, d[2]!);
    corners.push({ dx: d[0]! / len, dy: d[1]! / len, dz: d[2]! / len });
  }
  return { x: 0, y, z, corners };
}

/**
 * 世界坐标的点投影到画面上（−1 到 1，sy 向上）：镜头在 cam、看向原点、俯角 tilt。点在镜头后面时返回 null。
 * 和 cameraRig 用同一套镜头坐标系（forward 指向原点，right 沿 +x）。
 */
export function projectToScreen(cam: { x: number; y: number; z: number }, tiltDeg: number, fovDeg: number, aspect: number, x: number, y: number, z: number): { sx: number; sy: number } | null {
  const tilt = (tiltDeg * Math.PI) / 180;
  const dx = x - cam.x;
  const dy = y - cam.y;
  const dz = z - cam.z;
  const depth = -Math.sin(tilt) * dy - Math.cos(tilt) * dz;
  if (depth <= 1e-6) return null;
  const right = dx;
  const up = Math.cos(tilt) * dy - Math.sin(tilt) * dz;
  const th = Math.tan((fovDeg * Math.PI) / 360);
  return { sx: right / (depth * th * aspect), sy: up / (depth * th) };
}

/**
 * 视野的四个角的射线落在高度 plane 的水平面上的点（x, z），格；某条射线朝上（看得到地平线）时返回 null。
 */
export function footprint(cam: { x: number; y: number; z: number; corners: Ray[] }, plane: number): [number, number][] | null {
  const out: [number, number][] = [];
  for (const r of cam.corners) {
    if (r.dy >= -1e-6) return null;
    const t = (plane - cam.y) / r.dy;
    out.push([cam.x + r.dx * t, cam.z + r.dz * t]);
  }
  return out;
}

/** 平面上一组点的凸包（逆时针，单调链算法） */
export function convexHull(points: readonly (readonly [number, number])[]): [number, number][] {
  const pts = [...points].map((p) => [p[0], p[1]] as [number, number]).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (pts.length < 3) return pts;
  const cross = (o: [number, number], a: [number, number], b: [number, number]) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower: [number, number][] = [];
  for (const p of pts) {
    while (lower.length >= 2 && cross(lower[lower.length - 2]!, lower[lower.length - 1]!, p) <= 0) lower.pop();
    lower.push(p);
  }
  const upper: [number, number][] = [];
  for (const p of [...pts].reverse()) {
    while (upper.length >= 2 && cross(upper[upper.length - 2]!, upper[upper.length - 1]!, p) <= 0) upper.pop();
    upper.push(p);
  }
  return [...lower.slice(0, -1), ...upper.slice(0, -1)];
}

/** 点 (x, z) 到凸包（逆时针）里面的“余量”：在里面是正的（离最近的边多远），外面是负的 */
export function hullInset(hull: readonly (readonly [number, number])[], x: number, z: number): number {
  let inset = Infinity;
  for (let i = 0; i < hull.length; i++) {
    const a = hull[i]!;
    const b = hull[(i + 1) % hull.length]!;
    const ex = b[0] - a[0];
    const ez = b[1] - a[1];
    const len = Math.hypot(ex, ez) || 1;
    // 逆时针：边的左侧是里面
    inset = Math.min(inset, (ex * (z - a[1]) - ez * (x - a[0])) / len);
  }
  return inset;
}

/**
 * 镜头离原点多远：画面的短边方向在原点处大约看到 view 格。横屏、方屏按竖直视角，竖屏按水平视角。
 */
export function cameraDistance(view: number, fovDeg: number, aspect: number): number {
  const th = Math.tan((fovDeg * Math.PI) / 360);
  return view / 2 / (th * Math.min(1, aspect));
}

/**
 * 区块升起的先后（还没归一化）：按区块中心在画面上的位置算（sx、sy 是投影后的坐标，−1 到 1，sy 向上），
 * 这样远处的区块（画面上很扁）不会占掉大半的时间。nearFirst 画面下方先、centerOut 从画面中间往外、random 随机；
 * 前两种加一点随机（r 是 [0, 1) 的随机数），同一排不会同时升起。
 */
export function chunkOrder(order: ChunkOrder, sx: number, sy: number, r: number): number {
  if (order === 'random') return r;
  if (order === 'centerOut') return Math.hypot(sx, sy) * 0.85 + 0.15 * r * Math.SQRT2;
  return (sy + 1) / 2 * 0.85 + 0.15 * r;
}
