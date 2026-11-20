// T-ANIM-41：透视相机、带 z 的图层时预览里选择框的位置（docs/animation-editor.md 10.9，第三轮补）——
// 编辑器算出的画面位置与 three.js 用引擎同样的相机（createStageCamera 的规则）投影 Worker 里的世界位置一致；
// 子图层的 z 沿父级累加；正交相机时 z 不影响位置；框随深度缩放；点选按缩放后的框。
import { describe, expect, it } from 'vitest';
import { resolveDoc } from '../../apps/desktop/src/shared/animation/resolve';
import { AnimationDocSchema, newAnimationDoc, type AnimationDoc } from '../../apps/desktop/src/shared/animation/schema';
import { apply, cameraDistance, corners, hitTest, layerFrames } from '../../apps/desktop/src/shared/animation/stage-geometry';
import { pos, runAnimation, THREE } from './helpers/anim-runtime';

const linear = () => (u: number) => u;
const W = 1920;
const H = 1080;

const doc = (camera: unknown, layers: unknown[]): AnimationDoc => AnimationDocSchema.parse({ ...newAnimationDoc('P', 'B'), camera, layers });

/** 同引擎 createStageCamera：z = 0 平面恰好填满舞台 */
function stageCamera(fov: number) {
  const d = H / 2 / Math.tan((fov * Math.PI) / 360);
  const cam = new THREE.PerspectiveCamera(fov, W / H, Math.max(1, d * 0.02), d + W * 8);
  cam.position.set(0, 0, d);
  cam.lookAt(0, 0, 0);
  cam.updateProjectionMatrix();
  cam.updateMatrixWorld();
  return cam;
}

/** 世界坐标 → 画面上的舞台坐标（原点在中心、+y 向上，设计单位） */
function project(cam: InstanceType<typeof THREE.PerspectiveCamera>, p: { x: number; y: number; z: number }) {
  const v = new THREE.Vector3(p.x, p.y, p.z).project(cam);
  return { x: (v.x * W) / 2, y: (v.y * H) / 2 };
}

const layers = [
  { id: 'near', name: 'Near', type: 'rect', width: 100, height: 100, props: { x: 300, y: 100, z: 400 } },
  { id: 'far', name: 'Far', type: 'rect', width: 100, height: 100, props: { x: -300, y: -100, z: -600 } },
  { id: 'kid', name: 'Kid', type: 'rect', width: 50, height: 50, parent: 'far', props: { x: 100, z: 200 } },
];

describe('T-ANIM-41 透视相机下预览的选择框', () => {
  it('图层中心的画面位置与 three.js 用同样的相机投影 Worker 里的世界位置一致（含子图层的 z 累加）', async () => {
    const d = doc({ type: 'perspective', fov: 30 }, layers);
    const r = await runAnimation(d);
    r.instance.update(0);
    const cam = stageCamera(30);
    const frames = layerFrames(resolveDoc(d), 0, linear, H);
    r.drawn.forEach((x, i) => {
      const world = pos(x.matrix());
      const expected = project(cam, world);
      const got = apply(frames[i]!.screen, 0, 0);
      expect(got.x).toBeCloseTo(expected.x, 3);
      expect(got.y).toBeCloseTo(expected.y, 3);
    });
    expect(frames[2]!.z).toBeCloseTo(-400);
  });

  it('框随深度缩放：近的变大、远的变小，四个角也与投影一致', async () => {
    const d = doc({ type: 'perspective', fov: 30 }, layers);
    const cam = stageCamera(30);
    const [near, far] = layerFrames(resolveDoc(d), 0, linear, H);
    const dist = cameraDistance(resolveDoc(d), H)!;
    expect(near!.k).toBeCloseTo(dist / (dist - 400));
    expect(far!.k).toBeLessThan(1);
    const c = corners(near!);
    const tr = project(cam, { x: 350, y: 150, z: 400 });
    expect(c[1]!.x).toBeCloseTo(tr.x, 3);
    expect(c[1]!.y).toBeCloseTo(tr.y, 3);
  });

  it('点选按画面上的框：点投影后的位置选得中，点平面上（没投影）的位置选不中', () => {
    const d = doc({ type: 'perspective', fov: 30 }, [layers[0]]);
    const r = resolveDoc(d);
    const frames = layerFrames(r, 0, linear, H);
    const at = apply(frames[0]!.screen, 0, 0);
    expect(hitTest(frames, r, at.x, at.y)).toBe('near');
    expect(hitTest(frames, r, 300, 100)).toBeNull();
  });

  it('正交相机：z 不影响位置和大小', () => {
    const d = doc({ type: 'ortho' }, layers);
    const [near] = layerFrames(resolveDoc(d), 0, linear, H);
    expect(near!.k).toBe(1);
    expect(apply(near!.screen, 0, 0)).toEqual({ x: 300, y: 100 });
  });
});
