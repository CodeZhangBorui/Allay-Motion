// 060 昼夜流转 allay.builtin.sky-timelapse 的验收测试（docs/template-catalog.md 第 2 节、docs/templates/sky-timelapse.md）。
// 画面本身由 test:engine 的 T-TPL-3、4、5 检查；这里测 manifest 和纯函数（时刻 → 天体角度、天空亮度、星星、霞光、轨道）。
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { applyPreset, defaultParams, localizePresetParams, parseManifest, sameValue, sanitizeParams, type ParamDef } from '../../packages/template-sdk/src/index';
import { celestialAngle, DAY, MOON_PHASES, moonPhaseRect, orbit, skyBrightness, starBrightness, sunriseGlow, timeSpan } from '../../packages/templates/sky-timelapse/src/layout';

const manifest = (() => {
  const r = parseManifest(JSON.parse(readFileSync(join(import.meta.dirname, '../../packages/templates/sky-timelapse/manifest.json'), 'utf8')));
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

describe('T-TPL-C060 昼夜流转', () => {
  it('T-TPL-C060-1 manifest 合法，默认参数清洗后不变；转场、分组 particles、三段时间线；文字配 font 参数（普通模式、带阴影），平原的天空色', () => {
    expect(manifest.id).toBe('allay.builtin.sky-timelapse');
    expect(manifest.category).toBe('transition');
    expect(manifest.tags?.[0]).toBe('particles');
    const d = defaultParams(defs, { locale: 'zh-CN' });
    expect(sanitizeParams(defs, d)).toEqual(d);
    expect(manifest.timeline?.segments.map((s) => s.param)).toEqual(['inDuration', 'hold', 'outDuration']);
    const [i, h, o] = [range('inDuration'), range('hold'), range('outDuration')];
    expect(i[0] + h[0] + o[0]).toBeGreaterThanOrEqual(0.1);
    expect(i[1] + h[1] + o[1]).toBeLessThanOrEqual(30);
    expect(d.label).toBe('第 2 天');
    expect(defaultParams(defs, { locale: 'en' }).label).toBe('Day 2');
    expect(d.labelFont).toMatchObject({ family: 'embedded:default', shadow: true });
    // 平原的天空色和雾色（对照过游戏文件 data/minecraft/worldgen/biome/plains.json）
    expect([d.skyColor, d.fogColor]).toEqual(['#78A7FF', '#C0D8FF']);
    for (const p of defs) if (p.type === 'sound' && p.default !== null) expect(p.default).toMatch(/^minecraft:[a-z0-9_.]+$/);
  });

  it('T-TPL-C060-2 每个自带预设都能载入：值经过清洗后不变；有“强制 Unicode 字体”；预设里的文字是双语的', () => {
    expect(manifest.presets?.length).toBeGreaterThanOrEqual(2);
    for (const preset of manifest.presets ?? []) {
      for (const locale of ['zh-CN', 'en']) {
        // 和应用里套用预设走同一条路（applyPreset：按界面语言取出双语的文字，再清洗）
        const applied = applyPreset(defs, preset, { locale });
        for (const [k, v] of Object.entries(localizePresetParams(defs, preset.params, locale))) expect(sameValue(applied[k], v), `${preset.key}.${k} ${locale}`).toBe(true);
      }
    }
    const uni = manifest.presets!.find((p) => p.key === 'force-unicode')!;
    expect((uni.params.labelFont as { family: string }).family).toBe('embedded:uniform');
    // 带文字的预设写成双语：中文界面“第 2 天”，英文界面“Day 2”
    const day = manifest.presets!.find((p) => p.key === 'full-day')!;
    expect(applyPreset(defs, day, { locale: 'zh-CN' }).label).toBe('第 2 天');
    expect(applyPreset(defs, day, { locale: 'en' }).label).toBe('Day 2');
  });

  it('T-TPL-C060-3 时刻：正午在头顶（角度 0）、午夜在脚下（0.5）；不大于开始时刻的结束时刻算到第二天', () => {
    expect(celestialAngle(6000)).toBeCloseTo(0, 9);
    expect(celestialAngle(18000)).toBeCloseTo(0.5, 9);
    // 日出（0 刻）太阳刚过地平线一点，日落（12000）刚要落下
    expect(celestialAngle(0)).toBeGreaterThan(0.75);
    expect(celestialAngle(12000)).toBeLessThan(0.25);
    expect(timeSpan(11000, 1000)).toEqual({ from: 11000, to: 25000 });
    expect(timeSpan(0, 0)).toEqual({ from: 0, to: DAY });
    expect(timeSpan(2000, 9000)).toEqual({ from: 2000, to: 9000 });
  });

  it('T-TPL-C060-4 天空亮度、星星、霞光：正午最亮没有星星，午夜全黑、星星最亮 0.5；霞光只在日出日落前后', () => {
    expect(skyBrightness(celestialAngle(6000))).toBe(1);
    expect(skyBrightness(celestialAngle(18000))).toBe(0);
    expect(starBrightness(celestialAngle(6000))).toBe(0);
    expect(starBrightness(celestialAngle(18000))).toBeCloseTo(0.5, 9);
    expect(sunriseGlow(celestialAngle(6000))).toBeNull();
    expect(sunriseGlow(celestialAngle(18000))).toBeNull();
    const dusk = sunriseGlow(celestialAngle(12500));
    expect(dusk).not.toBeNull();
    expect(dusk!.a).toBeGreaterThan(0.3);
    expect(dusk!.r).toBeGreaterThan(dusk!.b);
  });

  it('T-TPL-C060-5 轨道：角度 0 在正上方，0.25 落在右边的地平线；月相的旧图集是 4 × 2', () => {
    const top = orbit(0, 400, 900);
    expect(top.x).toBeCloseTo(0, 9);
    expect(top.y).toBeCloseTo(900, 9);
    const set = orbit(0.25, 400, 900);
    expect(set.x).toBeCloseTo(400, 9);
    expect(set.y).toBeCloseTo(0, 6);
    expect(MOON_PHASES).toHaveLength(8);
    expect(moonPhaseRect(0)).toEqual({ u0: 0, u1: 0.25, v0: 0.5, v1: 1 });
    expect(moonPhaseRect(4)).toEqual({ u0: 0, u1: 0.25, v0: 0, v1: 0.5 });
    expect(moonPhaseRect(7)).toEqual({ u0: 0.75, u1: 1, v0: 0, v1: 0.5 });
  });

  it('T-TPL-C060-6 和游戏数据对得上：1.21.11 起一天的变化写在 data/minecraft/timeline/day.json，几个关键帧和式子一致', () => {
    // 天空颜色的乘数：133、11867 刻是白（1），13670、22330 刻是黑（0），中间线性
    expect(skyBrightness(celestialAngle(11867))).toBeCloseTo(1, 2);
    expect(skyBrightness(celestialAngle(13670))).toBeCloseTo(0, 2);
    expect(skyBrightness(celestialAngle(133))).toBe(1);
    expect(skyBrightness(celestialAngle(22330))).toBe(0);
    // 星星亮度的关键帧
    for (const [tick, v] of [[92, 0.037], [11732, 0.016], [12399, 0.143], [12729, 0.258], [13228, 0.5], [23032, 0.364]] as const) {
      expect(starBrightness(celestialAngle(tick)), `${tick}`).toBeCloseTo(v, 2);
    }
    // 霞光（sunrise_sunset_color，#AARRGGBB）：12732 刻是 #feda6333，11929 刻是 #5fefa333
    for (const [tick, hex] of [[12732, 'feda6333'], [11929, '5fefa333'], [13252, 'c1cc4733']] as const) {
      const g = sunriseGlow(celestialAngle(tick))!;
      const [a, r, gg, b] = [0, 2, 4, 6].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
      expect(Math.abs(g.a - a!), `${tick} a`).toBeLessThan(1.5 / 255);
      expect(Math.abs(g.r - r!), `${tick} r`).toBeLessThan(1.5 / 255);
      expect(Math.abs(g.g - gg!), `${tick} g`).toBeLessThan(1.5 / 255);
      expect(Math.abs(g.b - b!), `${tick} b`).toBeLessThan(1.5 / 255);
    }
    // 月相的顺序（timeline/moon.json 每 24000 刻换一相）
    expect(MOON_PHASES).toEqual(['full_moon', 'waning_gibbous', 'third_quarter', 'waning_crescent', 'new_moon', 'waxing_crescent', 'first_quarter', 'waxing_gibbous']);
  });
});
