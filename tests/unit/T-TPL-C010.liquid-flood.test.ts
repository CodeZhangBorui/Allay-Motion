// 010 液体淹没 allay.builtin.liquid-flood 的验收测试（docs/template-catalog.md 第 2 节、docs/templates/liquid-flood.md）。
// 画面本身（首末帧透明、剪辑点不透明、三种画幅、确定性）由 test:engine 的 T-TPL-3、4、5 检查；这里测 manifest 和纯函数。
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { applyPreset, defaultParams, localizePresetParams, parseManifest, sameValue, sanitizeParams, type ParamDef } from '../../packages/template-sdk/src/index';
import { DEFAULT_SOUNDS, levelAt, levelRange, soundFor, SOURCES, surfaceWave, toFillSpace, type WaveTerm } from '../../packages/templates/liquid-flood/src/layout';

const manifest = (() => {
  const r = parseManifest(JSON.parse(readFileSync(join(import.meta.dirname, '../../packages/templates/liquid-flood/manifest.json'), 'utf8')));
  if (!r.ok) throw new Error(`manifest invalid: ${JSON.stringify(r)}`);
  return r.manifest;
})();
const defs = manifest.params ?? [];
const def = (key: string): ParamDef => defs.find((p) => p.key === key)!;
const range = (key: string): [number, number] => {
  const p = def(key);
  if (p.type !== 'duration') throw new Error(key);
  return [p.min, p.max];
};

describe('T-TPL-C010 液体淹没', () => {
  it('T-TPL-C010-1 manifest 合法，默认参数清洗后不变；转场、分组 blocks、三段时间线，时长在 0.1–30 秒里；默认音效是带命名空间的原版事件', () => {
    expect(manifest.id).toBe('allay.builtin.liquid-flood');
    expect(manifest.category).toBe('transition');
    expect(manifest.tags?.[0]).toBe('blocks');
    const d = defaultParams(defs, { locale: 'zh-CN' });
    expect(sanitizeParams(defs, d)).toEqual(d);
    expect(manifest.timeline?.segments.map((s) => s.param)).toEqual(['inDuration', 'hold', 'outDuration']);
    const [i, h, o] = [range('inDuration'), range('hold'), range('outDuration')];
    expect(i[0] + h[0] + o[0]).toBeGreaterThanOrEqual(0.1);
    expect(i[1] + h[1] + o[1]).toBeLessThanOrEqual(30);
    for (const p of defs) if (p.type === 'sound' && p.default !== null) expect(p.default).toMatch(/^minecraft:[a-z0-9_.]+$/);
    expect(d.waterColor).toBe('#3F76E4');
    expect(manifest.params?.some((p) => p.type === 'seed')).toBe(true);
  });

  it('T-TPL-C010-2 每个自带预设都能载入：值经过清洗后不变（含目录 1.9 的岩浆、沼泽水色、暖水色）', () => {
    expect(manifest.presets?.length).toBeGreaterThanOrEqual(2);
    const keys = (manifest.presets ?? []).map((p) => p.key);
    expect(keys).toEqual(expect.arrayContaining(['lava', 'swamp', 'warm-ocean']));
    for (const preset of manifest.presets ?? []) {
      for (const locale of ['zh-CN', 'en']) {
        // 和应用里套用预设走同一条路（applyPreset：按界面语言取出双语的文字，再清洗）
        const applied = applyPreset(defs, preset, { locale });
        for (const [k, v] of Object.entries(localizePresetParams(defs, preset.params, locale))) expect(sameValue(applied[k], v), `${preset.key}.${k} ${locale}`).toBe(true);
      }
    }
    const swamp = manifest.presets!.find((p) => p.key === 'swamp')!;
    // 沼泽的水色、水下雾色（对照过游戏文件 data/minecraft/worldgen/biome/swamp.json）
    expect(swamp.params).toMatchObject({ waterColor: '#617B64', depthColor: '#232317' });
  });

  it('T-TPL-C010-3 水位：进度 0 时连起伏最高处也在来水那一边以外，进度 1 时连起伏最低处也过了对边（剪辑点整个画面在水下）', () => {
    for (const length of [1080, 1920]) {
      const amp = 50;
      const pad = 20;
      const r = levelRange(length, amp, pad);
      expect(levelAt(0, r) + amp).toBeLessThan(0);
      expect(levelAt(1, r) - amp).toBeGreaterThan(length);
      expect(levelAt(0.5, r)).toBeCloseTo(length / 2, 6);
    }
  });

  it('T-TPL-C010-4 水面的起伏在 [−1, 1] 里；四个来水方向的坐标换算：来水那一边是 0', () => {
    const terms: WaveTerm[] = [
      { k: 0.01, w: 2, phase: 0.3, amp: 1 },
      { k: 0.023, w: -1.7, phase: 1.1, amp: 0.5 },
    ];
    for (let c = -1000; c <= 1000; c += 37) for (const t of [0, 0.4, 1.3]) expect(Math.abs(surfaceWave(c, t, terms))).toBeLessThanOrEqual(1);
    const [hw, hh] = [960, 540];
    expect(toFillSpace('bottom', 0, -hh, hw, hh).s).toBe(0);
    expect(toFillSpace('top', 0, hh, hw, hh).s).toBe(0);
    expect(toFillSpace('left', -hw, 0, hw, hh).s).toBe(0);
    expect(toFillSpace('right', hw, 0, hw, hh).s).toBe(0);
    expect(SOURCES).toEqual(['bottom', 'top', 'left', 'right']);
  });

  it('T-TPL-C010-5 默认音效按液体换：水是倒水、装水，岩浆是倒岩浆、装岩浆；改过的和置空的不动', () => {
    expect(soundFor(DEFAULT_SOUNDS.water.fill, 'fill', 'lava')).toBe('minecraft:item.bucket.empty_lava');
    expect(soundFor(DEFAULT_SOUNDS.lava.drain, 'drain', 'water')).toBe('minecraft:item.bucket.fill');
    expect(soundFor('minecraft:block.lava.pop', 'fill', 'water')).toBe('minecraft:block.lava.pop');
    expect(soundFor(null, 'fill', 'lava')).toBeNull();
    expect(def('fillSound').default).toBe(DEFAULT_SOUNDS.water.fill);
    expect(def('drainSound').default).toBe(DEFAULT_SOUNDS.water.drain);
  });
});
