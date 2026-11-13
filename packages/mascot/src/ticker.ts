// 悦灵的帧循环（docs/07-allay-mascot.md 7.4、7.9）。全应用只有一个 requestAnimationFrame：
// 每个画帧的图集画布、每块飞舞区域、导出进度都在这里订阅，同一帧里依次执行。
// 回调里只写 transform / opacity / 画布，不读布局（T-ALY-6：零次强制重排）。
// 每帧花在悦灵上的时间记进一个定长的环形缓冲，T-ALY-6 读它算 p95。

export type FrameCallback = (now: number) => void;

const subscribers = new Set<FrameCallback>();
let handle = 0;

const STATS_LEN = 1024;
const durations = new Float64Array(STATS_LEN);
let recorded = 0;

function frame(now: number): void {
  handle = 0;
  const started = performance.now();
  for (const fn of subscribers) fn(now);
  durations[recorded % STATS_LEN] = performance.now() - started;
  recorded++;
  if (subscribers.size > 0) handle = requestAnimationFrame(frame);
}

/** 每个动画帧调用一次 fn；返回取消订阅的函数 */
export function onMascotFrame(fn: FrameCallback): () => void {
  subscribers.add(fn);
  if (handle === 0) handle = requestAnimationFrame(frame);
  return () => {
    subscribers.delete(fn);
    if (subscribers.size === 0 && handle !== 0) {
      cancelAnimationFrame(handle);
      handle = 0;
    }
  };
}

export interface MascotFrameStats {
  /** 统计窗口里的帧数（最多 1024） */
  frames: number;
  /** 每帧悦灵回调总耗时（毫秒）的 p95 与最大值 */
  p95: number;
  max: number;
  /** 当前订阅数 */
  subscribers: number;
}

export function mascotFrameStats(): MascotFrameStats {
  const n = Math.min(recorded, STATS_LEN);
  const list = Array.from(durations.subarray(0, n)).sort((a, b) => a - b);
  return {
    frames: n,
    p95: n === 0 ? 0 : list[Math.min(n - 1, Math.floor(n * 0.95))]!,
    max: n === 0 ? 0 : list[n - 1]!,
    subscribers: subscribers.size,
  };
}

export function resetMascotFrameStats(): void {
  recorded = 0;
}
