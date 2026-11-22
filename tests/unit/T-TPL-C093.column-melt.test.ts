// 093 逐列融化 allay.builtin.column-melt 的验收测试（docs/template-catalog.md 第 2 节、docs/templates/column-melt.md）。
// 画面本身由 test:engine 的 T-TPL-3、4、5 检查；这里测 manifest 和纯函数（各列的先后、前沿后沿走过的范围）。
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { defaultParams, parseManifest, sameValue, sanitizeParams, type ParamDef, type ParamValue } from '../../packages/template-sdk/src/index';
import { columnDelays, columnProgress, DIRECTIONS, travel, travelRange } from '../../packages/templates/column-melt/src/layout';

const manifest = (() => {
  const r = parseManifest(JSON.parse(readFileSync(join(import.meta.dirname, '../../packages/templates/column-melt/manifest.json'), 'utf8')));
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
function prng(seed: number) {
  let a = seed >>> 0;
  return {
    next() {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    },
  };
}

describe('T-TPL-C093 逐列融化', () => {
  it('T-TPL-C093-1 manifest 合法，默认参数清洗后不变；转场、分组 shader、三段时间线；不用贴图；方向用图案小格', () => {
    expect(manifest.id).toBe('allay.builtin.column-melt');
    expect(manifest.category).toBe('transition');
    expect(manifest.tags?.[0]).toBe('shader');
    const d = defaultParams(defs, { locale: 'zh-CN' });
    expect(sanitizeParams(defs, d)).toEqual(d);
    expect(manifest.timeline?.segments.map((s) => s.param)).toEqual(['inDuration', 'hold', 'outDuration']);
    const [i, h, o] = [range('inDuration'), range('hold'), range('outDuration')];
    expect(i[0] + h[0] + o[0]).toBeGreaterThanOrEqual(0.1);
    expect(i[1] + h[1] + o[1]).toBeLessThanOrEqual(30);
    expect(defs.some((p) => p.type === 'texture' || p.type === 'block')).toBe(false);
    const dir = def('direction');
    expect(dir.type === 'enum' && dir.ui === 'pattern').toBe(true);
    expect(dir.type === 'enum' ? dir.options.map((x) => x.value).sort() : []).toEqual([...DIRECTIONS].sort());
    for (const p of defs) if (p.type === 'sound' && p.default !== null) expect(p.default).toMatch(/^minecraft:[a-z0-9_.]+$/);
  });

  it('T-TPL-C093-2 每个自带预设都能载入：值经过清洗后不变', () => {
    expect(manifest.presets?.length).toBeGreaterThanOrEqual(2);
    for (const preset of manifest.presets ?? []) {
      const applied = sanitizeParams(defs, { ...defaultParams(defs), ...preset.params });
      for (const [k, v] of Object.entries(preset.params)) expect(sameValue(applied[k], v as ParamValue), `${preset.key}.${k}`).toBe(true);
    }
  });

  it('T-TPL-C093-3 各列的先后：正好铺满 [0, variance]，相邻的列差得不多', () => {
    for (const v of [0.2, 0.45, 0.9]) {
      const d = columnDelays(40, v, prng(9));
      expect(Math.min(...d)).toBe(0);
      expect(Math.max(...d)).toBeCloseTo(v, 9);
      for (let i = 1; i < d.length; i++) expect(Math.abs(d[i]! - d[i - 1]!)).toBeLessThanOrEqual(v);
    }
    expect(Array.from(columnDelays(5, 0, prng(1)))).toEqual([0, 0, 0, 0, 0]);
  });

  it('T-TPL-C093-4 每列的进度：阶段开始时 0、结束时所有列一起到 1；前沿从画外出发，走完时连末端的形状也出了画面', () => {
    for (const d of [0, 0.3, 0.9]) {
      expect(columnProgress(0, d)).toBe(0);
      expect(columnProgress(1, d)).toBe(1);
      expect(columnProgress(d, d)).toBe(0);
    }
    const [length, drip, pad] = [1080, 30, 6];
    const r = travelRange(length, drip, pad);
    // 前沿：列中心的尖端在 travel 处，两侧往回 drip
    expect(travel(0, r.leadFrom, r.to)).toBeLessThan(0);
    expect(travel(1, r.leadFrom, r.to) - drip).toBeGreaterThan(length);
    // 后沿：两侧往前 drip，出发时也在画外
    expect(travel(0, r.tailFrom, r.to) + drip).toBeLessThan(0);
    expect(travel(1, r.tailFrom, r.to)).toBeGreaterThan(length);
  });
});
