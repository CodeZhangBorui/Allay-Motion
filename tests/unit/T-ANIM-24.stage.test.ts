// T-ANIM-24：预览里直接变换图层的平面几何（docs/animation-editor.md 6.10）——框跟着父级、点选取最前面的、
// 隐藏和锁定的不被点中、吸附到中线和别的图层；在当前时刻写回 x、y、scale、rotZ（有关键帧的自动落关键帧、绑定的改参数）。
import { describe, expect, it } from 'vitest';
import { setPropValues } from '../../apps/desktop/src/shared/animation/params';
import { resolveDoc } from '../../apps/desktop/src/shared/animation/resolve';
import { AnimationDocSchema, newAnimationDoc, type AnimationDoc } from '../../apps/desktop/src/shared/animation/schema';
import { apply, corners, hitTest, layerFrames, projectedCubeHalf, snapPoint, stageSize } from '../../apps/desktop/src/shared/animation/stage-geometry';

const linear = () => (x: number) => x;
const rect = (id: string, extra: Record<string, unknown> = {}) => ({ id, name: id, type: 'rect', width: 100, height: 50, props: {}, ...extra });
const doc = (layers: unknown[], params: unknown[] = []): AnimationDoc => AnimationDocSchema.parse({ ...newAnimationDoc('S', 'B'), layers, params });

describe('T-ANIM-24 预览里的选择与变换', () => {
  it('框：位置、旋转、缩放沿父级相乘；色块的半宽半高就是宽高的一半', () => {
    const d = resolveDoc(doc([rect('p', { props: { x: 100, rotZ: 90 } }), rect('c', { parent: 'p', props: { x: 50, scale: 2 } })]));
    const [p, c] = layerFrames(d, 0, linear);
    expect(apply(p!.world, 0, 0)).toMatchObject({ x: 100, y: 0 });
    const cc = apply(c!.world, 0, 0);
    expect(cc.x).toBeCloseTo(100);
    expect(cc.y).toBeCloseTo(50);
    expect([c!.halfW, c!.halfH]).toEqual([50, 25]);
    // 子图层的角：缩放 2 倍、跟着父级转了 90°
    const tl = corners(c!)[0]!;
    expect(tl.x).toBeCloseTo(100 - 50);
    expect(tl.y).toBeCloseTo(50 - 100);
  });

  it('点选：画在最前面的；隐藏、锁定、组都不被点中', () => {
    const d = resolveDoc(doc([rect('a'), rect('b'), rect('h', { hidden: true }), rect('l', { locked: true }), { id: 'g', name: 'G', type: 'group', props: {} }]));
    const frames = layerFrames(d, 0, linear);
    expect(hitTest(frames, d, 10, 10)).toBe('b');
    expect(hitTest(frames, d, 500, 500)).toBeNull();
  });

  it('立方体转过 rotY = 45° 后在画面上变宽（√2 / 2），不转时是 0.5', () => {
    expect(projectedCubeHalf(0, 0).hw).toBeCloseTo(0.5);
    expect(projectedCubeHalf(0, 45).hw).toBeCloseTo(Math.SQRT2 / 2);
  });

  it('吸附到舞台中线和别的图层的中心，给出参考线', () => {
    expect(snapPoint({ x: 3, y: 200 }, [{ x: 400, y: 198 }], 5)).toEqual({ x: 0, y: 198, guideX: 0, guideY: 198 });
    expect(snapPoint({ x: 30, y: 30 }, [], 5)).toEqual({ x: 30, y: 30, guideX: null, guideY: null });
    expect(stageSize({ width: 1920, height: 1080 })).toEqual({ width: 1920, height: 1080 });
    expect(stageSize({ width: 1080, height: 1920 })).toEqual({ width: 1080, height: 1920 });
  });

  it('写回当前时刻：常量直接改、有关键帧的落关键帧、绑定到参数的改参数默认值', () => {
    const d = doc(
      [rect('r', { props: { x: 10, y: { keys: [{ t: 0, v: 0 }, { t: 1, v: 100 }] }, rotZ: { $param: 'spin' } } })],
      [{ key: 'spin', label: 'Spin', type: 'number', default: 0, min: -360, max: 360 }],
    );
    const next = AnimationDocSchema.parse(setPropValues(d, 'r', { x: 40, y: 30, rotZ: 45 }, 0.5)!);
    const l = next.layers[0]!;
    expect(l.props.x).toBe(40);
    expect(l.props.y).toEqual({ keys: [{ t: 0, v: 0 }, { t: 0.5, v: 30 }, { t: 1, v: 100 }] });
    expect(l.props.rotZ).toEqual({ $param: 'spin' });
    expect(next.params[0]).toMatchObject({ default: 45 });
  });
});
