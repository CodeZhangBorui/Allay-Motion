// 091 显像管 allay.builtin.crt-power 的验收测试（docs/template-catalog.md 第 2 节、docs/templates/crt-power.md）。
// 画面本身由 test:engine 的 T-TPL-3、4、5 检查；这里测 manifest 和每个时刻的画面状态（layout.ts）。
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { applyPreset, defaultParams, localizePresetParams, parseManifest, sameValue, sanitizeParams, type ParamDef } from '../../packages/template-sdk/src/index';
import { CORNER_MAX, EDGE_MAX, OFF_HORIZONTAL, OFF_VERTICAL, offState, openMargin, powerOff, powerOn, type CrtOptions } from '../../packages/templates/crt-power/src/layout';

const manifest = (() => {
  const r = parseManifest(JSON.parse(readFileSync(join(import.meta.dirname, '../../packages/templates/crt-power/manifest.json'), 'utf8')));
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
const o: CrtOptions = { halfW: 960, halfH: 540, line: 3, curvature: 1, staticAmount: 0.75, scanlines: 0.35, glow: 0.6 };

describe('T-TPL-C091 显像管', () => {
  it('T-TPL-C091-1 manifest 合法，默认参数清洗后不变；转场、分组 shader、三段时间线；没有贴图参数；默认音效是信标的关、开', () => {
    expect(manifest.id).toBe('allay.builtin.crt-power');
    expect(manifest.category).toBe('transition');
    expect(manifest.tags?.[0]).toBe('shader');
    const d = defaultParams(defs, { locale: 'zh-CN' });
    expect(sanitizeParams(defs, d)).toEqual(d);
    expect(manifest.timeline?.segments.map((s) => s.param)).toEqual(['inDuration', 'hold', 'outDuration']);
    const [i, h, oo] = [range('inDuration'), range('hold'), range('outDuration')];
    expect(i[0] + h[0] + oo[0]).toBeGreaterThanOrEqual(0.1);
    expect(i[1] + h[1] + oo[1]).toBeLessThanOrEqual(30);
    expect(defs.some((p) => p.type === 'texture' || p.type === 'block')).toBe(false);
    expect([d.offSound, d.onSound]).toEqual(['minecraft:block.beacon.deactivate', 'minecraft:block.beacon.activate']);
  });

  it('T-TPL-C091-2 每个自带预设都能载入：值经过清洗后不变', () => {
    expect(manifest.presets?.length).toBeGreaterThanOrEqual(2);
    for (const preset of manifest.presets ?? []) {
      for (const locale of ['zh-CN', 'en']) {
        // 和应用里套用预设走同一条路（applyPreset：按界面语言取出双语的文字，再清洗）
        const applied = applyPreset(defs, preset, { locale });
        for (const [k, v] of Object.entries(localizePresetParams(defs, preset.params, locale))) expect(sameValue(applied[k], v), `${preset.key}.${k} ${locale}`).toBe(true);
      }
    }
  });

  it('T-TPL-C091-3 两端全开（什么都不画）：开口连圆角和软边都在画面外', () => {
    for (const s of [powerOff(0, o), powerOn(1, o)]) {
      expect(s.black).toBe(false);
      expect(s.cover).toBe(0);
      expect(s.staticA).toBe(0);
      expect(s.scanA).toBe(0);
      // 圆角 r 的角点在开口里：(hx − r − halfW)… 换成余量的式子
      const r = s.radius;
      expect(s.hx - o.halfW).toBeGreaterThanOrEqual((1 - Math.SQRT1_2) * r + EDGE_MAX);
      expect(s.hy - o.halfH).toBeGreaterThanOrEqual((1 - Math.SQRT1_2) * r + EDGE_MAX);
    }
    expect(openMargin({ curvature: 1 })).toBeGreaterThanOrEqual((1 - Math.SQRT1_2) * CORNER_MAX + EDGE_MAX);
  });

  it('T-TPL-C091-4 剪辑点前后全黑：关机走完、开机开始前都是关掉的屏幕，开口为 0', () => {
    for (const s of [powerOff(1, o), powerOn(0, o), offState()]) {
      expect(s.black).toBe(true);
      expect(s.hx).toBe(0);
      expect(s.hy).toBe(0);
      expect(s.bright).toBe(0);
    }
  });

  it('T-TPL-C091-5 关机的顺序：先竖直压成一条亮线，再横向收成点；压成线时完全是亮线的颜色', () => {
    const line = powerOff(OFF_VERTICAL[1] + 0.001, o);
    expect(line.hy).toBe(o.line);
    expect(line.cover).toBe(1);
    expect(line.hx).toBeGreaterThan(o.halfW * 0.9);
    const dot = powerOff(OFF_HORIZONTAL[1] + 0.01, o);
    expect(dot.hx).toBeLessThan(o.line * 2);
    expect(dot.hy).toBeLessThan(o.line * 2);
    // 开机：竖直展开之后才有雪花
    expect(powerOn(0.2, o).staticA).toBe(0);
    expect(powerOn(0.5, o).staticA).toBeGreaterThan(0);
  });
});
