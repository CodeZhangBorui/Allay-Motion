// T-ANIM-34：时间轴的缩放和滚动（docs/animation-editor.md 第 11 项）——以指针处为中心缩放、放大的上限、缩小回整段、
// 平移到头就停、播放头跑出去时翻页、时刻到位置的换算；标记点和工作区。
import { describe, expect, it } from 'vitest';
import { addMarker, adjacentTime, moveMarker, removeMarker, renameMarker, setWorkArea } from '../../apps/desktop/src/shared/animation/markers';
import { setKeysEase } from '../../apps/desktop/src/shared/animation/edit';
import { AnimationDocSchema, newAnimationDoc } from '../../apps/desktop/src/shared/animation/schema';
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

// 标记点和工作区（同一项）：加、挪、改名、删；工作区设一端、清掉、两端重合时拒绝；前后跳转找最近的时刻；格式

describe('T-ANIM-34 标记点和工作区', () => {
  const doc = () => AnimationDocSchema.parse(newAnimationDoc('M', 'B'));

  it('标记：加（同一时刻不重复）、挪（按时刻排序）、改名（空名字去掉）、删到没有时去掉字段', () => {
    let d = addMarker(doc(), 1.5).doc;
    const r = addMarker(d, 0.5, 'Hit');
    d = r.doc;
    expect(d.markers!.map((m) => m.t)).toEqual([0.5, 1.5]);
    expect(addMarker(d, 0.5).doc).toBe(d);
    d = moveMarker(d, r.id, 1.8)!;
    expect(d.markers!.map((m) => m.id)).toEqual(['marker-1', r.id]);
    d = renameMarker(d, r.id, '  ')!;
    expect(d.markers!.find((m) => m.id === r.id)).toEqual({ id: r.id, t: 1.8 });
    d = removeMarker(removeMarker(d, r.id)!, 'marker-1')!;
    expect('markers' in d).toBe(false);
    expect(AnimationDocSchema.safeParse(d).success).toBe(true);
  });

  it('工作区：只设一端时另一端是整段的开头或结尾；两端重合拒绝；清掉', () => {
    const d = setWorkArea(doc(), 2, 0.5, undefined)!;
    expect(d.workArea).toEqual({ from: 0.5, to: 2 });
    expect(setWorkArea(d, 2, undefined, 0.5)).toBeNull();
    expect(setWorkArea(d, 2, undefined, 1)!.workArea).toEqual({ from: 0.5, to: 1 });
    expect('workArea' in setWorkArea(d, 2, null, null)!).toBe(false);
    expect(AnimationDocSchema.safeParse({ ...doc(), workArea: { from: 1, to: 1 } }).success).toBe(false);
    expect(AnimationDocSchema.safeParse({ ...doc(), markers: [{ id: 'a', t: 1 }, { id: 'a', t: 2 }] }).success).toBe(false);
  });

  it('前后跳转：t 之后 / 之前最近的时刻，没有时 null', () => {
    expect(adjacentTime([0, 1, 2], 1, 1)).toBe(2);
    expect(adjacentTime([0, 1, 2], 1, -1)).toBe(0);
    expect(adjacentTime([0, 1, 2], 2, 1)).toBeNull();
  });
});

describe('T-ANIM-34 右键菜单的缓动', () => {
  it('一组关键帧一起改缓动；线性去掉 ease；找不到的跳过，一个都没改到时 null', () => {
    const d = AnimationDocSchema.parse({ ...newAnimationDoc('E', 'B'), layers: [{ id: 'r', name: 'R', type: 'rect', props: { x: { keys: [{ t: 0, v: 0 }, { t: 1, v: 1, ease: 'cubicIn' }] }, y: { keys: [{ t: 0, v: 0 }] } } }] });
    const held = setKeysEase(d, [{ layer: 'r', prop: 'x', t: 0 }, { layer: 'r', prop: 'y', t: 0 }], 'hold')!;
    expect((held.layers[0]!.props.x as { keys: { ease?: unknown }[] }).keys[0]!.ease).toBe('hold');
    expect((held.layers[0]!.props.y as { keys: { ease?: unknown }[] }).keys[0]!.ease).toBe('hold');
    const lin = setKeysEase(d, [{ layer: 'r', prop: 'x', t: 1 }], undefined)!;
    expect('ease' in (lin.layers[0]!.props.x as { keys: object[] }).keys[1]!).toBe(false);
    expect(setKeysEase(d, [{ layer: 'nope', prop: 'x', t: 0 }], 'hold')).toBeNull();
  });
});
