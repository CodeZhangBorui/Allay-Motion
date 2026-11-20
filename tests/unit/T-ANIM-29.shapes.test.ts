// T-ANIM-29：形状与混合方式（docs/animation-editor.md 4.6）——圆角矩形、椭圆、线段的轮廓；描边是画在里面的一圈；
// 线性、径向渐变的颜色按外框分布；混合方式改的是预乘 alpha 下的混合因子；方块和组不能设混合方式，线段没有描边。
import { describe, expect, it } from 'vitest';
import { AnimationDocSchema, newAnimationDoc, type AnimationDoc } from '../../apps/desktop/src/shared/animation/schema';
import { runAnimation, THREE } from './helpers/anim-runtime';

type Mesh = InstanceType<typeof THREE.Mesh>;
type Mat = InstanceType<typeof THREE.MeshBasicMaterial>;

const doc = (layer: Record<string, unknown>): AnimationDoc => AnimationDocSchema.parse({ ...newAnimationDoc('S', 'B'), layers: [{ id: 's', name: 'S', props: {}, ...layer }] });

async function meshes(layer: Record<string, unknown>): Promise<Mesh[]> {
  const r = await runAnimation(doc(layer));
  r.instance.update(0);
  const out: Mesh[] = [];
  r.scene.traverse((o) => {
    if ((o as Mesh).isMesh) out.push(o as Mesh);
  });
  return out;
}

const box = (m: Mesh) => {
  m.geometry.computeBoundingBox();
  return m.geometry.boundingBox!;
};
const points = (m: Mesh) => {
  const p = m.geometry.attributes.position!;
  return Array.from({ length: p.count }, (_, i) => ({ x: p.getX(i), y: p.getY(i) }));
};

describe('T-ANIM-29 形状与混合方式', () => {
  it('矩形：外框是宽高；有圆角时角上没有顶点，所有点都在圆角里面', async () => {
    const [sharp] = await meshes({ type: 'rect', width: 200, height: 100 });
    expect(box(sharp!).min.x).toBeCloseTo(-100);
    expect(box(sharp!).max.y).toBeCloseTo(50);
    const [round] = await meshes({ type: 'rect', width: 200, height: 100, radius: 30 });
    expect(box(round!).max.x).toBeCloseTo(100);
    for (const p of points(round!)) {
      // 右上角的圆心在 (70, 20)：角区里的点到圆心不超过半径
      if (p.x > 70 && p.y > 20) expect(Math.hypot(p.x - 70, p.y - 20)).toBeLessThanOrEqual(30 + 1e-3);
    }
  });

  it('椭圆：点都在椭圆上或里面，外框是宽高', async () => {
    const [e] = await meshes({ type: 'ellipse', width: 300, height: 100 });
    expect(box(e!).max.x).toBeCloseTo(150);
    expect(box(e!).max.y).toBeCloseTo(50, 0);
    for (const p of points(e!)) expect((p.x / 150) ** 2 + (p.y / 50) ** 2).toBeLessThanOrEqual(1 + 1e-4);
  });

  it('线段：长 width、粗 height；圆头时两端是半圆', async () => {
    const [l] = await meshes({ type: 'line', width: 400, height: 20 });
    expect(box(l!).min.x).toBeCloseTo(-200);
    expect(box(l!).max.y).toBeCloseTo(10);
    expect(points(l!).some((p) => Math.abs(p.x) > 195 && Math.abs(p.y) > 9)).toBe(false);
    const [butt] = await meshes({ type: 'line', width: 400, height: 20, cap: 'butt' });
    expect(points(butt!).some((p) => p.x > 199.9 && p.y > 9.9)).toBe(true);
  });

  it('描边：在填充上面多一个环，外圈同外框，中间是空的', async () => {
    const list = await meshes({ type: 'rect', width: 200, height: 100, stroke: { color: '#FF0000', width: 10 } });
    expect(list).toHaveLength(2);
    const ring = list.find((m) => m.renderOrder % 1 !== 0)!;
    expect(box(ring).max.x).toBeCloseTo(100);
    // 环的三角形都不盖住中心：中心附近（内圈里面）没有顶点
    expect(points(ring).every((p) => Math.abs(p.x) >= 90 - 1e-6 || Math.abs(p.y) >= 40 - 1e-6)).toBe(true);
    expect((ring.material as Mat).color.getHexString()).toBe('ff0000');
  });

  it('渐变：线性从左到右（angle 0），径向从中心到边缘；贴图按外框铺', async () => {
    const [lin] = await meshes({ type: 'rect', width: 200, height: 100, gradient: { type: 'linear', from: '#000000', to: '#FFFFFF', angle: 0 } });
    const tex = (lin!.material as Mat).map!;
    const img = tex.image as { data: Uint8Array; width: number };
    const data = img.data;
    const N = img.width;
    const at = (i: number, j: number) => data[(j * N + i) * 4]!;
    expect(at(0, 10)).toBeLessThan(8);
    expect(at(N - 1, 10)).toBeGreaterThan(247);
    expect(at(0, 10)).toBe(at(0, 50));
    const uv = lin!.geometry.attributes.uv!;
    const xs = Array.from({ length: uv.count }, (_, i) => uv.getX(i));
    expect(Math.min(...xs)).toBeCloseTo(0);
    expect(Math.max(...xs)).toBeCloseTo(1);
    const [rad] = await meshes({ type: 'ellipse', width: 100, height: 100, gradient: { type: 'radial', from: '#FF0000', to: '#0000FF' } });
    const rt = (rad!.material as Mat).map!;
    const rd = (rt.image as { data: Uint8Array }).data;
    const c = ((N / 2) * N + N / 2) * 4;
    expect(rd[c]!).toBeGreaterThan(240);
    expect(rd[0 + 2]!).toBe(255);
  });

  it('混合方式：改成输出预乘颜色，按相加、相乘、滤色设混合因子；正常时不动', async () => {
    const mat = async (blend?: string) => ((await meshes({ type: 'rect', ...(blend ? { blend } : {}) }))[0]!.material as Mat);
    expect((await mat()).blending).toBe(THREE.NormalBlending);
    const add = await mat('add');
    expect(add.premultipliedAlpha).toBe(true);
    expect([add.blending, add.blendSrc, add.blendDst]).toEqual([THREE.CustomBlending, THREE.OneFactor, THREE.OneFactor]);
    const mul = await mat('multiply');
    expect([mul.blendSrc, mul.blendDst]).toEqual([THREE.DstColorFactor, THREE.OneMinusSrcAlphaFactor]);
    const scr = await mat('screen');
    expect([scr.blendSrc, scr.blendDst]).toEqual([THREE.OneMinusDstColorFactor, THREE.OneFactor]);
    expect([scr.blendSrcAlpha, scr.blendDstAlpha]).toEqual([THREE.OneFactor, THREE.OneMinusSrcAlphaFactor]);
  });

  it('格式：方块、组不能设混合方式；线段没有描边', () => {
    const base = newAnimationDoc('S', 'B');
    const ok = (layer: Record<string, unknown>) => AnimationDocSchema.safeParse({ ...base, layers: [{ id: 's', name: 'S', props: {}, ...layer }] }).success;
    expect(ok({ type: 'block', block: 'minecraft:stone', blend: 'add' })).toBe(false);
    expect(ok({ type: 'group', blend: 'add' })).toBe(false);
    expect(ok({ type: 'line', stroke: { color: '#FFFFFF', width: 2 } })).toBe(false);
    expect(ok({ type: 'ellipse', blend: 'screen', gradient: { type: 'radial', from: '#000000', to: '#FFFFFF' } })).toBe(true);
  });
});
