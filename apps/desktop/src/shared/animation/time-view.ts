// 时间轴的可见范围（docs/animation-editor.md 第 11 项）：缩放和滚动。null 表示整段（不缩放）。
// 关键帧视图和曲线视图共用同一个范围；纯函数，界面只管把滚轮、按钮换成这里的调用。

export interface TimeView {
  start: number;
  end: number;
}

/** 最多放大到能看清几帧：可见范围至少 0.1 秒（且不小于两帧） */
export const MIN_SPAN = 0.1;

/** 实际的可见范围（null 是整段） */
export function viewRange(view: TimeView | null, duration: number): TimeView {
  return view ? clampView(view, duration) ?? { start: 0, end: duration } : { start: 0, end: duration };
}

/** 收进 [0, duration]、宽度至少 MIN_SPAN；放大到超过整段时回到 null（整段） */
export function clampView(view: TimeView, duration: number): TimeView | null {
  if (!(duration > 0)) return null;
  let span = Math.max(Math.min(MIN_SPAN, duration), view.end - view.start);
  if (span >= duration - 1e-9) return null;
  span = Math.min(span, duration);
  const start = Math.min(Math.max(0, view.start), duration - span);
  return { start, end: start + span };
}

/** 以 anchor 时刻为中心缩放：factor < 1 是放大（可见范围变窄），> 1 是缩小；anchor 在屏幕上的位置不变 */
export function zoomAt(view: TimeView | null, duration: number, anchor: number, factor: number): TimeView | null {
  const cur = viewRange(view, duration);
  const span = cur.end - cur.start;
  const next = span * factor;
  const ratio = span > 0 ? (anchor - cur.start) / span : 0.5;
  return clampView({ start: anchor - ratio * next, end: anchor - ratio * next + next }, duration);
}

/** 平移 dt 秒（到头就停） */
export function panBy(view: TimeView | null, duration: number, dt: number): TimeView | null {
  if (!view) return null;
  const cur = viewRange(view, duration);
  return clampView({ start: cur.start + dt, end: cur.end + dt }, duration);
}

/** 让 t 落在可见范围里（播放头跑出去时跟着翻页）；已经在里面时不动 */
export function revealTime(view: TimeView | null, duration: number, t: number): TimeView | null {
  if (!view) return null;
  const cur = viewRange(view, duration);
  if (t >= cur.start && t <= cur.end) return view;
  const span = cur.end - cur.start;
  return clampView({ start: t - span * 0.1, end: t - span * 0.1 + span }, duration);
}

/** 时刻 → 可见范围里的比例（0 是左边、1 是右边；范围外小于 0 或大于 1） */
export function fracOf(range: TimeView, t: number): number {
  const span = range.end - range.start;
  return span > 0 ? (t - range.start) / span : 0;
}
