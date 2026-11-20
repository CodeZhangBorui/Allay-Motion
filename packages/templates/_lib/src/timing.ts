// 时间余量（docs/template-authoring.md 第 5 节、docs/decisions.md M6a“共同做法”）。
// 开了运动模糊时，一帧的子帧最多偏离帧时刻半帧，所以进入、退出阶段各让出一帧：
// [0, pad] 和 [duration − pad, duration] 里阶段进度恒为 0 / 1，转场在 [cutTime − pad, cutTime + pad] 里恒为“进入完、退出未开始”。
// 公式和 block-wipe 等现有模板里各自内联的那份相同。

/** 一个阶段里动画实际发生的时间窗（秒） */
export interface PhaseWindow {
  start: number;
  end: number;
}

export interface Windows {
  duration: number;
  in: PhaseWindow;
  out: PhaseWindow;
}

export interface TransitionWindows extends Windows {
  cutTime: number;
}

const EPS = 1e-4;

/**
 * 转场的时间窗。cutAt 是剪辑点在停留阶段里的位置（0–1，默认正中）。
 * 帧率极低、一帧比半个阶段还长时，余量退回各阶段的一半。
 */
export function transitionWindows(fps: number, inDuration: number, hold: number, outDuration: number, cutAt = 0.5): TransitionWindows {
  const duration = inDuration + hold + outDuration;
  const cutTime = inDuration + hold * Math.min(1, Math.max(0, cutAt));
  const pad = 1 / fps;
  const inStart = Math.min(pad, inDuration / 2);
  const inEnd = Math.max(inStart + EPS, Math.min(inDuration, cutTime - pad));
  const outEnd = duration - Math.min(pad, outDuration / 2);
  const outStart = Math.min(Math.max(inDuration + hold, cutTime + pad), outEnd - EPS);
  return { duration, cutTime, in: { start: inStart, end: inEnd }, out: { start: outStart, end: outEnd } };
}

/** 叠加层、标题的时间窗（没有剪辑点）：进入从 pad 开始，退出在 duration − pad 结束 */
export function overlayWindows(fps: number, inDuration: number, hold: number, outDuration: number): Windows {
  const duration = inDuration + hold + outDuration;
  const pad = 1 / fps;
  const inStart = Math.min(pad, inDuration / 2);
  const inEnd = Math.max(inStart + EPS, inDuration);
  const outEnd = duration - Math.min(pad, outDuration / 2);
  const outStart = Math.min(inDuration + hold, outEnd - EPS);
  return { duration, in: { start: inStart, end: inEnd }, out: { start: outStart, end: outEnd } };
}

/**
 * t 在时间窗里的进度。两端精确取 0 和 1，不经过除法和缓动：
 * 缓动函数在端点不一定精确等于 0、1（贝塞尔就不是），首末帧和剪辑点的断言要的是精确值。
 */
export function progress(t: number, window: PhaseWindow): number {
  if (t <= window.start) return 0;
  if (t >= window.end) return 1;
  return (t - window.start) / (window.end - window.start);
}

/** 带缓动的进度：端点仍然精确是 0 和 1 */
export function eased(t: number, window: PhaseWindow, ease: (x: number) => number): number {
  const p = progress(t, window);
  return p <= 0 ? 0 : p >= 1 ? 1 : ease(p);
}
