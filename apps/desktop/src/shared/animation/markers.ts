// 时间轴的标记点和工作区范围（docs/animation-editor.md 第 11 项）。都只是编辑用的：存在文档里（跟着工程、撤销、代码视图），
// 画面不用它们（Worker 里的运行时不读）。标记是吸附点、可以跳过去；工作区是预览循环播放的范围。纯函数。
import type { AnimationDoc } from './schema';

export type Marker = NonNullable<AnimationDoc['markers']>[number];

const EPS = 1e-6;

function sorted(markers: Marker[]): Marker[] {
  return [...markers].sort((a, b) => a.t - b.t || a.id.localeCompare(b.id));
}

/** 新标记的 id：marker-1、marker-2… */
export function nextMarkerId(doc: AnimationDoc): string {
  const used = new Set((doc.markers ?? []).map((m) => m.id));
  for (let i = 1; ; i++) if (!used.has(`marker-${i}`)) return `marker-${i}`;
}

/** 在 t 加一个标记（同一时刻已有就不加，返回已有的那个） */
export function addMarker(doc: AnimationDoc, t: number, label?: string): { doc: AnimationDoc; id: string } {
  const markers = doc.markers ?? [];
  const same = markers.find((m) => Math.abs(m.t - t) < EPS);
  if (same) return { doc, id: same.id };
  const id = nextMarkerId(doc);
  return { doc: { ...doc, markers: sorted([...markers, { id, t, ...(label ? { label } : {}) }]) }, id };
}

export function moveMarker(doc: AnimationDoc, id: string, t: number): AnimationDoc | null {
  const markers = doc.markers ?? [];
  if (!markers.some((m) => m.id === id)) return null;
  return { ...doc, markers: sorted(markers.map((m) => (m.id === id ? { ...m, t } : m))) };
}

export function renameMarker(doc: AnimationDoc, id: string, label: string): AnimationDoc | null {
  const markers = doc.markers ?? [];
  if (!markers.some((m) => m.id === id)) return null;
  const clean = label.trim().slice(0, 60);
  return { ...doc, markers: markers.map((m) => (m.id === id ? (clean ? { ...m, label: clean } : { id: m.id, t: m.t }) : m)) };
}

export function removeMarker(doc: AnimationDoc, id: string): AnimationDoc | null {
  const markers = doc.markers ?? [];
  if (!markers.some((m) => m.id === id)) return null;
  const next = markers.filter((m) => m.id !== id);
  if (next.length > 0) return { ...doc, markers: next };
  const out: AnimationDoc = { ...doc };
  delete out.markers;
  return out;
}

/**
 * 设工作区的一端（另一端不动；没有工作区时另一端是整段的开头或结尾）。两端重合或反了时拒绝。
 * from、to 都给 null 是清掉工作区
 */
export function setWorkArea(doc: AnimationDoc, duration: number, from: number | null | undefined, to: number | null | undefined): AnimationDoc | null {
  if (from === null && to === null) {
    if (!doc.workArea) return doc;
    const out = { ...doc };
    delete out.workArea;
    return out;
  }
  const cur = doc.workArea ?? { from: 0, to: duration };
  const next = { from: from ?? cur.from, to: to ?? cur.to };
  next.from = Math.max(0, Math.min(duration, next.from));
  next.to = Math.max(0, Math.min(duration, next.to));
  if (next.to - next.from < EPS) return null;
  return { ...doc, workArea: next };
}

/** t 之后（dir = 1）或之前（dir = -1）最近的一个时刻；没有就 null */
export function adjacentTime(times: readonly number[], t: number, dir: 1 | -1): number | null {
  let best: number | null = null;
  for (const x of times) {
    if (dir === 1 ? x > t + EPS && (best === null || x < best) : x < t - EPS && (best === null || x > best)) best = x;
  }
  return best;
}
