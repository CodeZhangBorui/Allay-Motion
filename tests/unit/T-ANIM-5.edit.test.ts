// T-ANIM-5：对动画文档的小步修改（apps/desktop/src/shared/animation/edit.ts）——自动关键帧、切换关键帧、挪动、缓动；
// 以及界面里的求值和 Worker 里的求值一致（同一份规则写了两遍：edit.ts 的 sampleTrack 与 runtime.template.js 的 sample）。
// T-DEV-7：开发模式的设置与可选模块的生效开关。
import { describe, expect, it } from 'vitest';
import { keyIndexAt, layerKeyTimes, moveKey, removeKey, sampleTrack, setKeyEase, setValueAt, toggleKeyAt, type EaseEval, type ResolvedTrack } from '../../apps/desktop/src/shared/animation/edit';
import { AnimationDocSchema, newAnimationDoc, type Track } from '../../apps/desktop/src/shared/animation/schema';
import { effectiveModuleSwitches } from '../../apps/desktop/src/renderer/features/dev/devMode';
import { applyUiPatch, defaultUiSettings, UiSettingsPatchSchema, UiSettingsSchema } from '../../apps/desktop/src/shared/settings';

const linear: EaseEval = () => (x) => x;
const keyed = (...keys: [number, number][]): Track => ({ keys: keys.map(([t, v]) => ({ t, v })) });

describe('T-ANIM-5 关键帧的编辑', () => {
  it('没有关键帧的属性：改的是常量', () => {
    expect(setValueAt(undefined, 1, 5)).toBe(5);
    expect(setValueAt(3, 1, 5)).toBe(5);
  });

  it('有关键帧的属性：当前时刻有关键帧就改它，没有就插一个（缓动沿用前一个）', () => {
    const tr: Track = { keys: [{ t: 0, v: 0, ease: 'cubicOut' }, { t: 1, v: 10 }] };
    expect(setValueAt(tr, 1, 20)).toEqual({ keys: [{ t: 0, v: 0, ease: 'cubicOut' }, { t: 1, v: 20 }] });
    expect(setValueAt(tr, 0.5, 3)).toEqual({ keys: [{ t: 0, v: 0, ease: 'cubicOut' }, { t: 0.5, v: 3, ease: 'cubicOut' }, { t: 1, v: 10 }] });
  });

  it('切换关键帧：没有就以当前值加，有就删，删到最后一个变回常量', () => {
    expect(toggleKeyAt(7, 0.5, 7)).toEqual({ keys: [{ t: 0.5, v: 7 }] });
    expect(toggleKeyAt(keyed([0.5, 7]), 0.5, 7)).toBe(7);
    expect(toggleKeyAt(keyed([0, 1], [1, 2]), 0, 1)).toEqual(keyed([1, 2]));
  });

  it('挪关键帧：重新排序；会和别的关键帧重合时不动；夹在 [0, 时长]', () => {
    expect(moveKey(keyed([0, 1], [1, 2]), 0, 1.5, 3)).toEqual(keyed([1, 2], [1.5, 1]));
    expect(moveKey(keyed([0, 1], [1, 2]), 0, 1, 3)).toBeNull();
    expect(moveKey(keyed([0, 1]), 0, 9, 3)).toEqual(keyed([3, 1]));
  });

  it('缓动：linear 不写进文档；删关键帧', () => {
    expect(setKeyEase(keyed([0, 1], [1, 2]), 0, 'quadIn')).toEqual({ keys: [{ t: 0, v: 1, ease: 'quadIn' }, { t: 1, v: 2 }] });
    expect(setKeyEase({ keys: [{ t: 0, v: 1, ease: 'quadIn' }] }, 0, 'linear')).toEqual(keyed([0, 1]));
    expect(removeKey(keyed([0, 1], [1, 2]), 1)).toEqual(keyed([0, 1]));
    expect(keyIndexAt(keyed([0, 1], [1, 2]), 1.001)).toBe(1);
  });

  it('求值：之前取第一个、之后取最后一个、hold 保持', () => {
    const tr: ResolvedTrack = { keys: [{ t: 1, v: 0 }, { t: 2, v: 10, ease: 'hold' }, { t: 3, v: 20 }] };
    expect(sampleTrack(tr, 0, 0, linear)).toBe(0);
    expect(sampleTrack(tr, 0, 1.5, linear)).toBe(5);
    expect(sampleTrack(tr, 0, 2.9, linear)).toBe(10);
    expect(sampleTrack(tr, 0, 9, linear)).toBe(20);
    expect(sampleTrack(undefined, 1, 9, linear)).toBe(1);
  });

  it('修改后的文档仍合 schema；图层的关键帧时刻去重排序', () => {
    const doc = newAnimationDoc('x');
    const layer = doc.layers[0]!;
    layer.props.x = setValueAt(toggleKeyAt(undefined, 0.25, 0), 0.75, 100);
    expect(AnimationDocSchema.safeParse(doc).success).toBe(true);
    expect(layerKeyTimes(layer)).toEqual([0, 0.25, 0.6, 0.75, 1.2, 1.6, 2]);
  });
});

describe('T-DEV-7 开发模式的设置', () => {
  it('新装默认关；旧设置文件没有这一项时读成关；补丁只接受布尔', () => {
    expect(defaultUiSettings().devMode).toBe(false);
    const old = { ...defaultUiSettings() } as Record<string, unknown>;
    delete old.devMode;
    expect(UiSettingsSchema.parse(old).devMode).toBe(false);
    expect(UiSettingsPatchSchema.safeParse({ devMode: 'yes' }).success).toBe(false);
    expect(applyUiPatch(defaultUiSettings(), { devMode: true }).devMode).toBe(true);
  });

  it('可选模块随开发模式启用：关着时全关；开着时除非单独关掉都开', () => {
    expect(effectiveModuleSwitches(['code-editor'], false, { 'code-editor': true })).toEqual({});
    expect(effectiveModuleSwitches(['code-editor', 'mcp'], true, {})).toEqual({ 'code-editor': true, mcp: true });
    expect(effectiveModuleSwitches(['code-editor'], true, { 'code-editor': false })).toEqual({ 'code-editor': false });
  });
});
