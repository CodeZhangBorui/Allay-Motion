// 041 聊天消息 allay.builtin.chat-message 的验收测试（docs/template-catalog.md 第 2 节、docs/templates/chat-message.md）。
// 画面本身（首末帧透明、同一时刻两次渲染一致、三种画幅）由 test:engine 的 T-TPL-3、4、5 检查；这里测 manifest 和纯函数。
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { overlayWindows, progress } from '../../packages/templates/_lib/src/timing';
import {
  BG_LEFT,
  BG_RIGHT,
  CHAT_WIDTH,
  CHAT_X,
  cursorOn,
  fitUnit,
  inputBar,
  LIFETIME_TICKS,
  MAX_ROWS,
  MAX_TYPED,
  messageAlpha,
  MIN_ALPHA,
  rowCount,
  rowTop,
  sampleCues,
  schedule,
  SEND_PAUSE,
  TEXT_DY,
  TICK,
  typedCount,
  typedText,
  visibleRows,
} from '../../packages/templates/chat-message/src/layout';
import { applyPreset, defaultParams, localizePresetParams, parseManifest, sameValue, sanitizeParams } from '../../packages/template-sdk/src/index';

const manifest = (() => {
  const r = parseManifest(JSON.parse(readFileSync(join(import.meta.dirname, '../../packages/templates/chat-message/manifest.json'), 'utf8')));
  if (!r.ok) throw new Error(`manifest invalid: ${JSON.stringify(r)}`);
  return r.manifest;
})();
const defs = manifest.params ?? [];

describe('T-TPL-C041 聊天消息', () => {
  it('T-TPL-C041-1 manifest 合法，默认参数清洗后不变，默认值是游戏的数值', () => {
    expect(manifest.id).toBe('allay.builtin.chat-message');
    expect(manifest.category).toBe('overlay');
    expect(manifest.tags?.[0]).toBe('ui');
    for (const locale of ['zh-CN', 'en'] as const) {
      const d = defaultParams(defs, { locale });
      expect(sanitizeParams(defs, d)).toEqual(d);
      expect((d.lines as string).split('\n').length).toBe(3);
    }
    const d = defaultParams(defs, { locale: 'zh-CN' });
    expect(manifest.timeline?.segments.map((s) => s.param)).toEqual(['inDuration', 'hold', 'outDuration']);
    expect(d.lifetime).toBe(LIFETIME_TICKS * TICK);
    expect(d.bgOpacity).toBe(0.5);
    expect((d.font as { shadow: boolean }).shadow).toBe(true);
    expect(d.sound).toBeNull();
    // 默认参数下所有消息在退出阶段都还在（退出阶段的画面才会逐帧变化）
    const count = (d.lines as string).split('\n').length;
    expect((count - 1) * (d.interval as number)).toBeLessThan(d.hold as number);
    expect(d.lifetime as number).toBeGreaterThan((d.inDuration as number) + (d.hold as number) + (d.outDuration as number));
  });

  it('T-TPL-C041-2 每个自带预设都能载入：值经过清洗后不变', () => {
    expect(manifest.presets?.length).toBeGreaterThanOrEqual(3);
    for (const [preset, locale] of (manifest.presets ?? []).flatMap((p) => (['zh-CN', 'en'] as const).map((l) => [p, l] as const))) {
      // 预设里的文字分中英文：按界面语言取成普通文字再套用（和应用一样）；英文下不该剩中文
      const applied = applyPreset(defs, preset, { locale });
      for (const [k, v] of Object.entries(localizePresetParams(defs, preset.params, locale))) {
        expect(sameValue(applied[k], v), `${preset.key}.${k} (${locale})`).toBe(true);
        if (locale === 'en' && typeof v === 'string') expect(v, `${preset.key}.${k}`).not.toMatch(/[\u3400-\u9fff]/);
      }
      const total = (applied.inDuration as number) + (applied.hold as number) + (applied.outDuration as number);
      expect(total).toBeGreaterThanOrEqual(0.1);
      expect(total).toBeLessThanOrEqual(30);
    }
    // 时间参数取到上限时也不超过 30 秒
    const max = (key: string) => (defs.find((p) => p.key === key) as { max: number }).max;
    expect(max('inDuration') + max('hold') + max('outDuration')).toBeLessThanOrEqual(30);
  });

  it('T-TPL-C041-3 版式：1080p、界面缩放 4（480 × 270）时行和底板的位置', () => {
    expect(fitUnit(1920, 1080, 4)).toBe(4);
    expect([CHAT_X, CHAT_WIDTH, MAX_ROWS]).toEqual([4, 320, 10]);
    // 最新一行：y 从 h − 49 到 h − 40；文字上边在行上边下方 1
    expect(rowTop(270, 0)).toBe(221);
    expect(rowTop(270, 0) + 9).toBe(270 - 40);
    expect(rowTop(270, 0) + TEXT_DY).toBe(222);
    // 每往上一行高 9；第 10 行（最上面）的上边在 h − 130
    expect(rowTop(270, 1)).toBe(212);
    expect(rowTop(270, 9)).toBe(140);
    // 底板：从界面左边缘到 332
    expect([BG_LEFT, BG_RIGHT]).toEqual([0, 332]);
    // 输入栏：(2, h − 14) 到 (w − 2, h − 2)，文字在 (4, h − 12)
    expect(inputBar(480, 270)).toEqual({ x: 2, y: 256, w: 476, h: 12, textX: 4, textY: 258 });
    // 输入栏在最下面一行聊天的下方，不重叠
    expect(inputBar(480, 270).y).toBeGreaterThan(rowTop(270, 0) + 9);
    // 行数：n 行的文字高 9n − 1
    expect([8, 17, 26, 89].map((h) => rowCount(h, 8))).toEqual([1, 2, 3, 10]);
  });

  it('T-TPL-C041-4 三种画幅都放得下：9:16 下缩小到 332 个界面像素宽', () => {
    const u = fitUnit(1080, 1920, 4);
    expect(u).toBeCloseTo(1080 / 332);
    expect(BG_RIGHT * u).toBeLessThanOrEqual(1080 + 1e-6);
    expect(fitUnit(1080, 1080, 4)).toBeCloseTo(1080 / 332);
    // 界面缩放调到 8 时 16:9 也要缩
    expect(fitUnit(1920, 1080, 8)).toBeCloseTo(1920 / 332);
    // 缩小后 10 行仍在界面里
    for (const [w, h] of [
      [1920, 1080],
      [1080, 1920],
      [1080, 1080],
    ] as const) {
      const unit = fitUnit(w, h, 8);
      expect(rowTop(h / unit, MAX_ROWS - 1)).toBeGreaterThanOrEqual(0);
    }
  });

  it('T-TPL-C041-5 消息的不透明度：200 刻的寿命，最后十分之一按平方淡出', () => {
    const life = LIFETIME_TICKS * TICK;
    expect(messageAlpha(0, life)).toBe(1);
    expect(messageAlpha(180 * TICK, life)).toBeCloseTo(1);
    // 第 190 刻：p = 0.05 → (0.5)² = 0.25
    expect(messageAlpha(190 * TICK, life)).toBeCloseTo(0.25);
    expect(messageAlpha(195 * TICK, life)).toBeCloseTo(0.0625);
    expect(messageAlpha(200 * TICK, life)).toBe(0);
    expect(messageAlpha(-0.01, life)).toBe(0);
    expect(messageAlpha(250 * TICK, life)).toBe(0);
    expect(MIN_ALPHA).toBeCloseTo(4 / 255);
  });

  it('T-TPL-C041-6 消息出现的时刻和行的排列：新的在最下面，旧的立刻上移', () => {
    const plan = schedule(3, 1.2, null);
    expect(plan.appear).toEqual([0, 1.2, 2.4]);
    expect(plan.inputEnd).toBe(-1);
    const rows = [1, 1, 1];
    expect(visibleRows(0.5, plan.appear, rows, 10).map((s) => [s.index, s.row])).toEqual([[0, 0]]);
    expect(visibleRows(1.2, plan.appear, rows, 10).map((s) => [s.index, s.row])).toEqual([
      [1, 0],
      [0, 1],
    ]);
    expect(visibleRows(3, plan.appear, rows, 10).map((s) => [s.index, s.row])).toEqual([
      [2, 0],
      [1, 1],
      [0, 2],
    ]);
    // 换成两行的消息占连续两行，上面的消息再往上
    expect(visibleRows(3, plan.appear, [1, 2, 1], 10).map((s) => [s.index, s.row, s.rows])).toEqual([
      [2, 0, 1],
      [1, 1, 2],
      [0, 3, 1],
    ]);
    // 最老的先淡掉：寿命 2 秒时，t = 3 只剩后两条，行号不变
    expect(visibleRows(3, plan.appear, rows, 2).map((s) => [s.index, s.row])).toEqual([
      [2, 0],
      [1, 1],
    ]);
    // 超过 10 行的不画
    const many = schedule(12, 0.1, null);
    const slots = visibleRows(5, many.appear, Array<number>(12).fill(1), 10);
    expect(slots.length).toBe(10);
    expect(slots[0]!.index).toBe(11);
    expect(slots[9]!.index).toBe(2);
    expect(sampleCues(many.appear).length).toBe(12);
    expect(sampleCues(Array.from({ length: 30 }, (_, i) => i)).length).toBe(12);
  });

  it('T-TPL-C041-7 输入栏：去掉 <名字>、逐字打出、光标每 6 刻亮灭、打完停一下再发出', () => {
    expect(typedText('<Steve> hello').join('')).toBe('hello');
    expect(typedText('no prefix').join('')).toBe('no prefix');
    expect(typedText(`<A> ${'x'.repeat(100)}`).length).toBe(MAX_TYPED);
    expect(typedCount(-1, 10, 5)).toBe(0);
    expect(typedCount(0, 10, 5)).toBe(0);
    expect(typedCount(0.1, 10, 5)).toBe(1);
    expect(typedCount(0.35, 10, 5)).toBe(3);
    expect(typedCount(9, 10, 5)).toBe(5);
    // 光标：第 0–5 刻亮，6–11 刻灭，12 刻起又亮
    expect([0, 5, 6, 11, 12].map((tick) => cursorOn((tick + 0.5) * TICK))).toEqual([true, true, false, false, true]);
    // 淡入结束（0.2 秒）后开始打 5 个字，10 字/秒 → 0.7 秒打完，再停 SEND_PAUSE 发出
    const plan = schedule(2, 1.2, { start: 0.2, chars: 5, speed: 10 });
    expect(plan.typeStart).toBe(0.2);
    expect(plan.inputEnd).toBeCloseTo(0.7 + SEND_PAUSE);
    expect(plan.appear[0]).toBeCloseTo(plan.inputEnd);
    expect(plan.appear[1]).toBeCloseTo(plan.inputEnd + 1.2);
    // 发出之前没有任何消息行
    expect(visibleRows(plan.inputEnd - 0.01, plan.appear, [1, 1], 10)).toEqual([]);
  });

  it('T-TPL-C041-8 首末时刻整体不透明度为 0', () => {
    const w = overlayWindows(60, 0.2, 6, 0.2);
    const g = (t: number) => progress(t, w.in) * (1 - progress(t, w.out));
    expect(g(0)).toBe(0);
    expect(g(1 / 60)).toBe(0);
    expect(g(w.duration - 1 / 60)).toBe(0);
    expect(g(w.duration)).toBe(0);
    expect(g(3)).toBe(1);
    expect(g(0.1)).toBeGreaterThan(0);
    expect(g(w.duration - 0.1)).toBeGreaterThan(0);
  });
});
