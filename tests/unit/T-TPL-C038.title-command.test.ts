// 038 标题命令 allay.builtin.title-command 的验收测试（docs/template-catalog.md 第 2 节、docs/templates/title-command.md）。
// 画面本身（首末帧透明、同一时刻两次渲染一致、三种画幅）由 test:engine 的 T-TPL-3、4、5 检查；这里测 manifest 和纯函数。
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { overlayWindows, progress } from '../../packages/templates/_lib/src/timing';
import { ACTIONBAR_FADE_TICKS, ACTIONBAR_TICKS, actionbarAlpha, TICK, titleAlpha, titleLayout } from '../../packages/templates/title-command/src/layout';
import { applyPreset, defaultParams, localizePresetParams, parseManifest, sameValue, sanitizeParams } from '../../packages/template-sdk/src/index';

const manifest = (() => {
  const r = parseManifest(JSON.parse(readFileSync(join(import.meta.dirname, '../../packages/templates/title-command/manifest.json'), 'utf8')));
  if (!r.ok) throw new Error(`manifest invalid: ${JSON.stringify(r)}`);
  return r.manifest;
})();
const defs = manifest.params ?? [];

describe('T-TPL-C038 标题命令', () => {
  it('T-TPL-C038-1 manifest 合法，默认参数能装载，时间线三段是游戏的 10 / 70 / 20 刻', () => {
    expect(manifest.id).toBe('allay.builtin.title-command');
    expect(manifest.category).toBe('overlay');
    const d = defaultParams(defs, { locale: 'zh-CN' });
    expect(sanitizeParams(defs, d)).toEqual(d);
    expect(manifest.timeline?.segments.map((s) => s.param)).toEqual(['inDuration', 'hold', 'outDuration']);
    expect([d.inDuration, d.hold, d.outDuration]).toEqual([10 * TICK, 70 * TICK, 20 * TICK]);
    expect(d.actionbarDuration).toBe(ACTIONBAR_TICKS * TICK);
    // 三行文字默认都带阴影
    for (const key of ['titleFont', 'subtitleFont', 'actionbarFont']) expect((d[key] as { shadow: boolean }).shadow).toBe(true);
  });

  it('T-TPL-C038-2 每个自带预设都能载入：值经过清洗后不变', () => {
    expect(manifest.presets?.length).toBeGreaterThanOrEqual(2);
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
  });

  it('T-TPL-C038-3 版式：1080p、界面缩放 4（480 × 270）时三行文字的位置', () => {
    const l = titleLayout(480, 270);
    expect(l.centerX).toBe(240);
    // 标题在界面中心上方 40（4 倍坐标系里的 −10），副标题在下方 10（2 倍坐标系里的 5）
    expect(l.titleTop).toBe(135 - 40);
    expect(l.subtitleTop).toBe(135 + 10);
    // 动作栏：以 (w / 2, h − 68) 为原点的 y = −4
    expect(l.actionbarTop).toBe(270 - 72);
    // 高度为奇数时中心按整数除法
    expect(titleLayout(480, 271).titleTop).toBe(135 - 40);
    // 4 倍的标题高 32，副标题紧跟其后还有间隙，不重叠
    expect(l.titleTop + 8 * 4).toBeLessThan(l.subtitleTop);
  });

  it('T-TPL-C038-4 标题的不透明度：线性淡入、停留、线性淡出，两端为 0', () => {
    const [i, s, o] = [0.5, 3.5, 1];
    expect(titleAlpha(0, i, s, o)).toBe(0);
    expect(titleAlpha(0.25, i, s, o)).toBeCloseTo(0.5);
    expect(titleAlpha(0.5, i, s, o)).toBe(1);
    expect(titleAlpha(4, i, s, o)).toBe(1);
    expect(titleAlpha(4.5, i, s, o)).toBeCloseTo(0.5);
    expect(titleAlpha(5, i, s, o)).toBe(0);
    // 模板实际用的是 _lib 的时间窗（首尾各让出一帧），除这一帧外和上面的公式一致
    const w = overlayWindows(60, i, s, o);
    const a = (t: number) => progress(t, w.in) * (1 - progress(t, w.out));
    expect(a(0)).toBe(0);
    expect(a(1 / 60)).toBe(0);
    expect(a(w.duration)).toBe(0);
    expect(a(w.duration - 1 / 60)).toBe(0);
    expect(a(2)).toBe(1);
    expect(a(4.5)).toBeCloseTo(titleAlpha(4.5, i, s, o), 1);
  });

  it('T-TPL-C038-5 动作栏：60 刻，最后 20 刻淡出', () => {
    const life = ACTIONBAR_TICKS * TICK;
    const fade = ACTIONBAR_FADE_TICKS * TICK;
    expect(actionbarAlpha(0, life, fade)).toBe(1);
    expect(actionbarAlpha(2, life, fade)).toBe(1);
    expect(actionbarAlpha(2.5, life, fade)).toBeCloseTo(0.5);
    expect(actionbarAlpha(3, life, fade)).toBe(0);
    expect(actionbarAlpha(-0.1, life, fade)).toBe(0);
    // 寿命比淡出还短时整段都在淡出，仍然从 1 走到 0
    expect(actionbarAlpha(0, 0.5, fade)).toBe(1);
    expect(actionbarAlpha(0.25, 0.5, fade)).toBeCloseTo(0.5);
  });
});
