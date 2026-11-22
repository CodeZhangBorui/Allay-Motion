// 音效的 cue 数：同一种声音一次最多 12 个，多了按时刻均匀抽样（docs/template-catalog.md 第 2 节，和 block-wipe 的做法相同）。

/** 同一种声音最多几个 cue */
export const MAX_CUES = 12;

/** n 个 cue 里取哪几个的序号：不超过 max 个时全取；多了按序号均匀抽 max 个，含首尾、从小到大、不重复 */
export function sampleIndices(n: number, max = MAX_CUES): number[] {
  if (n <= max) return Array.from({ length: n }, (_, i) => i);
  // 只取一个时取第一个（下面的公式要除以 max − 1）
  if (max <= 1) return max === 1 ? [0] : [];
  return Array.from({ length: max }, (_, i) => Math.round((i * (n - 1)) / (max - 1)));
}

/** 按时刻排好的一串 cue 里最多取 max 个，抽法同 sampleIndices */
export function sampleCues(times: readonly number[], max = MAX_CUES): number[] {
  return sampleIndices(times.length, max).map((i) => times[i]!);
}
