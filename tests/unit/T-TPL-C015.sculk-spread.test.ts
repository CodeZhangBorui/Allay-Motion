// 015 幽匿蔓延 allay.builtin.sculk-spread 的验收测试（docs/template-catalog.md 第 2 节、docs/templates/sculk-spread.md）。
// 画面本身由 test:engine 的 T-TPL-3、4、5 检查；这里测 manifest 和纯函数（蔓延的先后、阈值的映射）。
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { applyPreset, defaultParams, localizePresetParams, parseManifest, sameValue, sanitizeParams, type ParamDef } from '../../packages/template-sdk/src/index';
import { convertAt, EPS, LINGER, recedeAt, recedeThreshold, seedCells, spreadThreshold, spreadTimes } from '../../packages/templates/sculk-spread/src/layout';

const manifest = (() => {
  const r = parseManifest(JSON.parse(readFileSync(join(import.meta.dirname, '../../packages/templates/sculk-spread/manifest.json'), 'utf8')));
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

describe('T-TPL-C015 幽匿蔓延', () => {
  it('T-TPL-C015-1 manifest 合法，默认参数清洗后不变；转场、分组 blocks、三段时间线；绽放音效默认空（几百 KB），其余默认音效带命名空间', () => {
    expect(manifest.id).toBe('allay.builtin.sculk-spread');
    expect(manifest.category).toBe('transition');
    expect(manifest.tags?.[0]).toBe('blocks');
    const d = defaultParams(defs, { locale: 'zh-CN' });
    expect(sanitizeParams(defs, d)).toEqual(d);
    expect(manifest.timeline?.segments.map((s) => s.param)).toEqual(['inDuration', 'hold', 'outDuration']);
    const [i, h, o] = [range('inDuration'), range('hold'), range('outDuration')];
    expect(i[0] + h[0] + o[0]).toBeGreaterThanOrEqual(0.1);
    expect(i[1] + h[1] + o[1]).toBeLessThanOrEqual(30);
    expect(d.spreadSound).toBe('minecraft:block.sculk.spread');
    expect(d.bloomSound).toBeNull();
    for (const p of defs) if (p.type === 'sound' && p.default !== null) expect(p.default).toMatch(/^minecraft:[a-z0-9_.]+$/);
  });

  it('T-TPL-C015-2 每个自带预设都能载入：值经过清洗后不变', () => {
    expect(manifest.presets?.length).toBeGreaterThanOrEqual(2);
    for (const preset of manifest.presets ?? []) {
      for (const locale of ['zh-CN', 'en']) {
        // 和应用里套用预设走同一条路（applyPreset：按界面语言取出双语的文字，再清洗）
        const applied = applyPreset(defs, preset, { locale });
        for (const [k, v] of Object.entries(localizePresetParams(defs, preset.params, locale))) expect(sameValue(applied[k], v), `${preset.key}.${k} ${locale}`).toBe(true);
      }
    }
  });

  it('T-TPL-C015-3 蔓延的先后：起点为 0、最晚的为 1，每一格都连得到；相邻两格差不超过一条最长的边（成片长，不跳格）', () => {
    const cols = 16;
    const rows = 9;
    const seeds = [3 * cols + 4, 6 * cols + 12];
    const { times, unit } = spreadTimes(cols, rows, seeds, prng(5));
    for (const s of seeds) expect(times[s]).toBe(0);
    expect(Math.max(...times)).toBeCloseTo(1, 6);
    for (const v of times) {
      expect(Number.isFinite(v)).toBe(true);
      expect(v).toBeGreaterThanOrEqual(0);
    }
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x + 1 < cols; x++) expect(Math.abs(times[y * cols + x]! - times[y * cols + x + 1]!)).toBeLessThanOrEqual(1.65 * unit + 1e-6);
    }
    // 同一个种子同样的结果
    expect(spreadTimes(cols, rows, seeds, prng(5)).times).toEqual(times);
  });

  it('T-TPL-C015-4 阈值：进入 0 时一格都没有、1 时全是幽匿；退出 0 时一格没退、1 时全退完、留着的脉络也没了', () => {
    // 格子 s ∈ [0, 1]：s < A 时是幽匿；脉络要有已经变了的邻格（s邻 < A）
    expect(spreadThreshold(0)).toBeLessThan(0);
    expect(spreadThreshold(1)).toBeGreaterThan(1);
    // 退出：1 − s < B 时退去，退了以后 B − (1 − s) < LINGER 的还留脉络
    expect(recedeThreshold(0)).toBeLessThan(0);
    expect(recedeThreshold(1) - 1).toBeGreaterThanOrEqual(LINGER);
    expect(recedeThreshold(1) - LINGER).toBeGreaterThan(1);
    // 变成幽匿、退去的时刻在 [0, 1] 里，和阈值的映射互为反函数
    for (const s of [0, 0.25, 0.5, 1]) {
      const a = convertAt(s);
      expect(spreadThreshold(a)).toBeCloseTo(s, 9);
      const b = recedeAt(s);
      expect(recedeThreshold(b)).toBeCloseTo(1 - s, 9);
    }
    expect(EPS).toBeGreaterThan(0);
  });

  it('T-TPL-C015-5 起点：一个时在正中；多个时铺得开（两两离得远，左右两半都有），不在最外一圈', () => {
    const [cols, rows] = [16, 9];
    expect(seedCells(cols, rows, 1, prng(1))).toEqual([4 * cols + 8]);
    for (let seed = 1; seed <= 20; seed++) {
      const cells = seedCells(cols, rows, 3, prng(seed));
      expect(cells).toHaveLength(3);
      const xy = cells.map((k) => [k % cols, Math.floor(k / cols)] as const);
      for (const [x, y] of xy) {
        expect(x).toBeGreaterThanOrEqual(1);
        expect(x).toBeLessThanOrEqual(cols - 2);
        expect(y).toBeGreaterThanOrEqual(1);
        expect(y).toBeLessThanOrEqual(rows - 2);
      }
      let closest = Infinity;
      for (let i = 0; i < 3; i++) for (let j = i + 1; j < 3; j++) closest = Math.min(closest, Math.hypot(xy[i]![0] - xy[j]![0], xy[i]![1] - xy[j]![1]));
      expect(closest, `seed ${seed}`).toBeGreaterThanOrEqual(4);
      expect(xy.some(([x]) => x < cols / 2) && xy.some(([x]) => x >= cols / 2), `seed ${seed}`).toBe(true);
    }
    // 起点多到格子不够分时也不卡住
    expect(seedCells(3, 3, 8, prng(2))).toHaveLength(8);
  });
});
