// T-ANIM-31：逐字动画（docs/animation-editor.md 3.8）——每个字一份（空格不画），摆在它在整段里的位置；
// 按名次晚 stagger 秒播放图层自己的动画；随机名次只取决于种子；不能和复制器同时用。
// 测试里的假文字每个字 6 个字体像素宽，没有间隔，所以位置可以手算。
import { describe, expect, it } from 'vitest';
import { AnimationDocSchema, newAnimationDoc, type AnimationDoc } from '../../apps/desktop/src/shared/animation/schema';
import { pos, runAnimation } from './helpers/anim-runtime';

const doc = (text: Record<string, unknown>, extra: Record<string, unknown> = {}): AnimationDoc =>
  AnimationDocSchema.parse({ ...newAnimationDoc('C', 'B'), layers: [{ id: 't', name: 'T', type: 'text', text: 'AB C', size: 1, props: {}, ...text, ...extra }] });

const glyphs = async (d: AnimationDoc, t = 0) => {
  const r = await runAnimation(d);
  r.instance.update(t);
  return r.drawn.filter((x) => x.kind === 'text' && x.visible() && x.opacity() > 0).map((x) => ({ what: x.what, x: Math.round(pos(x.matrix()).x * 100) / 100, y: Math.round(pos(x.matrix()).y * 100) / 100 }));
};

describe('T-ANIM-31 逐字动画', () => {
  it('每个字一份，空格不画；居中时以整行的中点为准，左对齐时从图层位置往右排', async () => {
    expect(await glyphs(doc({ chars: { stagger: 0 } }))).toEqual([
      { what: 'A', x: -9, y: 0 },
      { what: 'B', x: -3, y: 0 },
      { what: 'C', x: 9, y: 0 },
    ]);
    expect((await glyphs(doc({ align: 'left', chars: { stagger: 0 } }))).map((g) => g.x)).toEqual([3, 9, 21]);
  });

  it('按名次错开：每个字晚 stagger 秒播放图层的动画（位置以字自己为准相加）', async () => {
    const d = doc({ chars: { stagger: 0.5 } }, { props: { y: { keys: [{ t: 0, v: 0 }, { t: 1, v: 100 }] } } });
    const g = await glyphs(d, 1);
    expect(g.map((x) => x.y)).toEqual([100, 50, 0]);
    // 倒序：最后一个字先动
    const rev = await glyphs(doc({ chars: { stagger: 0.5, order: 'reverse' } }, { props: { y: { keys: [{ t: 0, v: 0 }, { t: 1, v: 100 }] } } }), 1);
    expect(rev.map((x) => x.y)).toEqual([0, 50, 100]);
  });

  it('随机名次：同一个种子结果相同，换种子可能不同；画面只取决于 t', async () => {
    const make = (seed: number) => doc({ text: 'ABCDEFGH', chars: { stagger: 0.1, order: 'random', seed } }, { props: { y: { keys: [{ t: 0, v: 0 }, { t: 1, v: 100 }] } } });
    const a = await glyphs(make(3), 0.5);
    expect(await glyphs(make(3), 0.5)).toEqual(a);
    const others = await Promise.all([4, 5, 6].map(async (s) => JSON.stringify(await glyphs(make(s), 0.5))));
    expect(others.some((o) => o !== JSON.stringify(a))).toBe(true);
  });

  it('不能和复制器同时用', () => {
    expect(AnimationDocSchema.safeParse({ ...newAnimationDoc('C', 'B'), layers: [{ id: 't', name: 'T', type: 'text', text: 'A', props: {}, chars: {}, repeat: { mode: 'linear' } }] }).success).toBe(false);
  });
});
