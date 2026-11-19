// T-ANIM-30：图片图层（docs/animation-editor.md 10.13）——按贴图 ID 取贴图、建精灵、设宽高；九宫格边框和像素大小传给精灵；
// 没选图片时不画；可以绑定到贴图参数（参数值换图片）；转为模板时贴图参数允许选本机图片（allowFile）。
// 本机图片在工程文件里的保存、转为模板时的复制见 project-service.test.ts 和 template-dev.test.ts 的 T-ANIM-30。
import { describe, expect, it } from 'vitest';
import { animationManifest } from '../../apps/desktop/src/shared/animation/compile';
import { AnimationDocSchema, newAnimationDoc, type AnimationDoc } from '../../apps/desktop/src/shared/animation/schema';
import { runAnimation, scaleOf } from './helpers/anim-runtime';

const doc = (layer: Record<string, unknown>, params: unknown[] = []): AnimationDoc =>
  AnimationDocSchema.parse({ ...newAnimationDoc('I', 'B'), params, layers: [{ id: 'i', name: 'I', type: 'image', props: {}, ...layer }] });

describe('T-ANIM-30 图片图层', () => {
  it('按贴图 ID 建精灵，宽高是图层的 width、height', async () => {
    const r = await runAnimation(doc({ image: 'minecraft:block/stone', width: 300, height: 120 }));
    r.instance.update(0);
    expect(r.textures).toContain('minecraft:block/stone');
    const sprites = r.drawn.filter((d) => d.kind === 'sprite');
    expect(sprites).toHaveLength(1);
    const s = scaleOf(sprites[0]!.matrix());
    expect(s.x).toBeCloseTo(300);
    expect(s.y).toBeCloseTo(120);
  });

  it('没选图片时不画', async () => {
    const r = await runAnimation(doc({ image: '' }));
    r.instance.update(0);
    expect(r.drawn.filter((d) => d.kind === 'sprite')).toHaveLength(0);
    expect(r.textures).toHaveLength(0);
  });

  it('绑定到贴图参数：参数值换图片，没给值时用默认值；manifest 里的贴图参数允许本机图片', async () => {
    const params = [{ key: 'pic', label: 'Pic', type: 'texture', default: 'minecraft:item/diamond' }];
    const d = doc({ image: { $param: 'pic' } }, params);
    expect((await runAnimation(d)).textures).toContain('minecraft:item/diamond');
    expect((await runAnimation(d, { pic: 'minecraft:gui/sprites/hud/heart/full' })).textures).toContain('minecraft:gui/sprites/hud/heart/full');
    const manifest = animationManifest(d, { id: 'user.abcdef.i', version: '1.0.0' }) as { params: { key: string; type: string; allowFile?: boolean }[] };
    expect(manifest.params.find((p) => p.key === 'pic')).toMatchObject({ type: 'texture', allowFile: true });
  });

  it('格式：图片可以是贴图 ID、asset:、file: 引用或空；参数的默认值不能是 file:；九宫格四个整数', () => {
    const ok = (layer: Record<string, unknown>, params: unknown[] = []) => AnimationDocSchema.safeParse({ ...newAnimationDoc('I', 'B'), params, layers: [{ id: 'i', name: 'I', type: 'image', props: {}, ...layer }] }).success;
    expect(ok({ image: 'asset:logo.png' })).toBe(true);
    expect(ok({ image: 'file:3f2504e0-4f89-41d3-9a0c-0305e82c3301' })).toBe(true);
    expect(ok({ image: 'https://example.com/a.png' })).toBe(false);
    expect(ok({ image: '', nineSlice: [4, 4, 4, 4] })).toBe(true);
    expect(ok({ image: '', nineSlice: [4, 4, 4] })).toBe(false);
    expect(ok({ image: { $param: 'p' } }, [{ key: 'p', label: 'P', type: 'texture', default: 'file:3f2504e0-4f89-41d3-9a0c-0305e82c3301' }])).toBe(false);
  });
});
