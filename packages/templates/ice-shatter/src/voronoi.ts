// 014 冰封碎裂的碎片：泰森多边形（Voronoi）分块。纯函数，不依赖 ctx，验收测试直接导入。
// 只有这一个模板用，所以放在模板自己的目录里（_lib 只放至少两个模板用得上的东西）。
// 做法是半平面裁剪：每个格点从整个矩形开始，依次用它和其他格点的中垂线裁掉远的一半。O(n²)，n 到几百都在毫秒级。

export type Point = readonly [number, number];

export interface VoronoiCell {
  site: Point;
  /** 逆时针的凸多边形（和矩形一样的绕向） */
  polygon: [number, number][];
}

/** 保留离 a 不比离 b 远的那一侧：|p − a|² ≤ |p − b|² ⇔ p·(b − a) ≤ (|b|² − |a|²) / 2 */
function clipHalfPlane(poly: [number, number][], a: Point, b: Point): [number, number][] {
  const nx = b[0] - a[0];
  const ny = b[1] - a[1];
  const c = (b[0] * b[0] + b[1] * b[1] - a[0] * a[0] - a[1] * a[1]) / 2;
  const side = (p: Point) => p[0] * nx + p[1] * ny - c;
  const out: [number, number][] = [];
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i]!;
    const q = poly[(i + 1) % poly.length]!;
    const sp = side(p);
    const sq = side(q);
    if (sp <= 0) out.push(p);
    if ((sp < 0 && sq > 0) || (sp > 0 && sq < 0)) {
      const k = sp / (sp - sq);
      out.push([p[0] + (q[0] - p[0]) * k, p[1] + (q[1] - p[1]) * k]);
    }
  }
  return out;
}

/** 矩形 [x0, x1] × [y0, y1] 里各格点的泰森多边形，顺序和 sites 一致。重合的格点各自得到同一块 */
export function voronoiCells(sites: readonly Point[], x0: number, y0: number, x1: number, y1: number): VoronoiCell[] {
  return sites.map((site, i) => {
    let poly: [number, number][] = [
      [x0, y0],
      [x1, y0],
      [x1, y1],
      [x0, y1],
    ];
    for (let j = 0; j < sites.length && poly.length > 0; j++) {
      if (j === i) continue;
      const other = sites[j]!;
      if (other[0] === site[0] && other[1] === site[1]) continue;
      poly = clipHalfPlane(poly, site, other);
    }
    return { site, polygon: poly };
  });
}

/** 多边形面积（逆时针为正） */
export function polygonArea(poly: readonly Point[]): number {
  let s = 0;
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i]!;
    const q = poly[(i + 1) % poly.length]!;
    s += p[0] * q[1] - q[0] * p[1];
  }
  return s / 2;
}

/** 多边形的形心；退化（面积近 0）时取顶点平均 */
export function polygonCentroid(poly: readonly Point[]): [number, number] {
  const a = polygonArea(poly);
  if (Math.abs(a) < 1e-9) {
    const n = Math.max(1, poly.length);
    return [poly.reduce((s, p) => s + p[0], 0) / n, poly.reduce((s, p) => s + p[1], 0) / n];
  }
  let cx = 0;
  let cy = 0;
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i]!;
    const q = poly[(i + 1) % poly.length]!;
    const cross = p[0] * q[1] - q[0] * p[1];
    cx += (p[0] + q[0]) * cross;
    cy += (p[1] + q[1]) * cross;
  }
  return [cx / (6 * a), cy / (6 * a)];
}
