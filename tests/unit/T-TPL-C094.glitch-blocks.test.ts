// 094 故障色块 allay.builtin.glitch-blocks 的验收测试（docs/template-catalog.md 第 2 节、docs/templates/glitch-blocks.md）。
// 画面本身由 test:engine 的 T-TPL-3、4、5 检查；这里测 manifest 和纯函数（覆盖率的走法、每一步的抖动）。
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { defaultParams, parseManifest, sameValue, sanitizeParams, type ParamDef, type ParamValue } from '../../packages/template-sdk/src/index';
import { burstAt, coverIn, coverOut, jittered, stepJitter } from '../../packages/templates/glitch-blocks/src/layout';

const manifest = (() => {
  const r = parseManifest(JSON.parse(readFileSync(join(import.meta.dirname, '../../packages/templates/glitch-blocks/manifest.json'), 'utf8')));
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

describe('T-TPL-C094 故障色块', () => {
  it('T-TPL-C094-1 manifest 合法，默认参数清洗后不变；转场、分组 shader、三段时间线；不用贴图；阵数最多 6（音效最多 12 个）', () => {
    expect(manifest.id).toBe('allay.builtin.glitch-blocks');
    expect(manifest.category).toBe('transition');
    expect(manifest.tags?.[0]).toBe('shader');
    const d = defaultParams(defs, { locale: 'zh-CN' });
    expect(sanitizeParams(defs, d)).toEqual(d);
    expect(manifest.timeline?.segments.map((s) => s.param)).toEqual(['inDuration', 'hold', 'outDuration']);
    const [i, h, o] = [range('inDuration'), range('hold'), range('outDuration')];
    expect(i[0] + h[0] + o[0]).toBeGreaterThanOrEqual(0.1);
    expect(i[1] + h[1] + o[1]).toBeLessThanOrEqual(30);
    expect(defs.some((p) => p.type === 'texture' || p.type === 'block')).toBe(false);
    const bursts = def('bursts');
    expect(bursts.type === 'integer' ? bursts.max * 2 : 99).toBeLessThanOrEqual(12);
    expect(d.sound).toBe('minecraft:block.note_block.bit');
  });

  it('T-TPL-C094-2 每个自带预设都能载入：值经过清洗后不变', () => {
    expect(manifest.presets?.length).toBeGreaterThanOrEqual(2);
    for (const preset of manifest.presets ?? []) {
      const applied = sanitizeParams(defs, { ...defaultParams(defs), ...preset.params });
      for (const [k, v] of Object.entries(preset.params)) expect(sameValue(applied[k], v as ParamValue), `${preset.key}.${k}`).toBe(true);
    }
  });

  it('T-TPL-C094-3 覆盖率：进入 0 → 1、退出 1 → 0，两端精确，中间在 [0, 1] 里；每一阵是一个猛地多出来的峰', () => {
    for (const n of [1, 4, 6]) {
      expect(coverIn(0, n)).toBe(0);
      expect(coverIn(1, n)).toBe(1);
      expect(coverOut(0, n)).toBe(1);
      expect(coverOut(1, n)).toBe(0);
      for (let p = 0; p <= 1; p += 0.01) {
        expect(coverIn(p, n)).toBeGreaterThanOrEqual(0);
        expect(coverIn(p, n)).toBeLessThanOrEqual(1);
      }
      for (let k = 0; k < n; k++) {
        const b = burstAt(k, n);
        // 阵到的那一刻比它前一点高出一截
        if (coverIn(b, n) < 1) expect(coverIn(b, n) - coverIn(b - 0.01, n)).toBeGreaterThan(0.05);
      }
    }
  });

  it('T-TPL-C094-4 每一步的抖动：同一步同一种子结果相同，在 [0, 1) 里；两端不抖', () => {
    for (let s = 0; s < 200; s++) {
      const j = stepJitter(s, 7);
      expect(j).toBeGreaterThanOrEqual(0);
      expect(j).toBeLessThan(1);
      expect(stepJitter(s, 7)).toBe(j);
    }
    expect(new Set(Array.from({ length: 50 }, (_, s) => stepJitter(s, 7))).size).toBeGreaterThan(40);
    expect(jittered(0, 0.9)).toBe(0);
    expect(jittered(1, 0.1)).toBe(1);
    expect(jittered(0.5, 0)).toBeCloseTo(0.4, 9);
  });
});
