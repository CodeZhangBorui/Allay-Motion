// T-ANIM-34：时间轴的缩放和滚动（docs/animation-editor.md 第 11 项）——以指针处为中心缩放、放大的上限、缩小回整段、
// 平移到头就停、播放头跑出去时翻页、时刻到位置的换算。
import { describe, expect, it } from 'vitest';
import { clampView, fracOf, MIN_SPAN, panBy, revealTime, viewRange, zoomAt } from '../../apps/desktop/src/shared/animation/time-view';

describe('T-ANIM-34 时间轴的缩放和滚动', () => {
  it('以 anchor 为中心放大：anchor 在屏幕上的位置不变', () => {
    const v = zoomAt(null, 4, 1, 0.5)!;
    expect(v.end - v.start).toBeCloseTo(2);
    // anchor 原来在 1/4 处，放大后还在 1/4 处
    expect(fracOf(v, 1)).toBeCloseTo(0.25);
  });

  it('放大有上限（至少 MIN_SPAN 秒）；缩小到整段回到 null', () => {
    let v = zoomAt(null, 4, 2, 0.5);
    for (let i = 0; i < 40; i++) v = zoomAt(v, 4, 2, 0.5);
    expect(v!.end - v!.start).toBeCloseTo(MIN_SPAN);
    for (let i = 0; i < 60 && v; i++) v = zoomAt(v, 4, 2, 2);
    expect(v).toBeNull();
    expect(viewRange(null, 4)).toEqual({ start: 0, end: 4 });
  });

  it('平移到头就停；不缩放时平移不动', () => {
    const v = { start: 1, end: 2 };
    expect(panBy(v, 4, 10)).toEqual({ start: 3, end: 4 });
    expect(panBy(v, 4, -10)).toEqual({ start: 0, end: 1 });
    expect(panBy(null, 4, 1)).toBeNull();
    expect(clampView({ start: -1, end: 0.5 }, 4)).toEqual({ start: 0, end: 1.5 });
  });

  it('播放头跑出可见范围时翻页（落在新范围的前 10%）；在里面时不动', () => {
    const v = { start: 0, end: 1 };
    expect(revealTime(v, 4, 0.5)).toBe(v);
    const next = revealTime(v, 4, 2.5)!;
    expect(fracOf(next, 2.5)).toBeCloseTo(0.1);
    expect(revealTime(null, 4, 3)).toBeNull();
  });
});
