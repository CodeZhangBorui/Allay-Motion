// 014 冰封碎裂：结冰的先后、裂纹扩散、碎片什么时候飞、碎片的几何（泰森多边形，共用顶点合并成一张不漏缝的网）。
// 不依赖 ctx 的纯函数，验收测试直接导入。
import { polygonCentroid, voronoiCells, type Point } from '../../_lib/src/shader-voronoi';

export interface Rng {
  next(): number;
}

/** 退出阶段：裂纹在前 CRACK_END 里从撞击点扩散到最远处；碎片从 BURST_START 起陆续飞走 */
export const CRACK_END = 0.32;
export const BURST_START = 0.22;

/** 进入阶段的进度 a → 结冰的阈值：结冰场 f ∈ [0, 1] 小于它的地方已经是冰。a = 0 时为负（一点都没冻），a = 1 时超过 1 */
export const FREEZE_MARGIN = 0.16;
export function freezeThreshold(a: number): number {
  if (a <= 0) return -FREEZE_MARGIN;
  if (a >= 1) return 1 + FREEZE_MARGIN;
  return a * (1 + 2 * FREEZE_MARGIN) - FREEZE_MARGIN;
}

/** 退出阶段的进度 b → 裂纹扩散到的半径（相对撞击点到最远处的距离，0–1.1） */
export function crackRadius(b: number): number {
  if (b <= 0) return 0;
  return Math.min(1.1, (b / CRACK_END) * 1.1);
}

/**
 * 一块碎片自己的进度：离撞击点越远越晚飞（delay ∈ [BURST_START, 0.7]），b = 1 时所有碎片都走完。
 */
export function shardDelay(distance: number, jitter: number): number {
  return BURST_START + Math.min(0.48, Math.max(0, distance) * 0.38 + jitter * 0.1);
}

export function shardProgress(b: number, delay: number): number {
  if (b >= 1) return 1;
  if (b <= delay) return 0;
  return Math.min(1, (b - delay) / (1 - delay));
}

/**
 * 碎片的格点：离撞击点越近越密（碎得越细），在 [x0, x1] × [y0, y1] 里。
 * 半径按 u^0.75 取，角度随机；最后补上四个角附近各一个，免得角上留一大块。
 */
export function shardSites(count: number, impact: Point, x0: number, y0: number, x1: number, y1: number, rng: Rng): Point[] {
  const n = Math.max(4, Math.floor(count));
  const reach = Math.max(Math.hypot(impact[0] - x0, impact[1] - y0), Math.hypot(impact[0] - x1, impact[1] - y0), Math.hypot(impact[0] - x0, impact[1] - y1), Math.hypot(impact[0] - x1, impact[1] - y1));
  const out: Point[] = [];
  for (let guard = 0; out.length < n - 4 && guard < n * 50; guard++) {
    const r = reach * Math.pow(rng.next(), 0.75);
    const a = rng.next() * Math.PI * 2;
    const x = impact[0] + Math.cos(a) * r;
    const y = impact[1] + Math.sin(a) * r;
    if (x > x0 && x < x1 && y > y0 && y < y1) out.push([x, y]);
  }
  const ix = (x1 - x0) * 0.12;
  const iy = (y1 - y0) * 0.12;
  out.push([x0 + ix, y0 + iy], [x1 - ix, y0 + iy], [x0 + ix, y1 - iy], [x1 - ix, y1 - iy]);
  return out;
}

export interface ShardMesh {
  /** 合并后的顶点（x, y） */
  vertices: [number, number][];
  /** 每块碎片：形心和它的顶点序号（逆时针） */
  shards: { center: [number, number]; ring: number[] }[];
}

/**
 * 泰森多边形 → 碎片网：相邻两块共用的顶点合并成同一个（按 tolerance 吸附），拼起来严丝合缝，不会在静止时露出细缝。
 */
export function shardMesh(sites: readonly Point[], x0: number, y0: number, x1: number, y1: number, tolerance = 1e-3): ShardMesh {
  const cells = voronoiCells(sites, x0, y0, x1, y1);
  const vertices: [number, number][] = [];
  const index = new Map<string, number>();
  const key = (x: number, y: number) => `${Math.round(x / tolerance)},${Math.round(y / tolerance)}`;
  const vertexOf = (x: number, y: number): number => {
    const k = key(x, y);
    let i = index.get(k);
    if (i === undefined) {
      // 也看一眼相邻的格子（吸附的边界上）
      for (const dx of [-1, 0, 1]) {
        for (const dy of [-1, 0, 1]) {
          const j = index.get(`${Math.round(x / tolerance) + dx},${Math.round(y / tolerance) + dy}`);
          if (j !== undefined && i === undefined) i = j;
        }
      }
    }
    if (i === undefined) {
      i = vertices.length;
      vertices.push([x, y]);
      index.set(k, i);
    }
    return i;
  };
  const shards: ShardMesh['shards'] = [];
  for (const cell of cells) {
    if (cell.polygon.length < 3) continue;
    const ring: number[] = [];
    for (const [x, y] of cell.polygon) {
      const v = vertexOf(x, y);
      if (ring[ring.length - 1] !== v && ring[0] !== v) ring.push(v);
    }
    if (ring.length < 3) continue;
    shards.push({ center: polygonCentroid(ring.map((i) => vertices[i]!)), ring });
  }
  return { vertices, shards };
}
