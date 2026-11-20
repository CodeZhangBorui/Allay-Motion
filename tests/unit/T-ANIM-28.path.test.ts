// T-ANIM-28：路径动画（docs/animation-editor.md 3.7）——编辑器的 path.ts 与 Worker 里的运行时算出同样的位置和朝向；
// progress 匀速时沿路径按长度匀速走；自动朝向把切线方向加到 rotZ；x、y 是相对路径的偏移；预览里的框（stage-geometry）跟着走。
import { describe, expect, it } from 'vitest';
import { pathAt, pathTable, type AnimPath } from '../../apps/desktop/src/shared/animation/path';
import { resolveDoc } from '../../apps/desktop/src/shared/animation/resolve';
import { AnimationDocSchema, newAnimationDoc, type AnimationDoc } from '../../apps/desktop/src/shared/animation/schema';
import { apply, layerFrames } from '../../apps/desktop/src/shared/animation/stage-geometry';
import { pos, runAnimation, THREE } from './helpers/anim-runtime';

const curve: AnimPath = {
  points: [
    { x: -400, y: 0, out: { x: 150, y: 300 } },
    { x: 0, y: 150, in: { x: -150, y: 0 }, out: { x: 150, y: 0 } },
    { x: 400, y: -100, in: { x: -100, y: 200 } },
  ],
  closed: false,
  orient: false,
};

const doc = (path: AnimPath, props: Record<string, unknown> = {}): AnimationDoc =>
  AnimationDocSchema.parse({
    ...newAnimationDoc('P', 'B'),
    layers: [{ id: 'r', name: 'R', type: 'rect', props: { progress: { keys: [{ t: 0, v: 0 }, { t: 1, v: 1 }] }, ...props }, path }],
  });

const linear = () => (u: number) => u;

describe('T-ANIM-28 路径动画', () => {
  it('编辑器与运行时一致：每个时刻位置相同', async () => {
    const d = doc(curve);
    const r = await runAnimation(d);
    const table = pathTable(curve);
    for (const t of [0, 0.13, 0.5, 0.77, 1]) {
      r.instance.update(t);
      const p = pos(r.drawn[0]!.matrix());
      const e = pathAt(curve, table, t);
      expect(p.x).toBeCloseTo(e.x, 3);
      expect(p.y).toBeCloseTo(e.y, 3);
    }
  });

  it('按长度匀速：相等的 progress 步长走过的路几乎相等（直线段和弯的地方一样快）', () => {
    const table = pathTable(curve);
    const steps = 40;
    const ds: number[] = [];
    let prev = pathAt(curve, table, 0);
    for (let i = 1; i <= steps; i++) {
      const p = pathAt(curve, table, i / steps);
      ds.push(Math.hypot(p.x - prev.x, p.y - prev.y));
      prev = p;
    }
    const mean = ds.reduce((a, b) => a + b, 0) / steps;
    for (const d of ds) expect(Math.abs(d - mean) / mean).toBeLessThan(0.02);
    expect(mean * steps).toBeCloseTo(table.total, -1);
  });

  it('两端钳住；首尾相接时 progress = 1 回到起点', () => {
    const table = pathTable(curve);
    expect(pathAt(curve, table, -1)).toMatchObject({ x: -400, y: 0 });
    expect(pathAt(curve, table, 2).x).toBeCloseTo(400);
    const closed = { ...curve, closed: true };
    const end = pathAt(closed, pathTable(closed), 1);
    expect(end.x).toBeCloseTo(-400);
    expect(end.y).toBeCloseTo(0);
  });

  it('自动朝向：rotZ 加上切线方向；x、y 是相对路径的偏移', async () => {
    const line: AnimPath = { points: [{ x: 0, y: 0 }, { x: 100, y: 100 }], closed: false, orient: true };
    const r = await runAnimation(doc(line, { x: 10, y: -5, rotZ: 5 }));
    r.instance.update(0.5);
    const p = pos(r.drawn[0]!.matrix());
    expect(p.x).toBeCloseTo(60);
    expect(p.y).toBeCloseTo(45);
    const q = new THREE.Quaternion();
    r.drawn[0]!.matrix().decompose(new THREE.Vector3(), q, new THREE.Vector3());
    expect((new THREE.Euler().setFromQuaternion(q).z * 180) / Math.PI).toBeCloseTo(50);
  });

  it('预览里的框跟着路径走，并记下路径贡献（移动、旋转时减掉）', () => {
    const line: AnimPath = { points: [{ x: 0, y: 0 }, { x: 100, y: 100 }], closed: false, orient: true };
    const [f] = layerFrames(resolveDoc(doc(line, { x: 10 })), 0.5, linear);
    expect(apply(f!.world, 0, 0).x).toBeCloseTo(60);
    expect(f!.onPath.x).toBeCloseTo(50);
    expect(f!.onPath.angle).toBeCloseTo(45);
    expect(f!.offset).toEqual({ x: 10, y: 0 });
  });

  it('路径至少两个点；没有路径时 progress 不起作用', async () => {
    const base = newAnimationDoc('P', 'B');
    expect(AnimationDocSchema.safeParse({ ...base, layers: [{ id: 'r', name: 'R', type: 'rect', props: {}, path: { points: [{ x: 0, y: 0 }] } }] }).success).toBe(false);
    const r = await runAnimation(AnimationDocSchema.parse({ ...base, layers: [{ id: 'r', name: 'R', type: 'rect', props: { progress: 0.5, x: 7 } }] }));
    r.instance.update(0);
    expect(pos(r.drawn[0]!.matrix()).x).toBeCloseTo(7);
  });
});
