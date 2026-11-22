// 053 正在播放 allay.builtin.now-playing 的验收测试（docs/template-catalog.md 第 2 节、docs/templates/now-playing.md）。
// 画面本身（首末帧透明、同一时刻两次渲染一致、三种画幅）由 test:engine 的 T-TPL-3、4、5 检查；这里测 manifest 和纯函数。
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { overlayWindows, progress } from '../../packages/templates/_lib/src/timing';
import {
  ACTIONBAR_FADE_TICKS,
  ACTIONBAR_TICKS,
  actionbarLayout,
  fitRow,
  hsbToHex,
  RAINBOW_MAX_STEPS,
  rainbowColor,
  rainbowIndex,
  rainbowSteps,
  TICK,
  TOAST_SLIDE,
  TOAST_VISIBLE,
  toastLayout,
  toastShown,
  toastX,
} from '../../packages/templates/now-playing/src/layout';
import { defaultParams, parseManifest, sameValue, sanitizeParams, type ParamValue } from '../../packages/template-sdk/src/index';

const manifest = (() => {
  const r = parseManifest(JSON.parse(readFileSync(join(import.meta.dirname, '../../packages/templates/now-playing/manifest.json'), 'utf8')));
  if (!r.ok) throw new Error(`manifest invalid: ${JSON.stringify(r)}`);
  return r.manifest;
})();
const defs = manifest.params ?? [];

describe('T-TPL-C053 正在播放', () => {
  it('T-TPL-C053-1 manifest 合法，默认参数能装载，默认时长是游戏的 60 刻、最后 20 刻淡出', () => {
    expect(manifest.id).toBe('allay.builtin.now-playing');
    expect(manifest.category).toBe('overlay');
    const zh = defaultParams(defs, { locale: 'zh-CN' });
    const en = defaultParams(defs, { locale: 'en' });
    expect(sanitizeParams(defs, zh)).toEqual(zh);
    expect(manifest.timeline?.segments.map((s) => s.param)).toEqual(['inDuration', 'hold', 'outDuration']);
    expect((zh.inDuration as number) + (zh.hold as number) + (zh.outDuration as number)).toBeCloseTo(ACTIONBAR_TICKS * TICK);
    expect(zh.outDuration).toBe(ACTIONBAR_FADE_TICKS * TICK);
    // 前缀是游戏语言文件的原文；曲名是占位文字，不是真实的曲目
    expect(zh.prefix).toBe('正在播放：');
    expect(en.prefix).toBe('Now Playing: ');
    expect(zh.track).toBe('曲名 - 作者');
    expect(en.track).toBe('Track - Artist');
    // 动作栏文字带阴影，提示框里的字不带；默认没有音效
    expect((zh.font as { shadow: boolean }).shadow).toBe(true);
    expect((zh.toastFont as { shadow: boolean }).shadow).toBe(false);
    expect(zh.sound).toBeNull();
  });

  it('T-TPL-C053-2 每个自带预设都能载入：值经过清洗后不变', () => {
    expect(manifest.presets?.length).toBeGreaterThanOrEqual(3);
    for (const preset of manifest.presets ?? []) {
      const applied = sanitizeParams(defs, { ...defaultParams(defs), ...preset.params });
      for (const [k, v] of Object.entries(preset.params)) expect(sameValue(applied[k], v as ParamValue), `${preset.key}.${k}`).toBe(true);
      const total = (applied.inDuration as number) + (applied.hold as number) + (applied.outDuration as number);
      expect(total).toBeGreaterThanOrEqual(0.1);
      expect(total).toBeLessThanOrEqual(30);
    }
    // 提示框的预设：滑入 0.6 秒，滑入加停留共 5 秒，滑出 0.6 秒
    const toast = manifest.presets?.find((p) => p.key === 'music-toast')?.params;
    expect(toast?.inDuration).toBe(TOAST_SLIDE);
    expect((toast?.inDuration as number) + (toast?.hold as number)).toBeCloseTo(TOAST_VISIBLE);
    expect(toast?.outDuration).toBe(TOAST_SLIDE);
  });

  it('T-TPL-C053-3 动作栏文字的位置：水平居中，上边在底边上方 72 个界面像素', () => {
    expect(actionbarLayout(480, 270)).toEqual({ centerX: 240, top: 198 });
    expect(actionbarLayout(384, 216)).toEqual({ centerX: 192, top: 144 });
    // 宽度是奇数时中心按整数除法
    expect(actionbarLayout(481, 270).centerX).toBe(240);
    // 放不下时缩小到两侧各留 4 个界面像素
    expect(fitRow(100, 480)).toBe(1);
    expect(fitRow(472, 480)).toBe(1);
    expect(fitRow(944, 480)).toBeCloseTo(0.5);
  });

  it('T-TPL-C053-4 彩虹变色：色相 = 剩余刻数 / 50，饱和度 0.7，亮度 0.6', () => {
    // 色相、饱和度、亮度到颜色的换算
    expect(hsbToHex(0, 1, 1)).toBe('#FF0000');
    expect(hsbToHex(1 / 3, 1, 1)).toBe('#00FF00');
    expect(hsbToHex(2 / 3, 1, 1)).toBe('#0000FF');
    expect(hsbToHex(0.5, 1, 1)).toBe('#00FFFF');
    expect(hsbToHex(0.25, 0, 0.5)).toBe('#808080');
    // 色相只看小数部分
    expect(hsbToHex(1.2, 0.7, 0.6)).toBe(hsbToHex(0.2, 0.7, 0.6));
    // 0.6 × 255 = 153（0x99），0.6 × 0.3 × 255 = 45.9 → 46（0x2E）
    expect(hsbToHex(0, 0.7, 0.6)).toBe('#992E2E');

    // 3 秒 = 60 刻：每刻一步，共 60 步
    const s = rainbowSteps(3);
    expect(s).toEqual({ count: 60, stepTicks: 1, totalTicks: 60 });
    // 第 0 步剩 60 刻：色相 60 / 50 = 1.2 → 0.2；第 10 步剩 50 刻：色相 1 → 0，是红色
    expect(rainbowColor(0, s)).toBe(hsbToHex(0.2, 0.7, 0.6));
    expect(rainbowColor(10, s)).toBe('#992E2E');
    expect(rainbowColor(35, s)).toBe(hsbToHex(0.5, 0.7, 0.6));
    // 时刻到步数：每 1 / 20 秒换一步，两端钳制
    expect(rainbowIndex(0, s)).toBe(0);
    expect(rainbowIndex(0.049, s)).toBe(0);
    expect(rainbowIndex(0.05, s)).toBe(1);
    expect(rainbowIndex(1, s)).toBe(20);
    expect(rainbowIndex(3, s)).toBe(59);
    expect(rainbowIndex(-1, s)).toBe(0);
  });

  it('T-TPL-C053-5 彩虹的步数不超过 120：时长更长时每步跨多刻', () => {
    expect(rainbowSteps(6)).toMatchObject({ count: 120, stepTicks: 1 });
    expect(rainbowSteps(6.05)).toMatchObject({ count: 61, stepTicks: 2 });
    const long = rainbowSteps(30);
    expect(long).toMatchObject({ count: 120, stepTicks: 5 });
    expect(rainbowIndex(29.99, long)).toBe(119);
    for (const d of [0.1, 0.25, 1, 2.37, 7, 12.5, 23, 30]) {
      const st = rainbowSteps(d);
      expect(st.count).toBeGreaterThanOrEqual(1);
      expect(st.count).toBeLessThanOrEqual(RAINBOW_MAX_STEPS);
      expect(rainbowIndex(d, st)).toBe(st.count - 1);
    }
  });

  it('T-TPL-C053-6 动作栏文字的不透明度：首末帧为 0，停留阶段为 1，最后一秒线性淡出', () => {
    const w = overlayWindows(60, 0.1, 1.9, 1);
    const a = (t: number) => progress(t, w.in) * (1 - progress(t, w.out));
    expect(w.duration).toBeCloseTo(3);
    expect(a(0)).toBe(0);
    expect(a(1 / 60)).toBe(0);
    expect(a(0.1)).toBe(1);
    expect(a(2)).toBe(1);
    expect(a(2.5)).toBeCloseTo(0.5, 1);
    expect(a(w.duration - 1 / 60)).toBe(0);
    expect(a(w.duration)).toBe(0);
  });

  it('T-TPL-C053-7 音乐提示框：高 32，文字从 30 开始、竖直居中，宽度随文字', () => {
    expect(toastLayout(100)).toEqual({ width: 138, height: 32, textX: 30, textTop: 12 });
    expect(toastLayout(100.2).width).toBe(139);
    expect(toastLayout(0).width).toBe(38);
    // 没有图标（1.21.6 之前的素材没有音符贴图）：文字左移到图标的位置，面板窄 22，不留空位
    expect(toastLayout(100, false)).toEqual({ width: 116, height: 32, textX: 8, textTop: 12 });
    expect(toastLayout(100, true).width - toastLayout(100, false).width).toBe(22);
    // 露出的比例：滑入 a²，滑出 1 − b²
    expect(toastShown(0, 0)).toBe(0);
    expect(toastShown(0.5, 0)).toBe(0.25);
    expect(toastShown(1, 0)).toBe(1);
    expect(toastShown(1, 0.5)).toBe(0.75);
    expect(toastShown(1, 1)).toBe(0);
    // 左上：从左边画外滑到 x = 0；右上：从右边画外滑到贴着右边。没露出时整个在画外
    expect(toastX('topLeft', 480, 138, 1)).toBe(0);
    expect(toastX('topLeft', 480, 138, 0)).toBeLessThanOrEqual(-138);
    expect(toastX('topRight', 480, 138, 1)).toBe(342);
    expect(toastX('topRight', 480, 138, 0)).toBeGreaterThanOrEqual(480);
    expect(toastX('topLeft', 480, 138, 0.5)).toBeCloseTo(-69.5);
  });
});
