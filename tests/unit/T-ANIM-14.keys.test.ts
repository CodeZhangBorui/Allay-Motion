// 第三轮（docs/animation-editor.md 10.3、10.4）：
// T-ANIM-14 多个关键帧：整体挪动、缩放时间、对齐到播放头与帧、删除、复制粘贴（跨图层、跨属性）、吸附；
// T-ANIM-15 曲线：预设缓动对应的贝塞尔控制点、改一段的控制点、速度曲线。
import { describe, expect, it } from 'vitest';
import { alignKeys, copyKeys, deleteKeys, easeToBezier, pasteKeys, sampleTrack, scaleKeys, setSegmentBezier, shiftKeys, snapKeysToFrames, snapTime, trackSpeed, type KeyRef } from '../../apps/desktop/src/shared/animation/edit';
import { AnimationDocSchema, newAnimationDoc, type AnimationDoc, type Track } from '../../apps/desktop/src/shared/animation/schema';
import { easingFn } from '../../packages/ui/src/editor/easing';

const ease = (e: unknown) => (e === undefined || e === 'hold' ? (x: number) => x : easingFn(e as string));

function doc(): AnimationDoc {
  return AnimationDocSchema.parse({
    ...newAnimationDoc('K', 'B'),
    duration: 3,
    layers: [
      { id: 'a', name: 'A', type: 'block', block: 'minecraft:stone', props: { x: { keys: [{ t: 0, v: 0 }, { t: 1, v: 10 }, { t: 2, v: 20 }] }, y: { keys: [{ t: 0.5, v: 1 }] } } },
      { id: 'b', name: 'B', type: 'block', block: 'minecraft:stone', props: {} },
    ],
  });
}
const keys = (d: AnimationDoc, layer: string, prop: 'x' | 'y') => {
  const tr = d.layers.find((l) => l.id === layer)!.props[prop] as Track;
  return typeof tr === 'object' && tr !== null && 'keys' in tr ? tr.keys.map((k) => [k.t, k.v]) : tr;
};

describe('T-ANIM-14 多个关键帧', () => {
  const sel: KeyRef[] = [
    { layer: 'a', prop: 'x', t: 1 },
    { layer: 'a', prop: 'x', t: 2 },
    { layer: 'a', prop: 'y', t: 0.5 },
  ];

  it('整体挪动：只动选中的；会和同一轨道上没选中的重合、挪出时长时整组不动', () => {
    const r = shiftKeys(doc(), sel, 0.5, 3)!;
    expect(keys(r.doc, 'a', 'x')).toEqual([[0, 0], [1.5, 10], [2.5, 20]]);
    expect(keys(r.doc, 'a', 'y')).toEqual([[1, 1]]);
    expect(r.refs).toHaveLength(3);
    expect(shiftKeys(doc(), sel, -1, 3)).toBeNull(); // 1 → 0 撞上没选中的 0
    expect(shiftKeys(doc(), sel, 1.5, 3)).toBeNull(); // 2 → 3.5 超出时长
  });

  it('缩放时间：以 pivot 为中心伸缩', () => {
    const r = scaleKeys(doc(), sel.slice(0, 2), 1, 1.5, 3)!;
    expect(keys(r.doc, 'a', 'x')).toEqual([[0, 0], [1, 10], [2.5, 20]]);
    expect(scaleKeys(doc(), sel, 1, 0, 3)).toBeNull();
  });

  it('对齐到播放头（最早的那个落在播放头上）、对齐到帧', () => {
    const r = alignKeys(doc(), sel, 0.75, 3)!;
    expect(keys(r.doc, 'a', 'y')).toEqual([[0.75, 1]]);
    expect(keys(r.doc, 'a', 'x')).toEqual([[0, 0], [1.25, 10], [2.25, 20]]);
    const off = AnimationDocSchema.parse({ ...doc(), layers: [{ id: 'a', name: 'A', type: 'block', block: 'minecraft:stone', props: { x: { keys: [{ t: 0.51, v: 0 }] } } }] });
    expect(keys(snapKeysToFrames(off, [{ layer: 'a', prop: 'x', t: 0.51 }], 10, 3)!.doc, 'a', 'x')).toEqual([[0.5, 0]]);
  });

  it('删除：删空的轨道变回最后那个值的常量', () => {
    const d = deleteKeys(doc(), sel);
    expect(keys(d, 'a', 'x')).toEqual([[0, 0]]);
    expect(keys(d, 'a', 'y')).toBe(1);
  });

  it('复制粘贴：时刻相对最早的那个；单图层的可以粘到别的图层；单属性的可以换成别的属性；同一时刻覆盖', () => {
    const clip = copyKeys(doc(), sel.slice(0, 2))!;
    expect(clip.keys.map((k) => k.dt)).toEqual([0, 1]);
    const onB = pasteKeys(doc(), clip, 0.5, 3, { layers: ['b'] });
    expect(keys(onB.doc, 'b', 'x')).toEqual([[0.5, 10], [1.5, 20]]);
    const onY = pasteKeys(doc(), clip, 0.5, 3, { prop: 'y' });
    expect(keys(onY.doc, 'a', 'y')).toEqual([[0.5, 10], [1.5, 20]]);
    // 超出时长的丢掉
    expect(pasteKeys(doc(), clip, 2.5, 3, { layers: ['b'] }).refs).toHaveLength(1);
    // 两个图层的剪贴板按原图层粘，目标被忽略
    const two = copyKeys(doc(), [{ layer: 'a', prop: 'x', t: 0 }])!;
    two.keys.push({ layer: 'b', prop: 'x', dt: 0.5, v: 3 });
    const both = pasteKeys(doc(), two, 2.5, 3, { layers: ['b'] });
    expect(both.refs.map((r) => r.layer).sort()).toEqual(['a', 'b']);
  });

  it('吸附：容差内吸到最近的点', () => {
    expect(snapTime(1.02, [0, 1, 2], 0.05)).toBe(1);
    expect(snapTime(1.2, [0, 1, 2], 0.05)).toBe(1.2);
    expect(snapTime(1.49, [1, 1.5], 0.1)).toBe(1.5);
  });
});

describe('T-ANIM-15 曲线', () => {
  it('预设缓动的控制点：线性是对角线；cubicOut 的近似曲线与精确公式差不到 0.02；弹性、回弹没有', () => {
    expect(easeToBezier(undefined)).toEqual([0, 0, 1, 1]);
    const b = easeToBezier('cubicOut')!;
    const approx = easingFn(b as unknown as [number, number, number, number]);
    for (let x = 0; x <= 1; x += 0.1) expect(Math.abs(approx(x) - easingFn('cubicOut')(x))).toBeLessThan(0.02);
    expect(easeToBezier('elasticOut')).toBeNull();
    expect(easeToBezier('hold')).toBeNull();
  });

  it('改一段的控制点：x 夹在 0–1，写成缓动；曲线照新的控制点求值', () => {
    const tr: Track = { keys: [{ t: 0, v: 0 }, { t: 1, v: 100 }] };
    const next = setSegmentBezier(tr, 0, [1.4, 0, 0, 1])!;
    expect(next).toEqual({ keys: [{ t: 0, v: 0, ease: [1, 0, 0, 1] }, { t: 1, v: 100 }] });
    const resolved = next as { keys: { t: number; v: number; ease?: never }[] };
    expect(sampleTrack(resolved, 0, 0.5, ease)).toBeCloseTo(50, 0);
    expect(setSegmentBezier(tr, 1, [0, 0, 1, 1])).toBeNull();
  });

  it('速度曲线：线性段的速度是常数（变化量 ÷ 时长）', () => {
    const tr = { keys: [{ t: 0, v: 0 }, { t: 2, v: 100 }] };
    expect(trackSpeed(tr, 0, 1, ease)).toBeCloseTo(50);
    expect(trackSpeed(tr, 0, 2.5, ease)).toBeCloseTo(0);
  });
});
