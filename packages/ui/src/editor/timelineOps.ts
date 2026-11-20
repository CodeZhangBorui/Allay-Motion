// 时间轴右键菜单和拖段尾用到的纯计算（docs/decisions.md“2026-11 反馈：时间线与曲线编辑”）。
// 都按整数帧算，避免浮点累加误差；结果是吸附到帧的秒数，并受各段 duration 参数的 min/max 限制。

export interface SegmentSpan {
  key: string;
  /** 秒 */
  duration: number;
  min: number;
  max: number;
}

const toFrames = (t: number, fps: number) => Math.round(t * fps);

/** 一段在 min/max 内能取的最少、最多帧数 */
function frameRange(s: SegmentSpan, fps: number): [number, number] {
  const lo = Math.ceil(s.min * fps - 1e-9);
  const hi = Math.floor(s.max * fps + 1e-9);
  return [lo, Math.max(lo, hi)];
}

/** 吸附到帧并限制在这一段的 min/max 内 */
export function clampSegmentDuration(s: SegmentSpan, duration: number, fps: number): number {
  const [lo, hi] = frameRange(s, fps);
  return Math.min(hi, Math.max(lo, toFrames(duration, fps))) / fps;
}

/** 第 i 段的起点（秒） */
export function segmentStart(segments: readonly SegmentSpan[], i: number): number {
  let acc = 0;
  for (let k = 0; k < i && k < segments.length; k++) acc += segments[k]!.duration;
  return acc;
}

/** 时间 t 落在哪一段（左闭右开；终点算最后一段）；在所有段之外为 null */
export function segmentIndexAt(segments: readonly SegmentSpan[], t: number): number | null {
  if (segments.length === 0 || t < 0) return null;
  let acc = 0;
  for (let i = 0; i < segments.length; i++) {
    acc += segments[i]!.duration;
    if (t < acc - 1e-9) return i;
  }
  return Math.abs(t - acc) < 1e-6 ? segments.length - 1 : null;
}

/** 让第 i 段的结尾落在 t 上需要的时长（受 min/max 限制）；t 在这一段起点之前时取最短 */
export function durationToEndAt(segments: readonly SegmentSpan[], i: number, t: number, fps: number): number {
  const s = segments[i]!;
  return clampSegmentDuration(s, t - segmentStart(segments, i), fps);
}

/**
 * 平均分配：保持各段之和（按帧）不变，让各段尽量一样长；某段的 min/max 放不下平均值时，
 * 多出来或缺的帧按顺序分给还有余地的段。返回每段的新时长（秒），键是段的 key。
 */
export function distributeEvenly(segments: readonly SegmentSpan[], fps: number): Record<string, number> {
  const n = segments.length;
  if (n === 0) return {};
  const total = segments.reduce((a, s) => a + toFrames(s.duration, fps), 0);
  const ranges = segments.map((s) => frameRange(s, fps));
  const base = Math.floor(total / n);
  let rem = total - base * n;
  const frames = ranges.map(([lo, hi]) => {
    const want = base + (rem > 0 ? 1 : 0);
    if (rem > 0) rem--;
    return Math.min(hi, Math.max(lo, want));
  });
  // 夹到 min/max 以后和变了：把差额分给还有余地的段
  let diff = total - frames.reduce((a, f) => a + f, 0);
  for (let pass = 0; pass < n && diff !== 0; pass++) {
    for (let i = 0; i < n && diff !== 0; i++) {
      const [lo, hi] = ranges[i]!;
      if (diff > 0 && frames[i]! < hi) {
        const d = Math.min(diff, hi - frames[i]!);
        frames[i]! += d;
        diff -= d;
      } else if (diff < 0 && frames[i]! > lo) {
        const d = Math.min(-diff, frames[i]! - lo);
        frames[i]! -= d;
        diff += d;
      }
    }
  }
  return Object.fromEntries(segments.map((s, i) => [s.key, frames[i]! / fps]));
}

/** t 之后（不含 t 所在的那一帧）的第一个音效；没有时为 null */
export function nextCue(cues: readonly number[], t: number, fps: number): number | null {
  const f = toFrames(t, fps);
  let best: number | null = null;
  for (const c of cues) if (toFrames(c, fps) > f && (best === null || c < best)) best = c;
  return best;
}

/** t 之前（不含 t 所在的那一帧）的最后一个音效；没有时为 null */
export function prevCue(cues: readonly number[], t: number, fps: number): number | null {
  const f = toFrames(t, fps);
  let best: number | null = null;
  for (const c of cues) if (toFrames(c, fps) < f && (best === null || c > best)) best = c;
  return best;
}
