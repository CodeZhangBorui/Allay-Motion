// 帧的定义（docs/02-engine.md 2.6）。播放条和导出都用这里的函数，不各算各的。

const EPS = 1e-6;

/** 最后一帧的序号：ceil(duration × fps − 10⁻⁶) */
export function lastFrameIndex(duration: number, fps: number): number {
  return Math.max(0, Math.ceil(duration * fps - EPS));
}

/** 帧数：首帧在 t = 0，末帧恰好在 t = duration，两端都渲染 */
export function frameCount(duration: number, fps: number): number {
  return lastFrameIndex(duration, fps) + 1;
}

/** 第 i 帧的时间：min(i / fps, duration) */
export function frameTime(index: number, fps: number, duration: number): number {
  return Math.min(index / fps, duration);
}

/**
 * 输出帧时间 t 的 N 个子帧时间：t_k = t + ((k + 0.5) / N − 0.5) × (A / 360) / fps，钳制到 [0, duration]。
 * 写进 out 并返回它（导出时每帧复用同一个数组，不分配）。
 */
export function subframeTimes(t: number, subframes: number, shutterAngle: number, fps: number, duration: number, out: number[] = []): number[] {
  out.length = subframes;
  const open = shutterAngle / 360 / fps;
  for (let k = 0; k < subframes; k++) {
    const tk = t + ((k + 0.5) / subframes - 0.5) * open;
    out[k] = Math.min(duration, Math.max(0, tk));
  }
  return out;
}
