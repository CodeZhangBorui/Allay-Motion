// 055 声音字幕 allay.builtin.sound-subtitles 的验收测试（docs/template-catalog.md 第 2 节、docs/templates/sound-subtitles.md）。
// 画面本身（首末帧透明、同一时刻两次渲染一致、三种画幅）由 test:engine 的 T-TPL-3、4、5 检查；这里测 manifest 和纯函数。
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { overlayWindows, progress } from '../../packages/templates/_lib/src/timing';
import { fitUnit, GRAY_STEPS, grayAt, grayHex, halfWidth, MAX_LINES, parseCaption, rowRect, sampleCues, stepAt, stepGray, visibleAt } from '../../packages/templates/sound-subtitles/src/layout';
import { defaultParams, parseManifest, sameValue, sanitizeParams, type ParamValue } from '../../packages/template-sdk/src/index';

const manifest = (() => {
  const r = parseManifest(JSON.parse(readFileSync(join(import.meta.dirname, '../../packages/templates/sound-subtitles/manifest.json'), 'utf8')));
  if (!r.ok) throw new Error(`manifest invalid: ${JSON.stringify(r)}`);
  return r.manifest;
})();
const defs = manifest.params ?? [];

describe('T-TPL-C055 声音字幕', () => {
  it('T-TPL-C055-1 manifest 合法，默认参数清洗后不变，默认值是游戏的数值', () => {
    expect(manifest.id).toBe('allay.builtin.sound-subtitles');
    expect(manifest.category).toBe('overlay');
    expect(manifest.tags?.[0]).toBe('ui');
    for (const locale of ['zh-CN', 'en'] as const) {
      const d = defaultParams(defs, { locale });
      expect(sanitizeParams(defs, d)).toEqual(d);
      const captions = (d.lines as string).split('\n').map(parseCaption);
      expect(captions.length).toBe(5);
      expect(captions.map((c) => c.direction)).toEqual(['left', 'front', 'right', 'left', 'front']);
    }
    const d = defaultParams(defs, { locale: 'zh-CN' });
    expect(manifest.timeline?.segments.map((s) => s.param)).toEqual(['inDuration', 'hold', 'outDuration']);
    expect(d.lifetime).toBe(3);
    expect(d.bgOpacity).toBe(0.8);
    expect(d.side).toBe('right');
    expect((d.font as { shadow: boolean }).shadow).toBe(false);
    expect(d.sound).toBeNull();
    // 默认参数下退出阶段还有字幕在（退出阶段的画面才会逐帧变化）
    const total = (d.inDuration as number) + (d.hold as number) + (d.outDuration as number);
    expect(visibleAt(total - 0.01, 5, d.interval as number, d.lifetime as number).length).toBeGreaterThan(0);
  });

  it('T-TPL-C055-2 每个自带预设都能载入：值经过清洗后不变', () => {
    expect(manifest.presets?.length).toBeGreaterThanOrEqual(3);
    for (const preset of manifest.presets ?? []) {
      const applied = sanitizeParams(defs, { ...defaultParams(defs), ...preset.params });
      for (const [k, v] of Object.entries(preset.params)) expect(sameValue(applied[k], v as ParamValue), `${preset.key}.${k}`).toBe(true);
      const total = (applied.inDuration as number) + (applied.hold as number) + (applied.outDuration as number);
      expect(total).toBeGreaterThanOrEqual(0.1);
      expect(total).toBeLessThanOrEqual(30);
      expect((applied.lines as string).split('\n').length).toBeLessThanOrEqual(MAX_LINES);
    }
    const max = (key: string) => (defs.find((p) => p.key === key) as { max: number }).max;
    expect(max('inDuration') + max('hold') + max('outDuration')).toBeLessThanOrEqual(30);
  });

  it('T-TPL-C055-3 一行输入拆成文字和方向', () => {
    expect(parseCaption('苦力怕：嘶~ <')).toEqual({ text: '苦力怕：嘶~', direction: 'left' });
    expect(parseCaption('Zombie groans >')).toEqual({ text: 'Zombie groans', direction: 'right' });
    expect(parseCaption('Footsteps')).toEqual({ text: 'Footsteps', direction: 'front' });
    // 没有空格隔开的 < > 是文字的一部分
    expect(parseCaption('a<')).toEqual({ text: 'a<', direction: 'front' });
    expect(parseCaption('  ')).toEqual({ text: '', direction: 'front' });
  });

  it('T-TPL-C055-4 版式：480 × 270 的界面里框的位置（原版字体 < 和 > 各宽 5）', () => {
    // 最宽的字幕 60：半宽 = (60 + 5 + 4 + 5 + 4) / 2 = 39
    const half = halfWidth(60, 5, 5);
    expect(half).toBe(39);
    const r0 = rowRect(480, 270, half, 0, 5);
    // 中心在 (w − 半宽 − 2, h − 35)
    expect([r0.cx, r0.cy]).toEqual([439, 235]);
    // 底板：比框向外各扩 1，高 10
    expect([r0.x, r0.y, r0.w, r0.h]).toEqual([399, 230, 80, 10]);
    expect(r0.x + r0.w).toBe(480 - 1);
    // 字的上边在中心上方 4；箭头贴着框的左右边
    expect(r0.textTop).toBe(231);
    expect([r0.ltX, r0.gtX]).toEqual([400, 473]);
    // 往上每条高 10，上下相接
    const r1 = rowRect(480, 270, half, 1, 5);
    expect(r1.cy).toBe(225);
    expect(r1.y + r1.h).toBe(r0.y);
    // 左下是镜像
    const l0 = rowRect(480, 270, half, 0, 5, 'left');
    expect([l0.cx, l0.x]).toEqual([41, 1]);
  });

  it('T-TPL-C055-5 三种画幅都放得下：框比界面宽时缩小', () => {
    expect(fitUnit(1920, 1080, 5, 39, 5)).toBe(5);
    // 半宽 150 的框要 306 个界面像素宽，9:16 下 1080 / 5 = 216 放不下
    const u = fitUnit(1080, 1920, 5, 150, 5);
    expect(u).toBeCloseTo(1080 / 306);
    const r = rowRect(1080 / u, 1920 / u, 150, 0, 5);
    expect(r.x).toBeGreaterThanOrEqual(-1e-6);
    expect(r.x + r.w).toBeLessThanOrEqual(1080 / u + 1e-6);
    // 10 条都在界面里
    for (const [w, h] of [
      [1920, 1080],
      [1080, 1920],
      [1080, 1080],
    ] as const) {
      const unit = fitUnit(w, h, 8, 39, MAX_LINES);
      expect(rowRect(w / unit, h / unit, 39, MAX_LINES - 1, 5).y).toBeGreaterThanOrEqual(0);
    }
  });

  it('T-TPL-C055-6 灰度：从 255 降到 75，分 8 级', () => {
    expect(grayAt(0)).toBe(255);
    expect(grayAt(0.5)).toBe(165);
    expect(grayAt(1)).toBe(75);
    expect(grayAt(2)).toBe(75);
    expect(GRAY_STEPS).toBe(8);
    expect(stepGray(0)).toBe(255);
    expect(stepGray(GRAY_STEPS - 1)).toBe(75);
    for (let s = 1; s < GRAY_STEPS; s++) expect(stepGray(s)).toBeLessThan(stepGray(s - 1));
    expect(stepAt(0)).toBe(0);
    expect(stepAt(0.124)).toBe(0);
    expect(stepAt(0.125)).toBe(1);
    expect(stepAt(0.999)).toBe(7);
    expect(stepAt(1)).toBe(7);
    expect(grayHex(255)).toBe('#FFFFFF');
    expect(grayHex(75)).toBe('#4B4B4B');
  });

  it('T-TPL-C055-7 时间：按间隔出现，显示 3 秒；最老的在最下面，消失后其余下移', () => {
    const at = (t: number) => visibleAt(t, 5, 0.8, 3).map((s) => [s.index, s.row]);
    expect(at(0)).toEqual([[0, 0]]);
    expect(at(1.7)).toEqual([
      [0, 0],
      [1, 1],
      [2, 2],
    ]);
    // 第一条在 3 秒时消失，第二条落到最下面
    expect(at(2.99)[0]).toEqual([0, 0]);
    expect(at(3)[0]).toEqual([1, 0]);
    expect(at(3.3)).toEqual([
      [1, 0],
      [2, 1],
      [3, 2],
      [4, 3],
    ]);
    // 最后一条 3.2 出现、6.2 消失
    expect(at(6.19)).toEqual([[4, 0]]);
    expect(at(6.2)).toEqual([]);
    expect(visibleAt(1.5, 1, 0.8, 3)[0]!.fraction).toBeCloseTo(0.5);
    expect(sampleCues(Array.from({ length: 30 }, (_, i) => i)).length).toBe(12);
  });

  it('T-TPL-C055-8 首末时刻整体不透明度为 0', () => {
    const w = overlayWindows(60, 0.2, 5, 0.2);
    const g = (t: number) => progress(t, w.in) * (1 - progress(t, w.out));
    expect(g(0)).toBe(0);
    expect(g(1 / 60)).toBe(0);
    expect(g(w.duration - 1 / 60)).toBe(0);
    expect(g(w.duration)).toBe(0);
    expect(g(2)).toBe(1);
    expect(g(0.1)).toBeGreaterThan(0);
    expect(g(w.duration - 0.1)).toBeGreaterThan(0);
  });
});
