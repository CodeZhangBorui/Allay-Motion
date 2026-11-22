// 026 激流 allay.builtin.riptide-vortex 的验收测试（docs/template-catalog.md 第 2 节、docs/templates/riptide-vortex.md）。
// 画面本身由 test:engine 的 T-TPL-3、4、5 检查；这里测 manifest 和纯函数（洞口的大小、转速、按等级换的音效）。
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { applyPreset, defaultParams, localizePresetParams, parseManifest, sameValue, sanitizeParams, type ParamDef } from '../../packages/template-sdk/src/index';
import { holeRadius, LOBE, openRadius, RIPTIDE_SOUNDS, riptideSound, spinRate } from '../../packages/templates/riptide-vortex/src/layout';

const manifest = (() => {
  const r = parseManifest(JSON.parse(readFileSync(join(import.meta.dirname, '../../packages/templates/riptide-vortex/manifest.json'), 'utf8')));
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

describe('T-TPL-C026 激流', () => {
  it('T-TPL-C026-1 manifest 合法，默认参数清洗后不变；转场、分组 items、三段时间线；默认等级 3 配激流 III 的音效', () => {
    expect(manifest.id).toBe('allay.builtin.riptide-vortex');
    expect(manifest.category).toBe('transition');
    expect(manifest.tags?.[0]).toBe('items');
    const d = defaultParams(defs, { locale: 'zh-CN' });
    expect(sanitizeParams(defs, d)).toEqual(d);
    expect(manifest.timeline?.segments.map((s) => s.param)).toEqual(['inDuration', 'hold', 'outDuration']);
    const [i, h, o] = [range('inDuration'), range('hold'), range('outDuration')];
    expect(i[0] + h[0] + o[0]).toBeGreaterThanOrEqual(0.1);
    expect(i[1] + h[1] + o[1]).toBeLessThanOrEqual(30);
    expect(d.level).toBe(3);
    expect(d.sound).toBe('minecraft:item.trident.riptide_3');
    for (const p of defs) if (p.type === 'sound' && p.default !== null) expect(p.default).toMatch(/^minecraft:[a-z0-9_.]+$/);
  });

  it('T-TPL-C026-2 每个自带预设都能载入：值经过清洗后不变', () => {
    expect(manifest.presets?.length).toBeGreaterThanOrEqual(2);
    for (const preset of manifest.presets ?? []) {
      for (const locale of ['zh-CN', 'en']) {
        // 和应用里套用预设走同一条路（applyPreset：按界面语言取出双语的文字，再清洗）
        const applied = applyPreset(defs, preset, { locale });
        for (const [k, v] of Object.entries(localizePresetParams(defs, preset.params, locale))) expect(sameValue(applied[k], v), `${preset.key}.${k} ${locale}`).toBe(true);
      }
    }
  });

  it('T-TPL-C026-3 洞口：张开时起伏最低的地方也在画面的角外面，关上时连起伏最高的地方都小于 0（剪辑点全满）；中间先快后慢', () => {
    for (const [hw, hh] of [
      [960, 540],
      [540, 960],
      [540, 540],
    ] as const) {
      const pad = 20;
      const open = openRadius(hw, hh, pad);
      expect(holeRadius(0, open) * (1 - LOBE)).toBeGreaterThan(Math.hypot(hw, hh));
      expect(holeRadius(1, open) * (1 + LOBE)).toBeLessThan(0);
    }
    const open = 1000;
    // 前一半收掉的比后一半多
    expect(open - holeRadius(0.5, open)).toBeGreaterThan(holeRadius(0.5, open) - holeRadius(0.999, open));
  });

  it('T-TPL-C026-4 等级：越高转得越快；音效保持某一级的默认值时跟着等级换，自己选的和置空的不动', () => {
    expect(spinRate(1)).toBeLessThan(spinRate(2));
    expect(spinRate(2)).toBeLessThan(spinRate(3));
    expect(riptideSound(RIPTIDE_SOUNDS[2], 1)).toBe('minecraft:item.trident.riptide_1');
    expect(riptideSound(RIPTIDE_SOUNDS[0], 3)).toBe('minecraft:item.trident.riptide_3');
    expect(riptideSound('minecraft:entity.player.splash', 2)).toBe('minecraft:entity.player.splash');
    expect(riptideSound(null, 2)).toBeNull();
  });
});
