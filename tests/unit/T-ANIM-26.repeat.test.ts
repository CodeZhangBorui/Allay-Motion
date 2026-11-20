// T-ANIM-26：复制器（docs/animation-editor.md 3.6）——网格、一条线、一圈的位置与朝向；按名次错开播放；
// 同一个种子结果相同、换种子结果不同（确定性随机，硬性规则 2）；方块列表按“方块排列”放，与模板的排列规则一致。
import { describe, expect, it } from 'vitest';
import { arrangeCells } from '../../packages/templates/block-wipe/src/arrangement';
import { AnimationDocSchema, newAnimationDoc, type AnimationDoc } from '../../apps/desktop/src/shared/animation/schema';
import { pos, runAnimation, THREE } from './helpers/anim-runtime';

const doc = (repeat: Record<string, unknown>, extra: Record<string, unknown> = {}): AnimationDoc =>
  AnimationDocSchema.parse({ ...newAnimationDoc('R', 'B'), layers: [{ id: 'b', name: 'B', type: 'block', block: 'minecraft:stone', size: 10, props: {}, repeat, ...extra }] });

const positions = async (d: AnimationDoc, t = 0) => {
  const r = await runAnimation(d);
  r.instance.update(t);
  return r.drawn.map((x) => {
    const p = pos(x.matrix());
    return [Math.round(p.x * 100) / 100, Math.round(p.y * 100) / 100];
  });
};

describe('T-ANIM-26 复制器', () => {
  it('网格：按行从左上到右下，以图层位置为中心排开', async () => {
    expect(await positions(doc({ mode: 'grid', cols: 3, rows: 2, spacing: { x: 100, y: 50 } }))).toEqual([
      [-100, 25], [0, 25], [100, 25],
      [-100, -25], [0, -25], [100, -25],
    ]);
  });

  it('一条线：每一份相对上一份位移 spacing', async () => {
    expect(await positions(doc({ mode: 'linear', count: 3, spacing: { x: 40, y: -10 } }))).toEqual([[0, 0], [40, -10], [80, -20]]);
  });

  it('一圈：从正上方顺时针均匀分布，朝外转', async () => {
    const r = await runAnimation(doc({ mode: 'radial', count: 4, radius: 100 }));
    r.instance.update(0);
    const p = r.drawn.map((x) => pos(x.matrix()));
    expect(p[0]!.x).toBeCloseTo(0);
    expect(p[0]!.y).toBeCloseTo(100);
    expect(p[1]!.x).toBeCloseTo(100);
    expect(p[1]!.y).toBeCloseTo(0);
    // 第二份转了 -90°（朝外）
    const q = new THREE.Quaternion();
    r.drawn[1]!.matrix().decompose(new THREE.Vector3(), q, new THREE.Vector3());
    expect(new THREE.Euler().setFromQuaternion(q).z).toBeCloseTo(-Math.PI / 2);
  });

  it('错开：每一份按名次晚 stagger 秒播放图层自己的动画，可见区间也跟着晚', async () => {
    const d = doc({ mode: 'linear', count: 3, spacing: { x: 0, y: 0 }, stagger: 0.5 }, { to: 0.4, props: { x: { keys: [{ t: 0, v: 0 }, { t: 1, v: 100 }] } } });
    const r = await runAnimation(d);
    r.instance.update(0.6);
    // 第 0 份已过可见区间（to = 0.4），第 1 份在 tt = 0.1，第 2 份还没轮到（tt < 0，不画）：复制器一份一份地出现
    expect(r.drawn.map((x) => x.opacity() > 0)).toEqual([false, true, false]);
    expect(pos(r.drawn[1]!.matrix()).x).toBeCloseTo(10);
  });

  it('从中心向外：同样远的同一名次', async () => {
    const d = doc({ mode: 'linear', count: 5, spacing: { x: 10, y: 0 }, stagger: 1, order: 'center' }, { props: { y: { keys: [{ t: 0, v: 0 }, { t: 1, v: 100 }] } } });
    const r = await runAnimation(d);
    r.instance.update(1);
    // 中间一份（名次 0）已到 100，旁边两份（名次 1）在起点，最外两份（名次 2）还没开始
    expect(r.drawn.map((x) => Math.round(pos(x.matrix()).y))).toEqual([0, 0, 100, 0, 0]);
  });

  it('随机：同一个种子结果相同，换种子结果不同；画面只取决于 t（乱序取帧结果相同）', async () => {
    const rep = { mode: 'grid', cols: 4, rows: 4, spacing: { x: 50, y: 50 }, jitter: { x: 20, y: 20, rot: 30, scale: 0.3 }, order: 'random', stagger: 0.1 };
    const a = await positions(doc({ ...rep, seed: 7 }));
    expect(await positions(doc({ ...rep, seed: 7 }))).toEqual(a);
    expect(await positions(doc({ ...rep, seed: 8 }))).not.toEqual(a);
    const r = await runAnimation(doc({ ...rep, seed: 7 }, { props: { x: { keys: [{ t: 0, v: 0 }, { t: 1, v: 100 }] } } }));
    const snap = () => r.drawn.map((x) => x.matrix().toArray().join(','));
    r.instance.update(0.7);
    const at07 = snap();
    r.instance.update(0.1);
    r.instance.update(0.9);
    r.instance.update(0.7);
    expect(snap()).toEqual(at07);
  });

  it('方块列表按方块排列放：与模板 arrangement.ts 的规则一致', async () => {
    const blocks = [
      { id: 'minecraft:red_wool', weight: 1 },
      { id: 'minecraft:blue_wool', weight: 2 },
      { id: 'minecraft:white_wool', weight: 1 },
    ];
    for (const arrangement of ['columns', 'rows', 'diagonal', 'checker', 'rings'] as const) {
      const d = doc({ mode: 'grid', cols: 5, rows: 4, spacing: { x: 10, y: 10 }, blocks, arrangement });
      const r = await runAnimation(d);
      r.instance.update(0);
      // 每一份的方块：按位置找回它是第几格
      const byCell = new Map<string, string>();
      for (const x of r.drawn) {
        const p = pos(x.matrix());
        byCell.set(`${Math.round(p.x / 10 + 2)},${Math.round(1.5 - p.y / 10)}`, x.what);
      }
      const expected = arrangeCells(arrangement, blocks, 5, 4, { next: () => 0 });
      for (let i = 0; i < 20; i++) expect(byCell.get(`${i % 5},${Math.floor(i / 5)}`)).toBe(blocks[expected[i]!]!.id);
    }
  });

  it('组不能复制；方块列表只给方块图层；网格不超过 256 份', () => {
    const base = { ...newAnimationDoc('R', 'B') };
    expect(AnimationDocSchema.safeParse({ ...base, layers: [{ id: 'g', name: 'G', type: 'group', props: {}, repeat: { mode: 'linear' } }] }).success).toBe(false);
    expect(AnimationDocSchema.safeParse({ ...base, layers: [{ id: 'r', name: 'R', type: 'rect', props: {}, repeat: { mode: 'linear', blocks: [{ id: 'minecraft:stone', weight: 1 }] } }] }).success).toBe(false);
    expect(AnimationDocSchema.safeParse({ ...base, layers: [{ id: 'b', name: 'B', type: 'block', block: 'minecraft:stone', props: {}, repeat: { mode: 'grid', cols: 20, rows: 20 } }] }).success).toBe(false);
  });
});
