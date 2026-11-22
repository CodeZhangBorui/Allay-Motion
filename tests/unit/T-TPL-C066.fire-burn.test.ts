// 066 烧穿 allay.builtin.fire-burn 的验收测试（docs/template-catalog.md 第 2 节、docs/templates/fire-burn.md）。
// 画面本身由 test:engine 的 T-TPL-3、4、5 检查；这里测 manifest 和纯函数（火线走过的范围、烧穿的阈值、火星的出生）。
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { applyPreset, defaultParams, localizePresetParams, parseManifest, sameValue, sanitizeParams, type ParamDef } from '../../packages/template-sdk/src/index';
import { fitLife } from '../../packages/templates/_lib/src/shader-particles';
import { burnProgress, burnThreshold, frontAt, frontRange, frontWave, normalize, type WaveTerm } from '../../packages/templates/fire-burn/src/layout';

const manifest = (() => {
  const r = parseManifest(JSON.parse(readFileSync(join(import.meta.dirname, '../../packages/templates/fire-burn/manifest.json'), 'utf8')));
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

describe('T-TPL-C066 烧穿', () => {
  it('T-TPL-C066-1 manifest 合法，默认参数清洗后不变；转场、分组 particles、三段时间线；默认音效带命名空间', () => {
    expect(manifest.id).toBe('allay.builtin.fire-burn');
    expect(manifest.category).toBe('transition');
    expect(manifest.tags?.[0]).toBe('particles');
    const d = defaultParams(defs, { locale: 'zh-CN' });
    expect(sanitizeParams(defs, d)).toEqual(d);
    expect(manifest.timeline?.segments.map((s) => s.param)).toEqual(['inDuration', 'hold', 'outDuration']);
    const [i, h, o] = [range('inDuration'), range('hold'), range('outDuration')];
    expect(i[0] + h[0] + o[0]).toBeGreaterThanOrEqual(0.1);
    expect(i[1] + h[1] + o[1]).toBeLessThanOrEqual(30);
    expect([d.igniteSound, d.burnSound]).toEqual(['minecraft:item.firecharge.use', 'minecraft:block.fire.ambient']);
    for (const p of defs) if (p.type === 'sound' && p.default !== null) expect(p.default).toMatch(/^minecraft:[a-z0-9_.]+$/);
  });

  it('T-TPL-C066-2 每个自带预设都能载入：值经过清洗后不变', () => {
    expect(manifest.presets?.length).toBeGreaterThanOrEqual(2);
    for (const preset of manifest.presets ?? []) {
      for (const locale of ['zh-CN', 'en']) {
        // 和应用里套用预设走同一条路（applyPreset：按界面语言取出双语的文字，再清洗）
        const applied = applyPreset(defs, preset, { locale });
        for (const [k, v] of Object.entries(localizePresetParams(defs, preset.params, locale))) expect(sameValue(applied[k], v), `${preset.key}.${k} ${locale}`).toBe(true);
      }
    }
  });

  it('T-TPL-C066-3 火线：进度 0 时连火苗一起在画面下边以外，进度 1 时连发红的那一条和火苗一起在上边以外（剪辑点全是焦黑）', () => {
    const terms: WaveTerm[] = [
      { k: 0.004, phase: 1, amp: 1 },
      { k: 0.011, phase: 2, amp: 0.5 },
    ];
    for (let x = -1000; x <= 1000; x += 50) expect(Math.abs(frontWave(x, terms))).toBeLessThanOrEqual(1);
    const [halfH, amp, flame, glow, pad] = [540, 60, 150, 50, 8];
    const r = frontRange(halfH, amp, flame, glow, pad);
    for (let x = -1000; x <= 1000; x += 50) {
      // 进度 0：火线最高处加上火苗也在下边以外
      expect(frontAt(x, 0, r, amp, terms) + flame).toBeLessThan(-halfH);
      // 进度 1：火线最低处减去发红的一条也在上边以外，火苗更在上面
      expect(frontAt(x, 1, r, amp, terms) - glow).toBeGreaterThan(halfH);
    }
  });

  it('T-TPL-C066-4 烧穿：b = 0 时没有一格烧穿、也没有一格发光，b = 1 时全部烧穿；发光、烧穿的时刻和阈值一致', () => {
    const rim = 0.06;
    // 阈值 h ∈ [0, 1]：h < P 烧穿，P ≤ h < P + rim 发光
    expect(burnThreshold(0, rim) + rim).toBeLessThanOrEqual(0);
    expect(burnThreshold(1, rim)).toBeGreaterThan(1);
    for (const h of [0, 0.3, 0.99]) {
      const { glowAt, burnAt } = burnProgress(h, rim);
      expect(glowAt).toBeLessThan(burnAt);
      expect(burnThreshold(glowAt, rim) + rim).toBeCloseTo(h, 6);
      expect(burnThreshold(burnAt, rim)).toBeCloseTo(h, 6);
    }
    const v = new Float32Array([3, -1, 5, 1]);
    normalize(v);
    expect(Array.from(v)).toEqual([4 / 6, 0, 1, 2 / 6].map((x) => Math.fround(x)));
  });

  it('T-TPL-C066-5 火星的出生和寿命收进时间窗：最后一帧之前全部熄灭', () => {
    for (const birth of [-1, 0.2, 1.95, 2.5]) {
      const f = fitLife(birth, 0.8, 0.02, 1.98);
      expect(f.birth).toBeGreaterThanOrEqual(0.02);
      expect(f.birth + f.life).toBeLessThanOrEqual(1.98 + 1e-9);
      expect(f.life).toBeGreaterThan(0);
    }
  });
});
