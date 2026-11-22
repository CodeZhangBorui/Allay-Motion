// 095 附魔光扫 allay.builtin.glint-sweep 的验收测试（docs/template-catalog.md 第 2 节、docs/templates/glint-sweep.md）。
// 画面本身由 test:engine 的 T-TPL-3、4、5 检查；这里测 manifest 和纯函数（光带扫过的位置和轮廓）。
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { applyPreset, defaultParams, localizePresetParams, parseManifest, sameValue, sanitizeParams, type ParamDef } from '../../packages/template-sdk/src/index';
import { overlayWindows, progress } from '../../packages/templates/_lib/src/timing';
import { bandCenter, bandProfile, extentAlong } from '../../packages/templates/glint-sweep/src/layout';

const manifest = (() => {
  const r = parseManifest(JSON.parse(readFileSync(join(import.meta.dirname, '../../packages/templates/glint-sweep/manifest.json'), 'utf8')));
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

describe('T-TPL-C095 附魔光扫', () => {
  it('T-TPL-C095-1 manifest 合法，默认参数清洗后不变；叠加层、分组 shader、三段时间线；默认的音效是附魔台', () => {
    expect(manifest.id).toBe('allay.builtin.glint-sweep');
    expect(manifest.category).toBe('overlay');
    expect(manifest.tags?.[0]).toBe('shader');
    const d = defaultParams(defs, { locale: 'zh-CN' });
    expect(sanitizeParams(defs, d)).toEqual(d);
    expect(manifest.timeline?.segments.map((s) => s.param)).toEqual(['inDuration', 'hold', 'outDuration']);
    const [i, h, o] = [range('inDuration'), range('hold'), range('outDuration')];
    expect(i[0] + h[0] + o[0]).toBeGreaterThanOrEqual(0.1);
    expect(i[1] + h[1] + o[1]).toBeLessThanOrEqual(30);
    expect(d.sound).toBe('minecraft:block.enchantment_table.use');
    expect(d.image).toBe('');
  });

  it('T-TPL-C095-2 每个自带预设都能载入：值经过清洗后不变', () => {
    expect(manifest.presets?.length).toBeGreaterThanOrEqual(2);
    for (const preset of manifest.presets ?? []) {
      for (const locale of ['zh-CN', 'en']) {
        // 和应用里套用预设走同一条路（applyPreset：按界面语言取出双语的文字，再清洗）
        const applied = applyPreset(defs, preset, { locale });
        for (const [k, v] of Object.entries(localizePresetParams(defs, preset.params, locale))) expect(sameValue(applied[k], v), `${preset.key}.${k} ${locale}`).toBe(true);
      }
    }
  });

  it('T-TPL-C095-3 光带：每扫一次从画外走到另一边画外，中间扫过画面中心；画面沿方向的半径', () => {
    expect(extentAlong(960, 540, 0)).toBeCloseTo(960, 9);
    expect(extentAlong(960, 540, Math.PI / 2)).toBeCloseTo(540, 9);
    const extent = extentAlong(960, 540, (25 * Math.PI) / 180);
    const w = 190;
    for (const q of [0, 1, 2]) expect(Math.abs(bandCenter(q, extent, w))).toBeGreaterThanOrEqual(extent + w - 1e-9);
    expect(bandCenter(0.5, extent, w)).toBeCloseTo(0, 9);
    expect(bandCenter(1.5, extent, w)).toBeCloseTo(0, 9);
    expect(bandProfile(0, w)).toBe(1);
    expect(bandProfile(w, w)).toBe(0);
    expect(bandProfile(w * 2, w)).toBe(0);
  });

  it('T-TPL-C095-4 首末帧：整体的淡入淡出在两端精确为 0（叠加层的时间窗首尾各让出一帧）', () => {
    const win = overlayWindows(60, 0.3, 1.4, 0.3);
    const e = (t: number) => progress(t, win.in) * (1 - progress(t, win.out));
    expect(e(0)).toBe(0);
    expect(e(1 / 60)).toBe(0);
    expect(e(win.duration)).toBe(0);
    expect(e(win.duration - 1 / 60)).toBe(0);
    expect(e(1)).toBe(1);
  });
});
