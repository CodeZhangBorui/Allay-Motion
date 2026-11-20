import { describe, expect, it } from 'vitest';
import { clampSegmentDuration, distributeEvenly, durationToEndAt, nextCue, prevCue, segmentIndexAt, segmentStart, type SegmentSpan } from '../../packages/ui/src/editor/timelineOps';

// 2026-11 反馈：时间线右键菜单用到的纯计算（docs/decisions.md“2026-11 反馈：时间线与曲线编辑”）。

const FPS = 60;
const segs: SegmentSpan[] = [
  { key: 'in', duration: 0.5, min: 0.1, max: 2 },
  { key: 'hold', duration: 0.2, min: 0, max: 2 },
  { key: 'out', duration: 0.6, min: 0.1, max: 2 },
];
const frames = (r: Record<string, number>) => Object.values(r).reduce((a, d) => a + Math.round(d * FPS), 0);

describe('T-UXF-4 段的定位', () => {
  it('段首是前面各段之和；时间落在左闭右开的段里，终点算最后一段', () => {
    expect(segmentStart(segs, 0)).toBe(0);
    expect(segmentStart(segs, 2)).toBeCloseTo(0.7, 9);
    expect(segmentIndexAt(segs, 0)).toBe(0);
    expect(segmentIndexAt(segs, 0.5)).toBe(1);
    expect(segmentIndexAt(segs, 1.3)).toBe(2);
    expect(segmentIndexAt(segs, 1.4)).toBeNull();
    expect(segmentIndexAt([], 0)).toBeNull();
  });
});

describe('T-UXF-5 设置时长、段尾移到播放头：吸附到帧并受 min/max 限制', () => {
  it('clampSegmentDuration', () => {
    expect(clampSegmentDuration(segs[0]!, 0.507, FPS)).toBeCloseTo(30 / 60, 9);
    expect(clampSegmentDuration(segs[0]!, 0.01, FPS)).toBeCloseTo(0.1, 9);
    expect(clampSegmentDuration(segs[0]!, 9, FPS)).toBe(2);
  });
  it('最后一段的段尾移到播放头：总时长随之变', () => {
    expect(durationToEndAt(segs, 2, 1.0, FPS)).toBeCloseTo(0.3, 9);
    // 播放头在这一段起点之前：取最短
    expect(durationToEndAt(segs, 2, 0.2, FPS)).toBeCloseTo(0.1, 9);
  });
});

describe('T-UXF-6 平均分配：保持总帧数，尽量一样长，尊重 min/max', () => {
  it('能整除时每段一样长', () => {
    const r = distributeEvenly(segs, FPS);
    expect(frames(r)).toBe(78);
    expect(Object.values(r).map((d) => Math.round(d * FPS))).toEqual([26, 26, 26]);
  });
  it('除不尽时余下的帧给前面的段', () => {
    const r = distributeEvenly([{ ...segs[0]!, duration: 0.5 }, { ...segs[1]!, duration: 0.5 / 3 }], FPS);
    expect(Object.values(r).map((d) => Math.round(d * FPS))).toEqual([20, 20]);
    const r2 = distributeEvenly([{ ...segs[0]!, duration: 21 / 60 }, { ...segs[1]!, duration: 20 / 60 }], FPS);
    expect(Object.values(r2).map((d) => Math.round(d * FPS))).toEqual([21, 20]);
  });
  it('某段的 max 放不下平均值：差额分给其他段，总帧数不变', () => {
    const r = distributeEvenly(
      [
        { key: 'a', duration: 1, min: 0, max: 0.1 },
        { key: 'b', duration: 0.5, min: 0, max: 5 },
      ],
      FPS,
    );
    expect(Math.round(r.a! * FPS)).toBe(6);
    expect(Math.round(r.b! * FPS)).toBe(84);
  });
});

describe('T-UXF-7 上一个/下一个音效', () => {
  const cues = [0.1, 0.5, 1.0];
  it('不含当前帧', () => {
    expect(nextCue(cues, 0.5, FPS)).toBe(1.0);
    expect(prevCue(cues, 0.5, FPS)).toBe(0.1);
    expect(nextCue(cues, 1.0, FPS)).toBeNull();
    expect(prevCue(cues, 0.1, FPS)).toBeNull();
    expect(nextCue([], 0, FPS)).toBeNull();
  });
});
