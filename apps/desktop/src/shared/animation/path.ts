// 路径动画的几何（docs/animation-editor.md 3.7）：一条由点和贝塞尔手柄组成的路径，按“走过的长度的比例”取位置，
// 这样 progress 匀速变化时图层也匀速走（不按参数 t，参数 t 在弯的地方会忽快忽慢）。
// 编辑器（预览里画路径、算框）用这里；Worker 里 runtime.template.js 有同样规则的一份（T-ANIM-28 核对两边一致）。
import { z } from 'zod';

const finite = z.number().refine(Number.isFinite, 'must be a finite number');
const Vec = z.strictObject({ x: finite.min(-8000).max(8000), y: finite.min(-8000).max(8000) });

/** 路径上的一个点：位置，和相对它的入、出手柄（不给就是直线） */
export const PathPointSchema = z.strictObject({ x: finite.min(-8000).max(8000), y: finite.min(-8000).max(8000), in: Vec.optional(), out: Vec.optional() });
export type PathPoint = z.infer<typeof PathPointSchema>;

export const PathSchema = z.strictObject({
  points: z.array(PathPointSchema).min(2).max(64),
  /** 首尾相接 */
  closed: z.boolean().default(false),
  /** 自动朝向：图层的 rotZ 加上路径在这一点的切线方向 */
  orient: z.boolean().default(false),
});
export type AnimPath = z.infer<typeof PathSchema>;

/** 每段分多少小段估长度 */
const STEPS = 32;

type P = { x: number; y: number };

function cubic(a: P, b: P, c: P, d: P, u: number): P {
  const v = 1 - u;
  return { x: v * v * v * a.x + 3 * v * v * u * b.x + 3 * v * u * u * c.x + u * u * u * d.x, y: v * v * v * a.y + 3 * v * v * u * b.y + 3 * v * u * u * c.y + u * u * u * d.y };
}

/** 第 i 段的四个控制点（closed 时最后一段从最后一点回到第一点） */
function segment(path: AnimPath, i: number): [P, P, P, P] {
  const n = path.points.length;
  const a = path.points[i]!;
  const b = path.points[(i + 1) % n]!;
  return [a, { x: a.x + (a.out?.x ?? 0), y: a.y + (a.out?.y ?? 0) }, { x: b.x + (b.in?.x ?? 0), y: b.y + (b.in?.y ?? 0) }, b];
}

export interface PathTable {
  /** 每个采样点的累计长度和对应的 (段, u) */
  lengths: number[];
  seg: number[];
  u: number[];
  total: number;
}

/** 长度表：setup 时算一次 */
export function pathTable(path: AnimPath): PathTable {
  const count = path.closed ? path.points.length : path.points.length - 1;
  const lengths = [0];
  const seg = [0];
  const u = [0];
  let prev = path.points[0]!;
  let total = 0;
  for (let i = 0; i < count; i++) {
    const [a, b, c, d] = segment(path, i);
    for (let k = 1; k <= STEPS; k++) {
      const p = cubic(a, b, c, d, k / STEPS);
      total += Math.hypot(p.x - prev.x, p.y - prev.y);
      lengths.push(total);
      seg.push(i);
      u.push(k / STEPS);
      prev = p;
    }
  }
  return { lengths, seg, u, total };
}

/** progress（0–1，超出钳到两端）处的位置和切线方向（度，逆时针为正，0 是 +x） */
export function pathAt(path: AnimPath, table: PathTable, progress: number): { x: number; y: number; angle: number } {
  const target = Math.min(1, Math.max(0, progress)) * table.total;
  const L = table.lengths;
  let lo = 0;
  let hi = L.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (L[mid]! < target) lo = mid + 1;
    else hi = mid;
  }
  const j = Math.max(1, lo);
  const span = L[j]! - L[j - 1]! || 1;
  const f = (target - L[j - 1]!) / span;
  const s = table.seg[j]!;
  const u0 = table.seg[j - 1] === s ? table.u[j - 1]! : 0;
  const u = u0 + (table.u[j]! - u0) * f;
  const [a, b, c, d] = segment(path, s);
  const p = cubic(a, b, c, d, u);
  const q = cubic(a, b, c, d, Math.min(1, u + 1e-3));
  const r = cubic(a, b, c, d, Math.max(0, u - 1e-3));
  const angle = (Math.atan2(q.y - r.y, q.x - r.x) * 180) / Math.PI;
  return { x: p.x, y: p.y, angle };
}

/** 画路径用的折线（舞台坐标） */
export function pathPolyline(path: AnimPath, steps = 24): P[] {
  const count = path.closed ? path.points.length : path.points.length - 1;
  const out: P[] = [path.points[0]!];
  for (let i = 0; i < count; i++) {
    const [a, b, c, d] = segment(path, i);
    for (let k = 1; k <= steps; k++) out.push(cubic(a, b, c, d, k / steps));
  }
  return out;
}

/** 新路径：从 (x, y) 起往右的一条缓弧，三个点 */
export function defaultPath(x: number, y: number): AnimPath {
  return {
    points: [
      { x: x - 400, y, out: { x: 150, y: 200 } },
      { x, y: y + 150, in: { x: -150, y: 0 }, out: { x: 150, y: 0 } },
      { x: x + 400, y, in: { x: -150, y: 200 } },
    ],
    closed: false,
    orient: false,
  };
}
