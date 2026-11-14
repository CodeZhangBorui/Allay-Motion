// 体素雕塑的各个“形”（docs/decisions.md 官网 · 体素雕塑）。同一批实例方块在这些形之间重组：
// - rest：散在视口里的细尘（少数看得见）和藏在画面外一圈的方块（大多数，缩成 0）；正文多的几节用它；
// - allay：首屏的体素悦灵，按 packages/mascot 里悦灵模型的长方体逐个体素化（只取外壳），配色按 docs/07 的调色板；
// - cut：剪辑点的标记 ◆ 做成一颗体素八面体，一根播放头竖着穿过它；
// - timeline：三条轨道上的片段和一根来回走的播放头（开源一节的空白处）；
// - word：页尾的字标，由页面按 DOM 里那段字的字体栅格化出的点阵，两层厚。
// 每个形是一组方块：局部坐标（单位是“一格体素”）、大小、颜色、贴图格、部件编号。全部是确定性的（同样的输入得到同样的数组）。
import { ALLAY_PALETTE, ALLAY_PARTS, type ModelPart } from '@allay/mascot/model';

export const FORM_NAMES = ['rest', 'allay', 'cut', 'timeline', 'word'] as const;
export type FormName = (typeof FORM_NAMES)[number];
export const FORM_INDEX: Record<FormName, number> = { rest: 0, allay: 1, cut: 2, timeline: 3, word: 4 };

/** 贴图集里的格子（8×4，每格 16×16）。0 是生成的细噪点（纯色方块用它带一点颗粒），其余是原版方块贴图 */
export const TILES: { id: string | null; fallback: string }[] = [
  { id: null, fallback: '#ffffff' },
  { id: 'minecraft:diamond_block', fallback: '#52D6DC' },
  { id: 'minecraft:packed_ice', fallback: '#9CC3F5' },
  { id: 'minecraft:lapis_block', fallback: '#2F5DB8' },
  { id: 'minecraft:amethyst_block', fallback: '#9B85E8' },
  { id: 'minecraft:sea_lantern', fallback: '#A9DCD3' },
  { id: 'minecraft:gold_block', fallback: '#F2C94C' },
  { id: 'minecraft:quartz_block', fallback: '#ECE6DE' },
  { id: 'minecraft:black_concrete', fallback: '#141518' },
  { id: 'minecraft:light_blue_concrete', fallback: '#3AAFD9' },
  { id: 'minecraft:cyan_concrete', fallback: '#158991' },
  { id: 'minecraft:purple_concrete', fallback: '#64209C' },
  { id: 'minecraft:white_concrete', fallback: '#CFD5D6' },
  { id: 'minecraft:obsidian', fallback: '#22183A' },
  { id: 'minecraft:snow_block', fallback: '#F0FBFB' },
  { id: 'minecraft:ice', fallback: '#91B7FD' },
  { id: 'minecraft:orange_concrete', fallback: '#E06101' },
  { id: 'minecraft:blue_concrete', fallback: '#2D2F8F' },
  { id: 'minecraft:magenta_concrete', fallback: '#A9309F' },
  { id: 'minecraft:yellow_concrete', fallback: '#F1AF15' },
];
const T = Object.fromEntries(TILES.map((t, i) => [t.id ?? 'noise', i])) as Record<string, number>;

/** 部件编号：着色器按它做局部动作（翅膀扇、宝石转、播放头走） */
export const PART = { none: 0, rightWing: 5, leftWing: 6, gem: 8, playhead: 9 } as const;

/** 一个形：每块方块 4 + 4 个数（x、y、z、大小；r、g、b 线性色，贴图格 + 32 × 部件） */
export interface Form {
  count: number;
  pos: Float32Array;
  col: Float32Array;
  /** 局部坐标的范围（最小 x、最大 x、最小 y、最大 y），放进页面上的框时按它缩放；也用来排入场的先后 */
  bounds: [number, number, number, number];
  /** 两只翅膀的转轴（局部坐标） */
  pivot?: [number, number, number];
  pivotL?: [number, number, number];
  /** 播放头走的宽度（局部坐标） */
  playWidth?: number;
}

export function h01(n: number, seed: number): number {
  let x = Math.imul(n + 1, 2654435761) ^ Math.imul(seed + 7, 1597334677);
  x = Math.imul(x ^ (x >>> 15), 2246822519);
  x = Math.imul(x ^ (x >>> 13), 3266489917);
  return ((x ^ (x >>> 16)) >>> 0) / 4294967296;
}

/** sRGB 十六进制 → 线性 */
function lin(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  const f = (c: number) => {
    const v = c / 255;
    return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  return [f((n >> 16) & 255), f((n >> 8) & 255), f(n & 255)];
}
const WHITE: [number, number, number] = [1, 1, 1];

class Builder {
  private p: number[] = [];
  private c: number[] = [];
  add(x: number, y: number, z: number, s: number, rgb: [number, number, number], tile: number, part = 0): void {
    this.p.push(x, y, z, s);
    this.c.push(rgb[0], rgb[1], rgb[2], tile + 32 * part);
  }
  get size(): number {
    return this.p.length / 4;
  }
  /** 确定性地打乱顺序（实例 i 在各形里落到哪块是随机的，重组时方块交叉着飞），再居中、截到 max 块 */
  finish(max: number, seed: number, extra: Partial<Form> = {}): Form {
    const n = this.size;
    const order = Array.from({ length: n }, (_, i) => i);
    for (let i = n - 1; i > 0; i--) {
      const j = Math.floor(h01(i, seed) * (i + 1));
      [order[i], order[j]] = [order[j]!, order[i]!];
    }
    const count = Math.min(n, max);
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    for (let i = 0; i < n; i++) {
      minX = Math.min(minX, this.p[i * 4]!);
      maxX = Math.max(maxX, this.p[i * 4]!);
      minY = Math.min(minY, this.p[i * 4 + 1]!);
      maxY = Math.max(maxY, this.p[i * 4 + 1]!);
    }
    const cx = (minX + maxX) / 2;
    const cy = (minY + maxY) / 2;
    const pos = new Float32Array(count * 4);
    const col = new Float32Array(count * 4);
    for (let k = 0; k < count; k++) {
      const i = order[k]!;
      pos[k * 4] = this.p[i * 4]! - cx;
      pos[k * 4 + 1] = this.p[i * 4 + 1]! - cy;
      pos[k * 4 + 2] = this.p[i * 4 + 2]!;
      pos[k * 4 + 3] = this.p[i * 4 + 3]!;
      col.set(this.c.slice(i * 4, i * 4 + 4), k * 4);
    }
    const out: Form = { count, pos, col, bounds: [minX - cx - 0.5, maxX - cx + 0.5, minY - cy - 0.5, maxY - cy + 0.5], ...extra };
    if (out.pivot) out.pivot = [out.pivot[0] - cx, out.pivot[1] - cy, out.pivot[2]];
    if (out.pivotL) out.pivotL = [out.pivotL[0] - cx, out.pivotL[1] - cy, out.pivotL[2]];
    return out;
  }
}

// —— 悦灵 ——

// 调色板来自 packages/mascot（docs/07 7.2），这里只换成线性色
const PAL = {
  hl: lin(ALLAY_PALETTE.highlight),
  light: lin(ALLAY_PALETTE.light),
  main: lin(ALLAY_PALETTE.main),
  dark: lin(ALLAY_PALETTE.dark),
  eye: lin(ALLAY_PALETTE.eye),
  eyeHl: lin(ALLAY_PALETTE.eyeHighlight),
};

/** 绕 Y 轴、X 轴转（模型坐标，单位模型像素） */
function rotY(p: [number, number, number], a: number): [number, number, number] {
  const c = Math.cos(a);
  const s = Math.sin(a);
  return [p[0] * c + p[2] * s, p[1], -p[0] * s + p[2] * c];
}
function rotX(p: [number, number, number], a: number): [number, number, number] {
  const c = Math.cos(a);
  const s = Math.sin(a);
  return [p[0], p[1] * c - p[2] * s, p[1] * s + p[2] * c];
}

/** 各部件枢轴的绝对位置（模型坐标） */
function pivots(): Map<string, [number, number, number]> {
  const out = new Map<string, [number, number, number]>();
  for (const part of ALLAY_PARTS) {
    const parent: [number, number, number] = (part.parent ? out.get(part.parent) : undefined) ?? [0, 0, 0];
    out.set(part.name, [parent[0] + part.pivot[0], parent[1] + part.pivot[1], parent[2] + part.pivot[2]]);
  }
  return out;
}

/**
 * 体素悦灵：每个模型像素切成 k 格，只留长方体的外壳。姿势：翅膀向两侧张开 35°，两只手略往前抬。
 * 模型坐标是 Y 朝下、正面朝 −Z，换成 three 的（Y 朝上、正面朝 +Z）：y、z 取反。
 */
export function allayForm(k: number, max: number): Form {
  const b = new Builder();
  const piv = pivots();
  const body = ALLAY_PARTS.find((p) => p.name === 'body')!;
  const bodyBox = body.boxes[0]!;
  const bodyPiv = piv.get('body')!;
  const inBody = (x: number, y: number, z: number) =>
    x > bodyPiv[0] + bodyBox.origin[0] && x < bodyPiv[0] + bodyBox.origin[0] + bodyBox.size[0] && y > bodyPiv[1] + bodyBox.origin[1] && y < bodyPiv[1] + bodyBox.origin[1] + bodyBox.size[1] && z > bodyPiv[2] + bodyBox.origin[2] && z < bodyPiv[2] + bodyBox.origin[2] + bodyBox.size[2];
  let wingPivot: [number, number, number] = [0, 0, 0];
  let wingPivotL: [number, number, number] = [0, 0, 0];
  let partIdx = 0;
  for (const part of ALLAY_PARTS as readonly ModelPart[]) {
    partIdx++;
    const pv = piv.get(part.name)!;
    const wing = part.name === 'rightWing' || part.name === 'leftWing';
    const arm = part.name === 'rightArm' || part.name === 'leftArm';
    const pose = (p: [number, number, number]): [number, number, number] => {
      // 部件内的点（相对枢轴）先摆姿势再加上枢轴
      let q = p;
      if (wing) q = rotY(q, part.name === 'rightWing' ? -0.5 : 0.5);
      if (arm) q = rotX(q, -0.32);
      return [q[0] + pv[0], q[1] + pv[1], q[2] + pv[2]];
    };
    if (part.name === 'rightWing') wingPivot = [pv[0] * k, -pv[1] * k, -pv[2] * k];
    if (part.name === 'leftWing') wingPivotL = [pv[0] * k, -pv[1] * k, -pv[2] * k];
    part.boxes.forEach((box, bi) => {
      const g = box.grow;
      const o: [number, number, number] = [box.origin[0] - g, box.origin[1] - g, box.origin[2] - g];
      const sz: [number, number, number] = [box.size[0] + 2 * g, box.size[1] + 2 * g, box.size[2] + 2 * g];
      const n: [number, number, number] = [Math.max(1, Math.round(sz[0] * k)), Math.max(1, Math.round(sz[1] * k)), Math.max(1, Math.round(sz[2] * k))];
      const skirt = part.name === 'body' && bi === 1;
      for (let ix = 0; ix < n[0]; ix++) {
        for (let iy = 0; iy < n[1]; iy++) {
          for (let iz = 0; iz < n[2]; iz++) {
            const edge = ix === 0 || iy === 0 || iz === 0 || ix === n[0] - 1 || iy === n[1] - 1 || iz === n[2] - 1;
            if (!edge) continue;
            // 翅膀在游戏里是半透明的、带形状的（贴图里有透明的部分）：下沿往翅尖收、翅尖收圆，
            // 里面做成隔一格放一块的网格（边上一圈实的），看上去是透的
            if (wing) {
              const v = iy / (n[1] - 1);
              const w = iz / (n[2] - 1);
              const bottom = 1 - 0.62 * w ** 1.3;
              const top = 0.18 * Math.max(0, (w - 0.75) / 0.25) ** 2;
              if (v > bottom + 0.02 || v < top - 0.02) continue;
              const rim = v > bottom - 1.2 / n[1] || v < top + 1.2 / n[1] || iz === 0 || iz === n[2] - 1;
              if (!rim && (iy + iz) % 2 === 1) continue;
            }
            const local: [number, number, number] = [o[0] + ((ix + 0.5) / n[0]) * sz[0], o[1] + ((iy + 0.5) / n[1]) * sz[1], o[2] + ((iz + 0.5) / n[2]) * sz[2]];
            const m = pose(local);
            if (skirt && inBody(m[0], m[1], m[2])) continue;
            // 配色：头的正面画眼睛；顶面亮、底面暗；其余按部件给底色，零星掺一点相邻的色，像原版贴图的颗粒。
            // 颗粒按“模型像素”取（同一个模型像素里的 k×k 格同色），看上去就是原版那种像素贴图
            const texel = Math.floor(local[0] + 8) * 4096 + Math.floor(local[1] + 8) * 64 + Math.floor(local[2] + 8) + partIdx * 262144;
            const r = h01(texel, 91);
            let rgb = PAL.main;
            if (part.name === 'head') {
              const front = iz === 0;
              const u = (local[0] + 2.5) / 5; // 从观者左边起
              const v = (local[1] + 5) / 5; // 从头顶起
              if (iy === 0) rgb = r < 0.3 ? PAL.hl : PAL.light;
              else if (iy === n[1] - 1) rgb = PAL.dark;
              else if (front && v > 0.4 && v < 0.8 && ((u > 0.2 && u < 0.4) || (u > 0.6 && u < 0.8))) {
                const eu = ((u > 0.5 ? u - 0.6 : u - 0.2) / 0.2) % 1;
                rgb = eu < 0.5 && v < 0.55 ? PAL.eyeHl : PAL.eye;
              } else rgb = r < 0.12 ? PAL.light : r < 0.2 ? PAL.dark : PAL.main;
              if (front && v > 0.82 && rgb === PAL.main) rgb = PAL.dark;
            } else if (part.name === 'body') {
              rgb = skirt ? (r < 0.4 ? PAL.light : PAL.hl) : r < 0.18 ? PAL.hl : r < 0.26 ? PAL.main : PAL.light;
            } else if (arm) {
              rgb = iy >= n[1] - 2 ? PAL.light : r < 0.15 ? PAL.dark : PAL.main;
            } else if (wing) {
              const tip = local[2] / sz[2];
              rgb = tip > 0.85 || local[1] - o[1] > sz[1] * 0.85 ? PAL.light : r < 0.1 ? PAL.light : PAL.hl;
            }
            const scale = wing ? 0.9 : skirt ? 0.84 : 0.9;
            b.add(m[0] * k, -m[1] * k, -m[2] * k, scale, rgb, T.noise!, part.name === 'rightWing' ? PART.rightWing : part.name === 'leftWing' ? PART.leftWing : PART.none);
          }
        }
      }
    });
  }
  return b.finish(max, 17, { pivot: wingPivot, pivotL: wingPivotL });
}

// —— 剪辑点 ◆ ——

export function cutForm(k: number, max: number): Form {
  const b = new Builder();
  const R = Math.max(6, Math.round(k * 2.6));
  for (let x = -R; x <= R; x++) {
    for (let y = -R; y <= R; y++) {
      for (let z = -R; z <= R; z++) {
        const d = Math.abs(x) + Math.abs(y) + Math.abs(z);
        if (d > R || d < R - 1.5) continue;
        const r = h01((x + 64) * 16384 + (y + 64) * 128 + z + 64, 5);
        const tile = y < -R * 0.35 && r < 0.45 ? T['minecraft:orange_concrete']! : r < 0.12 ? T['minecraft:yellow_concrete']! : T['minecraft:gold_block']!;
        b.add(x, y, z, 0.92, WHITE, tile, PART.gem);
      }
    }
  }
  // 播放头：一根竖线穿过宝石，顶上一个倒三角（与导航里的播放头同形）
  const top = Math.round(R * 2.1);
  const bottom = -Math.round(R * 2.1);
  const blue = T['minecraft:light_blue_concrete']!;
  for (let y = bottom; y <= top; y++) {
    if (Math.abs(y) <= R) continue;
    b.add(0, y, 0, 0.92, WHITE, blue);
  }
  for (let row = 0; row < 4; row++) {
    for (let x = -3 + row; x <= 3 - row; x++) b.add(x, top + 4 - row, 0, 0.92, WHITE, blue);
  }
  return b.finish(max, 23);
}

// —— 时间线 ——

export function timelineForm(k: number, max: number): Form {
  const b = new Builder();
  const W = Math.round(k * 17);
  const h = Math.max(3, Math.round(k * 0.9));
  const gap = Math.max(1, Math.round(k * 0.45));
  const depth = 2;
  const tracks = [
    [T['minecraft:light_blue_concrete']!, T['minecraft:cyan_concrete']!],
    [T['minecraft:purple_concrete']!, T['minecraft:magenta_concrete']!],
    [T['minecraft:white_concrete']!, T['minecraft:snow_block']!],
  ];
  let seq = 0;
  tracks.forEach((pair, ti) => {
    const y0 = (1 - ti) * (h + gap);
    let x = 0;
    let clip = 0;
    while (x < W) {
      const len = Math.round(k * (2.2 + h01(ti * 31 + clip, 3) * 4.5));
      const end = Math.min(W, x + len);
      const tile = pair[clip % 2]!;
      for (let cx = x; cx < end; cx++) {
        for (let cy = 0; cy < h; cy++) {
          for (let cz = 0; cz < depth; cz++) {
            const edge = cx === x || cx === end - 1 || cy === 0 || cy === h - 1 || cz === 0;
            if (!edge && h01(seq, 9) < 0.5) {
              seq++;
              continue;
            }
            seq++;
            b.add(cx - W / 2, y0 + cy - h / 2, -cz, 0.9, WHITE, tile);
          }
        }
      }
      x = end + Math.max(1, Math.round(k * (0.3 + h01(ti * 17 + clip, 4) * 0.6)));
      clip++;
    }
  });
  // 播放头：竖线 + 顶上的 ◆（剪辑点的颜色）；着色器让它沿 x 来回走
  const yTop = (h + gap) + h / 2 + 2;
  const yBottom = -(h + gap) - h / 2 - 1;
  for (let y = Math.floor(yBottom); y <= yTop; y++) b.add(0, y, 1, 0.9, WHITE, T['minecraft:white_concrete']!, PART.playhead);
  for (let dy = -2; dy <= 2; dy++) {
    for (let dx = -(2 - Math.abs(dy)); dx <= 2 - Math.abs(dy); dx++) b.add(dx, yTop + 3 + dy, 1, 0.9, WHITE, T['minecraft:gold_block']!, PART.playhead);
  }
  return b.finish(max, 29, { playWidth: W });
}

// —— 字标 ——

export interface WordmarkGrid {
  cols: number;
  rows: number;
  /** 有方块的格子（列、行） */
  cells: [number, number][];
}

export function wordForm(grid: WordmarkGrid, theme: 'dark' | 'light', max: number): Form {
  const b = new Builder();
  const [main, accent] = theme === 'dark' ? [T['minecraft:quartz_block']!, T['minecraft:diamond_block']!] : [T['minecraft:black_concrete']!, T['minecraft:lapis_block']!];
  grid.cells.forEach(([gx, gy], i) => {
    const a = h01(i, 77) < 0.05;
    for (let z = 0; z < 2; z++) b.add(gx + 0.5, -(gy + 0.5), -z, 0.97, WHITE, a ? accent : main);
  });
  // 打乱后从散尘飞进来时是交叉着的。finish 按方块中心的范围居中：点阵从 (0, 0) 起，中心正好是点阵的正中，
  // 页面把 DOM 里那段字的墨迹框中心对到局部 (0, 0) 就对齐了
  return b.finish(max, 31);
}

// —— 散尘（rest）——

/**
 * 每个实例在 rest 里的位置。x、y 是视口的归一化坐标（−1–1），z 是深度（世界单位）；着色器按深度换算成世界坐标，
 * 并让看得见的那部分随滚动（阻尼过的）缓缓漂移。看得见的只有 dust 块，其余藏在画面外一圈、缩成 0。
 */
export function restForm(n: number, dust: number): Form {
  const pos = new Float32Array(n * 4);
  const col = new Float32Array(n * 4);
  const dustTiles = [T['minecraft:diamond_block']!, T['minecraft:packed_ice']!, T['minecraft:light_blue_concrete']!, T['minecraft:sea_lantern']!, T['minecraft:amethyst_block']!, T['minecraft:white_concrete']!, T['minecraft:lapis_block']!];
  for (let i = 0; i < n; i++) {
    // 看得见的细尘是最后 dust 个实例（不参与任何雕塑，各节都一样），其余藏在画面外一圈
    if (i >= n - dust) {
      pos[i * 4] = (h01(i, 1) * 2 - 1) * 1.08;
      pos[i * 4 + 1] = (h01(i, 2) * 2 - 1) * 1.25;
      pos[i * 4 + 2] = -14 - h01(i, 3) ** 1.3 * 46;
      pos[i * 4 + 3] = 0.05 + h01(i, 4) * 0.08;
    } else {
      const a = h01(i, 5) * Math.PI * 2;
      const r = 1.3 + h01(i, 6) * 0.5;
      pos[i * 4] = Math.cos(a) * r;
      pos[i * 4 + 1] = Math.sin(a) * r;
      pos[i * 4 + 2] = -24 + h01(i, 7) * 28;
      pos[i * 4 + 3] = 0;
    }
    col[i * 4] = 1;
    col[i * 4 + 1] = 1;
    col[i * 4 + 2] = 1;
    col[i * 4 + 3] = dustTiles[Math.floor(h01(i, 8) * dustTiles.length)]!;
  }
  return { count: n, pos, col, bounds: [-1, 1, -1, 1] };
}
