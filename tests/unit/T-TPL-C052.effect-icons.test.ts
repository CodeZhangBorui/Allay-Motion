// 052 状态效果 allay.builtin.effect-icons 的验收测试（docs/template-catalog.md 第 2 节、docs/templates/effect-icons.md）。
// 画面本身（首末帧透明、同一时刻两次渲染一致、三种画幅）由 test:engine 的 T-TPL-3、4、5 检查；这里测 manifest 和纯函数。
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { overlayWindows, progress } from '../../packages/templates/_lib/src/timing';
import { arrange, blinkAlpha, EFFECTS, frameX, remainingTicks, rowWidth, type Slot } from '../../packages/templates/effect-icons/src/layout';
import { defaultParams, parseManifest, sameValue, sanitizeParams, type ParamValue } from '../../packages/template-sdk/src/index';

const manifest = (() => {
  const r = parseManifest(JSON.parse(readFileSync(join(import.meta.dirname, '../../packages/templates/effect-icons/manifest.json'), 'utf8')));
  if (!r.ok) throw new Error(`manifest invalid: ${JSON.stringify(r)}`);
  return r.manifest;
})();
const defs = manifest.params ?? [];
const EFFECT_KEYS = ['effect1', 'effect2', 'effect3', 'effect4', 'effect5', 'effect6'];

/** 说明里允许做默认值的音效 */
const ALLOWED_SOUNDS = new Set<ParamValue>([
  null,
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

const slot = (effect: string, appearAt = 0, expireAt = Number.POSITIVE_INFINITY): Slot => ({ effect, appearAt, expireAt });

describe('T-TPL-C052 状态效果', () => {
  it('T-TPL-C052-1 manifest 合法，默认参数清洗后不变；六个效果参数的选项相同，且都在分类表里', () => {
    expect(manifest.id).toBe('allay.builtin.effect-icons');
    expect(manifest.category).toBe('overlay');
    expect(manifest.tags?.[0]).toBe('ui');
    const d = defaultParams(defs, { locale: 'zh-CN' });
    expect(sanitizeParams(defs, d)).toEqual(d);
    expect(manifest.timeline?.segments.map((s) => s.param)).toEqual(['inDuration', 'hold', 'outDuration']);
    expect(d.sound).toBeNull();
    const optionsOf = (key: string): string[] => {
      const def = defs.find((p) => p.key === key);
      if (!def || def.type !== 'enum') throw new Error(`${key} is not an enum`);
      return def.options.map((o) => o.value);
    };
    const first = optionsOf('effect1');
    expect(first[0]).toBe('none');
    for (const key of EFFECT_KEYS) expect(optionsOf(key)).toEqual(first);
    expect(first.slice(1).sort()).toEqual(Object.keys(EFFECTS).sort());
    // 没有持续时间的效果不显示图标，不列
    expect(first).not.toContain('instant_health');
    expect(first).not.toContain('instant_damage');
  });

  it('T-TPL-C052-2 每个自带预设都能载入：值经过清洗后不变', () => {
    expect(manifest.presets?.length).toBeGreaterThanOrEqual(3);
    for (const preset of manifest.presets ?? []) {
      const applied = sanitizeParams(defs, { ...defaultParams(defs), ...preset.params });
      for (const [k, v] of Object.entries(preset.params)) expect(sameValue(applied[k], v as ParamValue), `${preset.key}.${k}`).toBe(true);
      expect(ALLOWED_SOUNDS.has(applied.sound ?? null), preset.key).toBe(true);
      const total = (applied.inDuration as number) + (applied.hold as number) + (applied.outDuration as number);
      expect(total).toBeGreaterThanOrEqual(0.1);
      expect(total).toBeLessThanOrEqual(30);
    }
  });

  it('T-TPL-C052-3 版式：界面宽 320 时，框 24 × 24，第 k 个在 x = w − 25k，正面 y = 1，其余 y = 27', () => {
    expect(frameX(320, 1, false)).toBe(295);
    expect(frameX(320, 2, false)).toBe(270);
    // 最右的框离右边 1 个界面像素
    expect(frameX(320, 1, false) + 24).toBe(319);
    // 左上是镜像：最左的框离左边 1 个界面像素
    expect(frameX(320, 1, true)).toBe(1);
    expect(frameX(320, 2, true)).toBe(26);
    expect(frameX(320, 1, true)).toBe(320 - frameX(320, 1, false) - 24);
    const placed = arrange([slot('speed'), slot('poison'), slot('strength'), slot('wither')], 0, 320, false);
    expect(placed).toEqual([
      { index: 0, x: 295, y: 1 },
      { index: 1, x: 295, y: 27 },
      { index: 2, x: 270, y: 1 },
      { index: 3, x: 270, y: 27 },
    ]);
    // 两排不重叠：第一排的下边 25，第二排的上边 27
    expect(1 + 24).toBeLessThan(27);
    // 六个排一排要 151 个界面像素，竖屏（1080 / 6 = 180）放得下
    expect(rowWidth(6)).toBe(151);
    expect(EFFECTS.speed?.beneficial).toBe(true);
    expect(EFFECTS.regeneration?.beneficial).toBe(true);
    expect(EFFECTS.poison?.beneficial).toBe(false);
    expect(EFFECTS.bad_omen?.beneficial).toBe(false);
  });

  it('T-TPL-C052-4 出现和消失：到时刻才出现；到期的消失后，后面的立刻补上', () => {
    const slots = [slot('speed', 0), slot('haste', 0.4, 3.4), slot('strength', 0.8), slot('poison', 1.2)];
    expect(arrange(slots, 0.39, 320, false).map((p) => p.index)).toEqual([0]);
    expect(arrange(slots, 0.4, 320, false).map((p) => p.index)).toEqual([0, 1]);
    expect(arrange(slots, 2, 320, false)).toEqual([
      { index: 0, x: 295, y: 1 },
      { index: 1, x: 270, y: 1 },
      { index: 2, x: 245, y: 1 },
      { index: 3, x: 295, y: 27 },
    ]);
    // haste 到期：strength 从第 3 个位置补到第 2 个
    expect(arrange(slots, 3.4, 320, false)).toEqual([
      { index: 0, x: 295, y: 1 },
      { index: 2, x: 270, y: 1 },
      { index: 3, x: 295, y: 27 },
    ]);
    // 全是“无”时什么都不画；同一个效果选两次就画两个
    expect(arrange([], 1, 320, false)).toEqual([]);
    expect(arrange([slot('speed'), slot('speed')], 1, 320, false).map((p) => p.x)).toEqual([295, 270]);
    // 表里没有的名字当成负面
    expect(arrange([slot('unknown_effect')], 1, 320, false)[0]?.y).toBe(27);
  });

  it('T-TPL-C052-5 闪烁公式：剩 200 刻起降到一半，摆幅每 20 刻加一档，最后 50 刻降到 0', () => {
    expect(blinkAlpha(201)).toBe(1);
    expect(blinkAlpha(1000)).toBe(1);
    // 正好 200 刻时摆幅是 0
    expect(blinkAlpha(200)).toBeCloseTo(0.5);
    // 199–180 刻：摆幅 0.025；余弦周期 10 刻，在 10 的倍数上是 1、在中间是 −1
    expect(blinkAlpha(190)).toBeCloseTo(0.525);
    expect(blinkAlpha(185)).toBeCloseTo(0.475);
    expect(blinkAlpha(180)).toBeCloseTo(0.525);
    // 179–160 刻：摆幅 0.05
    expect(blinkAlpha(175)).toBeCloseTo(0.45);
    // 100 刻：摆幅 0.125；95 刻：0.15
    expect(blinkAlpha(100)).toBeCloseTo(0.625);
    expect(blinkAlpha(95)).toBeCloseTo(0.35);
    // 不到 20 刻时摆幅到顶 0.25；最后 50 刻底从 0.5 线性降到 0
    expect(blinkAlpha(20)).toBeCloseTo(0.2 + 0.225);
    expect(blinkAlpha(50)).toBeCloseTo(0.5 + 0.2);
    expect(blinkAlpha(10)).toBeCloseTo(0.1 + 0.25);
    expect(blinkAlpha(5)).toBe(0);
    expect(blinkAlpha(0)).toBe(0);
    for (let d = 0; d <= 220; d++) {
      expect(blinkAlpha(d)).toBeGreaterThanOrEqual(0);
      expect(blinkAlpha(d)).toBeLessThanOrEqual(1);
    }
    // 剩余刻数每刻减一
    expect(remainingTicks(5, 0)).toBe(100);
    expect(remainingTicks(5, 0.049)).toBe(100);
    expect(remainingTicks(5, 0.05)).toBe(99);
    expect(remainingTicks(5, 5)).toBe(0);
  });

  it('T-TPL-C052-6 整体的不透明度：首末帧为 0，停留阶段为 1', () => {
    const w = overlayWindows(60, 0.25, 6, 0.25);
    const a = (t: number) => progress(t, w.in) * (1 - progress(t, w.out));
    expect(w.duration).toBe(6.5);
    expect(a(0)).toBe(0);
    expect(a(1 / 60)).toBe(0);
    expect(a(w.duration - 1 / 60)).toBe(0);
    expect(a(w.duration)).toBe(0);
    expect(a(3)).toBe(1);
    expect(a(0.1)).toBeGreaterThan(0);
    expect(a(0.1)).toBeLessThan(a(0.2));
  });
});
