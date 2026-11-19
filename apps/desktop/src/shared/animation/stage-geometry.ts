// 预览里直接选中、变换图层用的平面几何（docs/animation-editor.md 10.9）。编辑器自己算，不问引擎：
// 每个图层在舞台平面上的位置、旋转、缩放（沿父级相乘），以及它在自己坐标里的半宽半高。
// 坐标是舞台的设计单位（原点在中心、+y 向上），与 ctx.stage 和动画文档一致。
//
// 这是一个平面近似：只取 x、y、rotZ、scale 组成平面变换；z 和透视不算（透视相机下框会偏），
// rotX / rotY 只用来算方块、物品在画面上投影出来的外框。文字的宽高按字数估（一个字 6 个字体像素宽、9 个高），
// 与引擎排出来的会有出入。这些都写进 10.9。
import type { EaseEval } from './edit';
import { propValue } from './edit';
import type { ResolvedDoc, ResolvedLayer } from './resolve';
import { pathAt, pathTable } from './path';

/** 平面仿射：x' = a·x + c·y + e，y' = b·x + d·y + f */
export interface Affine {
  a: number;
  b: number;
  c: number;
  d: number;
  e: number;
  f: number;
}

export const IDENTITY: Affine = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };

export function multiply(m: Affine, n: Affine): Affine {
  return { a: m.a * n.a + m.c * n.b, b: m.b * n.a + m.d * n.b, c: m.a * n.c + m.c * n.d, d: m.b * n.c + m.d * n.d, e: m.a * n.e + m.c * n.f + m.e, f: m.b * n.e + m.d * n.f + m.f };
}

export function invert(m: Affine): Affine {
  const det = m.a * m.d - m.b * m.c || 1e-12;
  return { a: m.d / det, b: -m.b / det, c: -m.c / det, d: m.a / det, e: (m.c * m.f - m.d * m.e) / det, f: (m.b * m.e - m.a * m.f) / det };
}

export function apply(m: Affine, x: number, y: number): { x: number; y: number } {
  return { x: m.a * x + m.c * y + m.e, y: m.b * x + m.d * y + m.f };
}

/** 平移 · 旋转（度，逆时针为正）· 缩放 */
export function trs(x: number, y: number, rotDeg: number, scale: number): Affine {
  const r = (rotDeg * Math.PI) / 180;
  const cos = Math.cos(r) * scale;
  const sin = Math.sin(r) * scale;
  return { a: cos, b: sin, c: -sin, d: cos, e: x, f: y };
}

export interface LayerFrame {
  id: string;
  /** 父级链上的平面变换（不含图层自己的大小） */
  parent: Affine;
  /** 整个世界变换 = parent · trs(x, y, rotZ, scale) */
  world: Affine;
  /** 图层自己坐标里的外框半宽、半高（设计单位，已乘图层自己的大小） */
  halfW: number;
  halfH: number;
  visible: boolean;
  locked: boolean;
  /** 在 doc.layers 里的位置（画的顺序） */
  index: number;
  /** 这一刻的 x、y（有路径时是相对路径的偏移） */
  offset: { x: number; y: number };
  /** 路径在这一刻贡献的位置和朝向（没有路径时是 0）：预览里移动、旋转时要先减掉 */
  onPath: { x: number; y: number; angle: number };
}

/** 边长 1 的立方体按 rotX / rotY 转过之后（YXZ 顺序，同 Worker 里的 Euler）在画面上的半宽、半高 */
export function projectedCubeHalf(rotXDeg: number, rotYDeg: number): { hw: number; hh: number } {
  const rx = (rotXDeg * Math.PI) / 180;
  const ry = (rotYDeg * Math.PI) / 180;
  let hw = 0;
  let hh = 0;
  for (const sx of [-0.5, 0.5])
    for (const sy of [-0.5, 0.5])
      for (const sz of [-0.5, 0.5]) {
        // 先绕 x 再绕 y（YXZ：R = Ry · Rx），取投影到 xy 平面的坐标
        const y1 = sy * Math.cos(rx) - sz * Math.sin(rx);
        const z1 = sy * Math.sin(rx) + sz * Math.cos(rx);
        const x2 = sx * Math.cos(ry) + z1 * Math.sin(ry);
        hw = Math.max(hw, Math.abs(x2));
        hh = Math.max(hh, Math.abs(y1));
      }
  return { hw, hh };
}

/** 图层自己坐标里的外框（不含 x、y、rotZ、scale） */
export function layerExtent(layer: ResolvedLayer, rotX: number, rotY: number): { hw: number; hh: number } {
  switch (layer.type) {
    case 'block': {
      const c = projectedCubeHalf(rotX, rotY);
      return { hw: c.hw * layer.size, hh: c.hh * layer.size };
    }
    case 'item':
      return { hw: layer.size / 2, hh: layer.size / 2 };
    case 'text': {
      const lines = layer.text.split('\n');
      const longest = Math.max(...lines.map((l) => [...l].length));
      return { hw: (longest * 6 * layer.size) / 2, hh: (lines.length * 9 * layer.size) / 2 };
    }
    case 'rect':
    case 'ellipse':
    case 'line':
    case 'image':
      return { hw: layer.width / 2, hh: layer.height / 2 };
    default:
      // 组：画一个小方框表示它的原点
      return { hw: 12, hh: 12 };
  }
}

/** 某一刻每个图层的平面框（按 doc.layers 的顺序） */
export function layerFrames(doc: ResolvedDoc, t: number, ease: EaseEval): LayerFrame[] {
  const byId = new Map(doc.layers.map((l, i) => [l.id, i]));
  const out: (LayerFrame | undefined)[] = new Array(doc.layers.length);
  const visit = (i: number, depth: number): LayerFrame => {
    const done = out[i];
    if (done) return done;
    const l = doc.layers[i]!;
    const pi = l.parent !== undefined ? byId.get(l.parent) : undefined;
    const parentFrame = pi !== undefined && depth < 64 ? visit(pi, depth + 1) : null;
    const v = (p: Parameters<typeof propValue>[1]) => propValue(l, p, t, ease);
    // 路径：位置是路径上的点加上 x、y；自动朝向时 rotZ 加上切线方向（同 Worker）
    const on = l.path ? pathAt(l.path, pathTable(l.path), v('progress')) : null;
    const world = multiply(parentFrame ? parentFrame.world : IDENTITY, trs(v('x') + (on?.x ?? 0), v('y') + (on?.y ?? 0), v('rotZ') + (on && l.path?.orient ? on.angle : 0), v('scale')));
    const { hw, hh } = layerExtent(l, v('rotX'), v('rotY'));
    const inside = t >= (l.from ?? 0) && t < (l.to ?? Infinity) && l.hidden !== true;
    const frame: LayerFrame = {
      id: l.id,
      parent: parentFrame ? parentFrame.world : IDENTITY,
      world,
      halfW: hw,
      halfH: hh,
      visible: inside && (parentFrame ? parentFrame.visible : true),
      locked: l.locked === true,
      index: i,
      offset: { x: v('x'), y: v('y') },
      onPath: on ? { x: on.x, y: on.y, angle: l.path?.orient ? on.angle : 0 } : { x: 0, y: 0, angle: 0 },
    };
    out[i] = frame;
    return frame;
  };
  for (let i = 0; i < doc.layers.length; i++) visit(i, 0);
  return out as LayerFrame[];
}

/** 一个框在舞台上的四个角（设计单位）：左上、右上、右下、左下 */
export function corners(f: LayerFrame): { x: number; y: number }[] {
  return [
    apply(f.world, -f.halfW, f.halfH),
    apply(f.world, f.halfW, f.halfH),
    apply(f.world, f.halfW, -f.halfH),
    apply(f.world, -f.halfW, -f.halfH),
  ];
}

/** 点中了哪个图层：画在最前面的、可见、没锁定的、框里包住这个点的；组不参与（它没有画面） */
export function hitTest(frames: readonly LayerFrame[], doc: ResolvedDoc, x: number, y: number): string | null {
  const sorted = [...frames].sort((p, q) => q.index - p.index);
  for (const f of sorted) {
    if (!f.visible || f.locked || doc.layers[f.index]!.type === 'group') continue;
    const local = apply(invert(f.world), x, y);
    if (Math.abs(local.x) <= f.halfW && Math.abs(local.y) <= f.halfH) return f.id;
  }
  return null;
}

/**
 * 吸附：拖动时图层中心（舞台坐标）靠近舞台中线、别的图层的中心时吸过去。tolerance 是设计单位。
 * 返回吸附后的点和画参考线用的位置（竖线的 x、横线的 y）。
 */
export function snapPoint(p: { x: number; y: number }, targets: readonly { x: number; y: number }[], tolerance: number): { x: number; y: number; guideX: number | null; guideY: number | null } {
  let x = p.x;
  let y = p.y;
  let guideX: number | null = null;
  let guideY: number | null = null;
  let bx = tolerance;
  let by = tolerance;
  for (const t of [{ x: 0, y: 0 }, ...targets]) {
    const dx = Math.abs(t.x - p.x);
    const dy = Math.abs(t.y - p.y);
    if (dx <= bx) {
      bx = dx;
      x = t.x;
      guideX = t.x;
    }
    if (dy <= by) {
      by = dy;
      y = t.y;
      guideY = t.y;
    }
  }
  return { x, y, guideX, guideY };
}

/** 舞台的设计尺寸（短边恒为 1080，同引擎的 computeStage；这里不引用引擎，免得把 three 带进界面的主包） */
export function stageSize(output: { width: number; height: number }): { width: number; height: number } {
  const k = 1080 / Math.min(output.width, output.height);
  return { width: output.width * k, height: output.height * k };
}
