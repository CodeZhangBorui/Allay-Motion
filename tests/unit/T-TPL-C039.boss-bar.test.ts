// 039 Boss 栏 allay.builtin.boss-bar 的验收测试（docs/template-catalog.md 第 2 节、docs/templates/boss-bar.md）。
// 画面本身（首末帧透明、同一时刻两次渲染一致、三种画幅）由 test:engine 的 T-TPL-3、4、5 检查；这里测 manifest 和纯函数。
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { overlayWindows, progress } from '../../packages/templates/_lib/src/timing';
import {
  atlasColorRegion,
  atlasNotchRegion,
  BAR_COLORS,
  BAR_H,
  BAR_PITCH,
  BAR_W,
  barLayout,
  filledWidth,
  fitUnit,
  NOTCH_COUNTS,
  PLAIN_COLORS,
  progressAt,
  visibleBars,
} from '../../packages/templates/boss-bar/src/layout';
import { defaultParams, parseManifest, sameValue, sanitizeParams, type ParamValue } from '../../packages/template-sdk/src/index';

const manifest = (() => {
  const r = parseManifest(JSON.parse(readFileSync(join(import.meta.dirname, '../../packages/templates/boss-bar/manifest.json'), 'utf8')));
  if (!r.ok) throw new Error(`manifest invalid: ${JSON.stringify(r)}`);
  return r.manifest;
})();
const defs = manifest.params ?? [];

/** 默认值和预设里出现的音效：都对照过本机游戏文件（26.3 和 1.21.1 的 sounds.json 里有这个事件） */
const ALLOWED_SOUNDS = new Set<ParamValue>([
  null,
  'minecraft:event.raid.horn',
  'minecraft:entity.wither.spawn',
  'minecraft:block.stone.place',
  'minecraft:block.stone.break',
  'minecraft:block.wood.place',
  'minecraft:ui.button.click',
  'minecraft:entity.experience_orb.pickup',
  'minecraft:entity.player.levelup',
  'minecraft:ui.toast.in',
  'minecraft:ui.toast.out',
  'minecraft:ui.toast.challenge_complete',
  'minecraft:entity.generic.explode',
  'allay:whoosh',
]);

describe('T-TPL-C039 Boss 栏', () => {
  it('T-TPL-C039-1 manifest 合法，默认参数能装载，颜色和分段的选项齐全', () => {
    expect(manifest.id).toBe('allay.builtin.boss-bar');
    expect(manifest.category).toBe('overlay');
    expect(manifest.tags?.[0]).toBe('ui');
    for (const locale of ['zh-CN', 'en'] as const) {
      const d = defaultParams(defs, { locale });
      expect(sanitizeParams(defs, d)).toEqual(d);
      expect(d.names).toBe(locale === 'en' ? 'Ender Dragon' : '末影龙');
    }
    const d = defaultParams(defs, { locale: 'zh-CN' });
    expect(manifest.timeline?.segments.map((s) => s.param)).toEqual(['inDuration', 'hold', 'outDuration']);
    expect((d.nameFont as { shadow: boolean }).shadow).toBe(true);
    expect(ALLOWED_SOUNDS.has(d.sound!)).toBe(true);
    const options = (key: string) => {
      const def = defs.find((p) => p.key === key);
      return def?.type === 'enum' ? def.options.map((o) => o.value) : [];
    };
    expect(options('color')).toEqual([...BAR_COLORS]);
    expect(options('notches')).toEqual(['none', ...NOTCH_COUNTS.map(String)]);
  });

  it('T-TPL-C039-2 每个自带预设都能载入：值经过清洗后不变，音效在允许的范围里', () => {
    expect(manifest.presets?.length).toBeGreaterThanOrEqual(3);
    for (const preset of manifest.presets ?? []) {
      const applied = sanitizeParams(defs, { ...defaultParams(defs), ...preset.params });
      for (const [k, v] of Object.entries(preset.params)) expect(sameValue(applied[k], v as ParamValue), `${preset.key}.${k}`).toBe(true);
      const total = (applied.inDuration as number) + (applied.hold as number) + (applied.outDuration as number);
      expect(total).toBeGreaterThanOrEqual(0.1);
      expect(total).toBeLessThanOrEqual(30);
      expect(ALLOWED_SOUNDS.has(applied.sound!), `${preset.key}.sound`).toBe(true);
      // 进度的变化在停留阶段里做完
      expect((applied.changeAt as number) + (applied.changeDuration as number)).toBeLessThanOrEqual(applied.hold as number);
    }
  });

  it('T-TPL-C039-3 版式：栏 182 × 5，第一条上边在 12，名字在栏上方 9，多条间距 19', () => {
    expect([BAR_W, BAR_H, BAR_PITCH]).toEqual([182, 5, 19]);
    // 1080p、界面缩放 5：界面 384 × 216
    const l = barLayout(384, 4);
    expect(l.x).toBe(192 - 91);
    expect(l.centerX).toBe(192);
    expect(l.barTops).toEqual([12, 31, 50, 69]);
    expect(l.nameTops).toEqual([3, 22, 41, 60]);
    // 界面宽度为奇数时中心按整数除法
    expect(barLayout(385, 1).x).toBe(192 - 91);
    // 名字（一行 8 高）和上一条栏不重叠
    expect(l.barTops[0]! + BAR_H).toBeLessThanOrEqual(l.nameTops[1]!);
  });

  it('T-TPL-C039-4 条数：往下挪到界面高度三分之一就不再画；三种画幅都放得下', () => {
    // 216 高：三分之一是 72，四条的上边 12、31、50、69 都画
    expect(visibleBars(216, 4)).toBe(4);
    // 1080p、界面缩放 8：高 135，三分之一是 45，画完第二条（31）后挪到 50，停
    expect(visibleBars(135, 4)).toBe(2);
    expect(visibleBars(135, 1)).toBe(1);
    // 再矮也画第一条；最多 4 条
    expect(visibleBars(30, 3)).toBe(1);
    expect(visibleBars(1000, 9)).toBe(4);
    // 9:16 和 1:1（宽 1080）在界面缩放 5 时宽 216，放得下 182，不缩小
    expect(fitUnit(1080, 5)).toBe(5);
    expect(fitUnit(1920, 5)).toBe(5);
    // 界面缩放 8 时宽 135 放不下：缩到栏两侧各留 4 个界面像素
    expect(fitUnit(1080, 8)).toBeCloseTo(1080 / 190);
    expect(1080 / fitUnit(1080, 8)).toBeGreaterThanOrEqual(BAR_W + 8);
  });

  it('T-TPL-C039-5 进度露出的像素数：0 不画，大于 0 至少 1，满是 182，中间单调', () => {
    expect(filledWidth(0)).toBe(0);
    expect(filledWidth(0.001)).toBe(1);
    expect(filledWidth(0.5)).toBe(91);
    expect(filledWidth(1)).toBe(182);
    expect(filledWidth(2)).toBe(182);
    expect(filledWidth(-1)).toBe(0);
    expect(filledWidth(Number.NaN)).toBe(0);
    let prev = 0;
    for (let i = 0; i <= 1000; i++) {
      const w = filledWidth(i / 1000);
      expect(w).toBeGreaterThanOrEqual(prev);
      expect(w - prev).toBeLessThanOrEqual(1);
      prev = w;
    }
  });

  it('T-TPL-C039-6 旧图集 gui/bars 的位置（对照过 1.19.2 的图集）和没有贴图时的纯色', () => {
    expect(atlasColorRegion('pink', 'background')).toEqual([0, 0, 182, 5]);
    expect(atlasColorRegion('pink', 'progress')).toEqual([0, 5, 182, 5]);
    expect(atlasColorRegion('white', 'background')).toEqual([0, 60, 182, 5]);
    expect(atlasColorRegion('purple', 'progress', 40)).toEqual([0, 55, 40, 5]);
    expect(NOTCH_COUNTS.map((n) => atlasNotchRegion(n, 'background')?.[1])).toEqual([80, 90, 100, 110]);
    expect(NOTCH_COUNTS.map((n) => atlasNotchRegion(n, 'progress')?.[1])).toEqual([85, 95, 105, 115]);
    expect(atlasNotchRegion(0, 'background')).toBeNull();
    for (const c of BAR_COLORS) {
      expect(PLAIN_COLORS[c].fill).toMatch(/^#[0-9A-F]{6}$/);
      expect(PLAIN_COLORS[c].track).toMatch(/^#[0-9A-F]{6}$/);
    }
  });

  it('T-TPL-C039-7 进度随时间：变化开始前是起始值，之后匀速走到结束值', () => {
    expect(progressAt(-1, 1, 0.35, 1, 1)).toBe(1);
    expect(progressAt(1, 1, 0.35, 1, 1)).toBe(1);
    expect(progressAt(1.5, 1, 0.35, 1, 1)).toBeCloseTo(0.675);
    expect(progressAt(2, 1, 0.35, 1, 1)).toBe(0.35);
    expect(progressAt(9, 1, 0.35, 1, 1)).toBe(0.35);
    // 时长为 0 时直接跳到结束值
    expect(progressAt(0.5, 0, 1, 0.5, 0)).toBe(0);
    expect(progressAt(0.51, 0, 1, 0.5, 0)).toBe(1);
    // 往上涨也一样
    expect(progressAt(1, 0, 1, 0, 4)).toBeCloseTo(0.25);
  });

  it('T-TPL-C039-8 整体不透明度：首末各一帧为 0，停留阶段为 1', () => {
    const w = overlayWindows(60, 0.25, 4, 0.25);
    const a = (t: number) => progress(t, w.in) * (1 - progress(t, w.out));
    expect(w.duration).toBeCloseTo(4.5);
    expect(a(0)).toBe(0);
    expect(a(1 / 60)).toBe(0);
    expect(a(w.duration - 1 / 60)).toBe(0);
    expect(a(w.duration)).toBe(0);
    expect(a(0.25)).toBe(1);
    expect(a(2)).toBe(1);
    expect(a(0.13)).toBeGreaterThan(0);
    expect(a(0.13)).toBeLessThan(1);
  });
});
