// 045 物品提示框 allay.builtin.item-tooltip 的验收测试（docs/template-catalog.md 第 2 节、docs/templates/item-tooltip.md）。
// 画面本身（首末帧透明、同一时刻两次渲染一致、三种画幅）由 test:engine 的 T-TPL-3、4、5 检查；这里测 manifest 和纯函数。
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { overlayWindows, progress } from '../../packages/templates/_lib/src/timing';
import {
  CLASSIC_BACKGROUND,
  CLASSIC_BACKGROUND_ALPHA,
  CLASSIC_BORDER_ALPHA,
  CLASSIC_BORDER_BOTTOM,
  CLASSIC_BORDER_TOP,
  classicBackground,
  classicBorder,
  driftOffset,
  followOffset,
  followStops,
  gradientSlice,
  groupLayout,
  lineTop,
  LORE_COLOR,
  loreLines,
  MAX_LORE_LINES,
  mixHex,
  MOVE_SECONDS,
  outerBox,
  PLAIN_COLOR,
  RARITY_COLORS,
  SLOT_PITCH,
  SPRITE_BACKGROUND_BORDER,
  SPRITE_FRAME_BORDER,
  spriteBox,
  textHeight,
} from '../../packages/templates/item-tooltip/src/layout';
import { defaultParams, parseManifest, sameValue, sanitizeParams, type ParamValue } from '../../packages/template-sdk/src/index';

const manifest = (() => {
  const r = parseManifest(JSON.parse(readFileSync(join(import.meta.dirname, '../../packages/templates/item-tooltip/manifest.json'), 'utf8')));
  if (!r.ok) throw new Error(`manifest invalid: ${JSON.stringify(r)}`);
  return r.manifest;
})();
const defs = manifest.params ?? [];

describe('T-TPL-C045 物品提示框', () => {
  it('T-TPL-C045-1 manifest 合法，默认参数清洗后不变，默认值照游戏（带阴影、说明里的空行保留）', () => {
    expect(manifest.id).toBe('allay.builtin.item-tooltip');
    expect(manifest.category).toBe('overlay');
    expect(manifest.tags?.[0]).toBe('ui');
    for (const locale of ['zh-CN', 'en'] as const) {
      const d = defaultParams(defs, { locale });
      expect(sanitizeParams(defs, d)).toEqual(d);
      // 默认说明：两行附魔、一个空行、“在主手时：”、缩进一格的属性行
      const lines = loreLines(d.lore as string);
      expect(lines).toHaveLength(5);
      expect(lines[2]).toBe('');
      expect(lines[4]!.startsWith(' §2')).toBe(true);
    }
    const d = defaultParams(defs, { locale: 'en' });
    expect(d.name).toBe('Diamond Sword');
    expect(d.item).toBe('minecraft:diamond_sword');
    expect(d.style).toBe('auto');
    expect(d.sound).toBeNull();
    expect(manifest.timeline?.segments.map((s) => s.param)).toEqual(['inDuration', 'hold', 'outDuration']);
    for (const key of ['nameFont', 'loreFont']) expect((d[key] as { shadow: boolean }).shadow).toBe(true);
    // 稀有度的每个选项都有颜色
    const rarity = defs.find((p) => p.key === 'rarity');
    expect(rarity?.type === 'enum' ? rarity.options.map((o) => o.value) : []).toEqual(Object.keys(RARITY_COLORS));
  });

  it('T-TPL-C045-2 每个自带预设都能载入：值经过清洗后不变', () => {
    expect(manifest.presets?.length).toBeGreaterThanOrEqual(3);
    for (const preset of manifest.presets ?? []) {
      const applied = sanitizeParams(defs, { ...defaultParams(defs), ...preset.params });
      for (const [k, v] of Object.entries(preset.params)) expect(sameValue(applied[k], v as ParamValue), `${preset.key}.${k}`).toBe(true);
      const total = (applied.inDuration as number) + (applied.hold as number) + (applied.outDuration as number);
      expect(total).toBeGreaterThanOrEqual(0.1);
      expect(total).toBeLessThanOrEqual(30);
      expect(loreLines(applied.lore as string).length, preset.key).toBeLessThanOrEqual(MAX_LORE_LINES);
    }
  });

  it('T-TPL-C045-3 颜色：稀有度、说明的两种默认样式、旧样式的底和边框', () => {
    expect(RARITY_COLORS).toEqual({ common: '#FFFFFF', uncommon: '#FFFF55', rare: '#55FFFF', epic: '#FF55FF' });
    expect(LORE_COLOR).toBe('#AA00AA');
    expect(PLAIN_COLOR).toBe('#AAAAAA');
    expect(CLASSIC_BACKGROUND).toBe('#100010');
    expect(CLASSIC_BACKGROUND_ALPHA).toBeCloseTo(240 / 255);
    expect([CLASSIC_BORDER_TOP, CLASSIC_BORDER_BOTTOM]).toEqual(['#5000FF', '#28007F']);
    expect(CLASSIC_BORDER_ALPHA).toBeCloseTo(80 / 255);
    expect([SPRITE_BACKGROUND_BORDER, SPRITE_FRAME_BORDER]).toEqual([9, 10]);
    // 渐变：两端和正中
    expect(mixHex('#5000FF', '#28007F', 0)).toBe('#5000FF');
    expect(mixHex('#5000FF', '#28007F', 1)).toBe('#28007F');
    expect(mixHex('#5000FF', '#28007F', 0.5)).toBe('#3C00BF');
    // 切成小条后从上到下单调变暗，首尾接近两端的颜色
    const blues = Array.from({ length: 12 }, (_, i) => Number.parseInt(gradientSlice(i, 12).slice(5), 16));
    for (let i = 1; i < blues.length; i++) expect(blues[i]!).toBeLessThan(blues[i - 1]!);
    expect(blues[0]!).toBeGreaterThan(0xf0);
    expect(blues[11]!).toBeLessThan(0x90);
  });

  it('T-TPL-C045-4 文字块：一行高 8，多行 8 + (n − 1) × 10 + 2；各行的上边 0、12、22……', () => {
    expect([1, 2, 3, 6].map(textHeight)).toEqual([8, 20, 30, 60]);
    expect([0, 1, 2, 5].map(lineTop)).toEqual([0, 12, 22, 52]);
    // 最后一行的下边正好是文字块的高度
    for (const n of [1, 2, 5, 13]) expect(lineTop(n - 1) + 8).toBe(textHeight(n));
    // 说明：保留中间的空行、去掉末尾的空行和行尾空白，最多 12 行
    expect(loreLines('a  \n\n b\n\n\n')).toEqual(['a', '', ' b']);
    expect(loreLines('')).toEqual([]);
    expect(loreLines(Array.from({ length: 20 }, (_, i) => `l${i}`).join('\n'))).toHaveLength(MAX_LORE_LINES);
  });

  it('T-TPL-C045-5 旧样式的框：文字宽 80、高 30 时底的五块和边框的四条', () => {
    expect(classicBackground(80, 30)).toEqual([
      [-3, -4, 86, 1],
      [-3, 33, 86, 1],
      [-3, -3, 86, 36],
      [-4, -3, 1, 36],
      [83, -3, 1, 36],
    ]);
    const b = classicBorder(80, 30);
    expect(b.top).toEqual([-3, -3, 86, 1]);
    expect(b.bottom).toEqual([-3, 32, 86, 1]);
    // 竖线夹在上下两条横线之间
    expect(b.left).toEqual([-3, -2, 1, 34]);
    expect(b.right).toEqual([82, -2, 1, 34]);
    expect(b.left[1] + b.left[3]).toBe(b.bottom[1]);
    // 看得见的外框是文字四周各 4；新样式的贴图是四周各 3 + 9
    expect(outerBox(80, 30)).toEqual([-4, -4, 88, 38]);
    expect(spriteBox(80, 30)).toEqual([-12, -12, 104, 54]);
  });

  it('T-TPL-C045-6 物品和提示框的相对位置：文字原点 = 鼠标 + (12, −12)，物品 16 × 16 在鼠标正中', () => {
    const g = groupLayout(80, 30, true);
    expect(g.textX - g.cursorX).toBe(12);
    expect(g.textY - g.cursorY).toBe(-12);
    // 左边到物品的左边（鼠标 − 8），上边到提示框的上边（鼠标 − 16），右边到提示框的右边，下边取两者较低的
    expect([g.cursorX, g.cursorY]).toEqual([8, 16]);
    expect(g.width).toBe(8 + 8 + 88);
    expect(g.height).toBe(38);
    // 提示框很矮时下边到物品的下边
    expect(groupLayout(40, 8, true).height).toBe(16 + 8);
    // 没有物品时就是提示框的外框
    const n = groupLayout(80, 30, false);
    expect([n.width, n.height, n.textX, n.textY]).toEqual([88, 38, 4, 4]);
  });

  it('T-TPL-C045-7 移动：漂移从原位开始、幅度不超过 3 和 2；跟随在各停留点之间走，一步 18', () => {
    expect(driftOffset(0)).toEqual({ x: 0, y: 0 });
    for (let t = 0; t <= 10; t += 0.1) {
      const o = driftOffset(t);
      expect(Math.abs(o.x)).toBeLessThanOrEqual(3);
      expect(Math.abs(o.y)).toBeLessThanOrEqual(2);
    }
    // 停留点：每个轴只在 0 和朝里的一格之间
    expect(SLOT_PITCH).toBe(18);
    expect(followStops(3, 1, -1, [0.1, 0.9])).toEqual([
      { x: 0, y: 0 },
      { x: 18, y: 0 },
      { x: 18, y: -18 },
    ]);
    expect(followStops(3, -1, 1, [0.1, 0.2])).toEqual([
      { x: 0, y: 0 },
      { x: -18, y: 0 },
      { x: 0, y: 0 },
    ]);
    expect(followStops(2, 1, 1, [0.99])).toEqual([
      { x: 0, y: 0 },
      { x: 0, y: 18 },
    ]);
    // 时间：[0, 3] 平分三段，第 i 次移动以第 i 段的分界为中心
    const stops = followStops(3, 1, 1, [0.1, 0.9]);
    expect(followOffset(0, stops, 0, 3)).toEqual({ x: 0, y: 0 });
    expect(followOffset(1 - MOVE_SECONDS / 2, stops, 0, 3)).toEqual({ x: 0, y: 0 });
    expect(followOffset(1, stops, 0, 3).x).toBeCloseTo(9);
    expect(followOffset(1.5, stops, 0, 3)).toEqual({ x: 18, y: 0 });
    expect(followOffset(2, stops, 0, 3).y).toBeCloseTo(9);
    expect(followOffset(3, stops, 0, 3)).toEqual({ x: 18, y: 18 });
    // 时间窗极短或没有停留点时不出错
    expect(followOffset(1, stops, 2, 2)).toEqual({ x: 0, y: 0 });
    expect(followOffset(1, [], 0, 3)).toEqual({ x: 0, y: 0 });
  });

  it('T-TPL-C045-8 整体的不透明度：首末各一帧为 0，停留阶段为 1', () => {
    const d = defaultParams(defs);
    const w = overlayWindows(60, d.inDuration as number, d.hold as number, d.outDuration as number);
    const a = (t: number) => progress(t, w.in) * (1 - progress(t, w.out));
    expect(w.duration).toBeCloseTo(3.4);
    expect(a(0)).toBe(0);
    expect(a(1 / 60)).toBe(0);
    expect(a(w.duration)).toBe(0);
    expect(a(w.duration - 1 / 60)).toBe(0);
    expect(a(0.2)).toBe(1);
    expect(a(1.7)).toBe(1);
    expect(a(0.1)).toBeGreaterThan(0);
    expect(a(0.1)).toBeLessThan(1);
  });
});
