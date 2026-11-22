// 092 图形光圈 allay.builtin.mask-iris 的验收测试（docs/template-catalog.md 第 2 节、docs/templates/mask-iris.md）。
// 画面本身由 test:engine 的 T-TPL-3、4、5 检查；这里测 manifest 和纯函数（遮罩的几何、光圈大小的曲线）。
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { defaultParams, parseManifest, sameValue, sanitizeParams, type ParamDef, type ParamValue } from '../../packages/template-sdk/src/index';
import { fillAlpha, GEOMETRY, irisScale, MASKS, startScale } from '../../packages/templates/mask-iris/src/layout';

const manifest = (() => {
  const r = parseManifest(JSON.parse(readFileSync(join(import.meta.dirname, '../../packages/templates/mask-iris/manifest.json'), 'utf8')));
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

describe('T-TPL-C092 图形光圈', () => {
  it('T-TPL-C092-1 manifest 合法，默认参数清洗后不变；转场、分组 shader、三段时间线；图形的选项和代码一致', () => {
    expect(manifest.id).toBe('allay.builtin.mask-iris');
    expect(manifest.category).toBe('transition');
    expect(manifest.tags?.[0]).toBe('shader');
    const d = defaultParams(defs, { locale: 'zh-CN' });
    expect(sanitizeParams(defs, d)).toEqual(d);
    expect(manifest.timeline?.segments.map((s) => s.param)).toEqual(['inDuration', 'hold', 'outDuration']);
    const [i, h, o] = [range('inDuration'), range('hold'), range('outDuration')];
    expect(i[0] + h[0] + o[0]).toBeGreaterThanOrEqual(0.1);
    expect(i[1] + h[1] + o[1]).toBeLessThanOrEqual(30);
    const mask = def('mask');
    expect(mask.type === 'enum' ? mask.options.map((x) => x.value) : []).toEqual([...MASKS]);
    for (const p of defs) if (p.type === 'sound' && p.default !== null) expect(p.default).toMatch(/^minecraft:[a-z0-9_.]+$/);
  });

  it('T-TPL-C092-2 每个自带预设都能载入：值经过清洗后不变；有目录 1.9 的望远镜、苦力怕、头颅、花', () => {
    const keys = (manifest.presets ?? []).map((p) => p.key);
    expect(keys).toEqual(expect.arrayContaining(['spyglass', 'creeper', 'skull', 'flower']));
    for (const preset of manifest.presets ?? []) {
      const applied = sanitizeParams(defs, { ...defaultParams(defs), ...preset.params });
      for (const [k, v] of Object.entries(preset.params)) expect(sameValue(applied[k], v as ParamValue), `${preset.key}.${k}`).toBe(true);
    }
  });

  it('T-TPL-C092-3 遮罩的几何：旗帜图案的缩放中心和透空的范围都在正面 (1, 1)–(21, 41) 里；望远镜的镜片在边框里', () => {
    for (const kind of ['creeper', 'skull', 'flower', 'globe'] as const) {
      const g = GEOMETRY[kind];
      expect(g.anchor[0] - g.inner[0]).toBeGreaterThanOrEqual(1);
      expect(g.anchor[0] + g.inner[0]).toBeLessThanOrEqual(21);
      expect(g.anchor[1] - g.inner[1]).toBeGreaterThanOrEqual(1);
      expect(g.anchor[1] + g.inner[1]).toBeLessThanOrEqual(41);
    }
    // 望远镜：256 像素的方框，边框 16 像素（对照过游戏文件）
    expect(GEOMETRY.spyglass.anchor).toEqual([128, 128]);
    expect(GEOMETRY.spyglass.inner).toEqual([112, 112]);
  });

  it('T-TPL-C092-4 起始大小：中心附近透空的矩形把整个画面装下（光圈中心偏到一边也装得下）', () => {
    for (const [hw, hh] of [
      [960, 540],
      [540, 960],
      [540, 540],
    ] as const) {
      for (const [cx, cy] of [
        [0, 0],
        [0.4 * hw * 2, -0.3 * hh * 2],
      ] as const) {
        for (const kind of MASKS) {
          const s = startScale(kind, hw, hh, cx, cy, 4);
          if (kind === 'circle') {
            expect(s).toBeGreaterThanOrEqual(Math.hypot(hw + Math.abs(cx), hh + Math.abs(cy)));
          } else {
            const g = GEOMETRY[kind];
            expect(g.inner[0] * s).toBeGreaterThanOrEqual(hw + Math.abs(cx));
            expect(g.inner[1] * s).toBeGreaterThanOrEqual(hh + Math.abs(cy));
          }
        }
      }
    }
  });

  it('T-TPL-C092-5 光圈大小：0 时最大、1 时为 0，一路不变大；有停顿时中间停在 sl', () => {
    const curve = { s0: 1200, sl: 160, lingerTime: 0.25 };
    expect(irisScale(0, curve)).toBe(1200);
    expect(irisScale(1, curve)).toBe(0);
    let last = Infinity;
    for (let p = 0; p <= 1; p += 0.01) {
      const s = irisScale(p, curve);
      expect(s).toBeLessThanOrEqual(last + 1e-9);
      last = s;
    }
    // 停顿占 0.25：停在 [0.375, 0.625]
    for (const p of [0.4, 0.5, 0.6]) expect(irisScale(p, curve)).toBe(160);
    // 不停：两段各占一半，正中间正好经过 sl，前后都不停
    const straight = { ...curve, lingerTime: 0 };
    expect(irisScale(0.4, straight)).toBeGreaterThan(160);
    expect(irisScale(0.5, straight)).toBeCloseTo(160, 9);
    expect(irisScale(0.6, straight)).toBeLessThan(160);
    expect(fillAlpha(0)).toBe(0);
    expect(fillAlpha(0.12)).toBe(1);
  });
});
