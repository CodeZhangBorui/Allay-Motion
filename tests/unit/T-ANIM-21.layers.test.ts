// 第三轮第二批（docs/animation-editor.md 10.8）：
// T-ANIM-21 图层的文档操作：显示顺序（树）、复制（连同子孙）、成组与解组、父级（不成环）、删除时子图层改挂、排序、可见区间、开关；
// T-ANIM-22 Worker 里的层级：子图层接在父级的变换后面、大小不传给子图层、不透明度相乘、父级隐藏时子图层也隐藏、独显。
import { describe, expect, it } from 'vitest';
import { descendants, duplicateLayers, groupLayers, layerTree, moveLayer, removeLayer, setLayerFlags, setLayerInterval, setParent, ungroup } from '../../apps/desktop/src/shared/animation/layers';
import { AnimationDocSchema, newAnimationDoc, type AnimationDoc } from '../../apps/desktop/src/shared/animation/schema';
import { pos, runAnimation, scaleOf } from './helpers/anim-runtime';

const block = (id: string, extra: Record<string, unknown> = {}) => ({ id, name: id.toUpperCase(), type: 'block', block: 'minecraft:stone', size: 10, props: {}, ...extra });

function doc(layers: unknown[]): AnimationDoc {
  return AnimationDocSchema.parse({ ...newAnimationDoc('L', 'B'), layers });
}

describe('T-ANIM-21 图层的文档操作', () => {
  const d = doc([block('a'), { id: 'g', name: 'G', type: 'group', props: {} }, block('b', { parent: 'g' }), block('c', { parent: 'g' }), block('d')]);

  it('显示顺序：画在最前面的在最上面，子图层紧跟在父级下面', () => {
    expect(layerTree(d).map((e) => `${'  '.repeat(e.depth)}${e.layer.id}`)).toEqual(['d', 'g', '  c', '  b', 'a']);
    expect(descendants(d, 'g').sort()).toEqual(['b', 'c']);
  });

  it('父级：不能是自己、不能是自己的子孙；schema 拒绝不存在的父级和环', () => {
    expect(setParent(d, 'g', 'b')).toBeNull();
    expect(setParent(d, 'a', 'a')).toBeNull();
    expect(setParent(d, 'a', 'g')!.layers.find((l) => l.id === 'a')!.parent).toBe('g');
    expect(AnimationDocSchema.safeParse({ ...d, layers: [block('x', { parent: 'nope' })] }).success).toBe(false);
    expect(AnimationDocSchema.safeParse({ ...d, layers: [block('x', { parent: 'y' }), block('y', { parent: 'x' })] }).success).toBe(false);
  });

  it('复制：连同子孙、新 id、副本之间的父子关系换成新 id，放在原来那一块的上面', () => {
    const r = duplicateLayers(d, ['g'], ' copy')!;
    const next = AnimationDocSchema.parse(r.doc);
    expect(r.ids).toHaveLength(1);
    const g2 = next.layers.find((l) => l.id === r.ids[0])!;
    expect(g2.name).toBe('G copy');
    const kids = next.layers.filter((l) => l.parent === g2.id).map((l) => l.id);
    expect(kids).toHaveLength(2);
    expect(kids.every((k) => !['b', 'c'].includes(k))).toBe(true);
    // 原来的不变
    expect(next.layers.filter((l) => l.parent === 'g').map((l) => l.id)).toEqual(['b', 'c']);
    // 复制选中的子图层时不重复复制
    expect(duplicateLayers(d, ['g', 'b'], ' copy')!.ids).toHaveLength(1);
  });

  it('成组：组放在最靠前的那个的位置，父级是共同的父级；解组：组有自己的变换时拒绝', () => {
    const r = groupLayers(d, ['a', 'd'], 'Pair')!;
    const next = AnimationDocSchema.parse(r.doc);
    expect(next.layers.filter((l) => l.parent === r.id).map((l) => l.id)).toEqual(['a', 'd']);
    expect(next.layers.findIndex((l) => l.id === r.id)).toBe(next.layers.length - 1);
    const inner = groupLayers(d, ['b', 'c'], 'Inner')!;
    expect(inner.doc.layers.find((l) => l.id === inner.id)!.parent).toBe('g');
    expect(AnimationDocSchema.parse(ungroup(next, r.id)!).layers.some((l) => l.id === r.id)).toBe(false);
    const moved = AnimationDocSchema.parse({ ...next, layers: next.layers.map((l) => (l.id === r.id ? { ...l, props: { x: 10 } } : l)) });
    expect(ungroup(moved, r.id)).toBeNull();
  });

  it('删除：子图层改挂到被删图层的父级', () => {
    const next = AnimationDocSchema.parse(removeLayer(d, 'g')!);
    expect(next.layers.find((l) => l.id === 'b')!.parent).toBeUndefined();
  });

  it('排序：子孙跟着一起挪', () => {
    const next = AnimationDocSchema.parse(moveLayer(d, 'g', 0)!);
    expect(next.layers.map((l) => l.id)).toEqual(['g', 'b', 'c', 'a', 'd']);
  });

  it('可见区间夹在 [0, 时长]、from 不超过 to；开关给 false 就去掉字段', () => {
    expect(setLayerInterval(d, 'a', 0.5, 9, 2)!.layers[0]).toMatchObject({ from: 0.5, to: 2 });
    expect(setLayerInterval(d, 'a', 1.5, 1, 2)).toBeNull();
    const flagged = setLayerFlags(d, 'a', { hidden: true, solo: true })!;
    expect(flagged.layers[0]).toMatchObject({ hidden: true, solo: true });
    expect('hidden' in setLayerFlags(flagged, 'a', { hidden: false })!.layers[0]!).toBe(false);
  });
});

describe('T-ANIM-22 Worker 里的层级', () => {
  it('子图层接在父级的变换后面；父级（方块）的大小不传给子图层', async () => {
    const d = doc([block('p', { size: 100, props: { x: 200, rotZ: 90 } }), block('c', { parent: 'p', size: 10, props: { x: 50 } })]);
    const r = await runAnimation(d);
    r.instance.update(0);
    const [p, c] = r.drawn;
    expect(pos(p!.matrix()).x).toBeCloseTo(200);
    expect(scaleOf(p!.matrix()).x).toBeCloseTo(100);
    // 子图层：父级转了 90°，自己往 x 挪 50 → 落在 (200, 50)
    expect(pos(c!.matrix()).x).toBeCloseTo(200);
    expect(pos(c!.matrix()).y).toBeCloseTo(50);
    expect(scaleOf(c!.matrix()).x).toBeCloseTo(10);
  });

  it('组：不画东西；不透明度沿父级相乘；父级隐藏或在可见区间外时子图层也不画', async () => {
    const d = doc([{ id: 'g', name: 'G', type: 'group', to: 1, props: { opacity: 0.5 } }, block('c', { parent: 'g', props: { opacity: 0.5 } })]);
    const r = await runAnimation(d);
    expect(r.drawn).toHaveLength(1);
    r.instance.update(0.5);
    expect(r.drawn[0]!.opacity()).toBeCloseTo(0.25);
    expect(r.drawn[0]!.visible()).toBe(true);
    r.instance.update(1.2);
    expect(r.drawn[0]!.visible()).toBe(false);
    const hidden = await runAnimation(doc([{ id: 'g', name: 'G', type: 'group', hidden: true, props: {} }, block('c', { parent: 'g' })]));
    hidden.instance.update(0.5);
    expect(hidden.drawn[0]!.visible()).toBe(false);
  });

  it('独显：只画独显的图层和它们的子图层', async () => {
    const d = doc([block('a'), { id: 'g', name: 'G', type: 'group', solo: true, props: {} }, block('b', { parent: 'g' })]);
    const r = await runAnimation(d);
    r.instance.update(0.5);
    expect(r.drawn.map((x) => `${x.what}:${x.visible()}`)).toEqual(['minecraft:stone:false', 'minecraft:stone:true']);
  });
});
