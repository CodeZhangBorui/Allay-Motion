// 043 状态栏 allay.builtin.hud-status 的验收测试（docs/template-catalog.md 第 2 节、docs/templates/hud-status.md）。
// 画面本身（首末帧透明、同一时刻两次渲染一致、三种画幅）由 test:engine 的 T-TPL-3、4、5 检查；这里测 manifest 和纯函数。
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { overlayWindows, progress } from '../../packages/templates/_lib/src/timing';
import {
  airBubbles,
  airTop,
  armorTop,
  armorX,
  ATLAS,
  atlasHeartRegion,
  blinkOn,
  blockHeight,
  foodShakes,
  gameFrame,
  healthAt,
  heartCounts,
  heartPos,
  heartPrefix,
  heartRows,
  heartsShake,
  heartState,
  pointState,
  regenIndex,
  rightX,
  rowGap,
} from '../../packages/templates/hud-status/src/layout';
import { defaultParams, parseManifest, sameValue, sanitizeParams, type ParamValue } from '../../packages/template-sdk/src/index';

const manifest = (() => {
  const r = parseManifest(JSON.parse(readFileSync(join(import.meta.dirname, '../../packages/templates/hud-status/manifest.json'), 'utf8')));
  if (!r.ok) throw new Error(`manifest invalid: ${JSON.stringify(r)}`);
  return r.manifest;
})();
const defs = manifest.params ?? [];

/** 默认值和预设里出现的音效：都对照过本机游戏文件（26.3 和 1.21.1 的 sounds.json 里有这个事件） */
const ALLOWED_SOUNDS = new Set<ParamValue>([
  null,
  'minecraft:entity.player.hurt',
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

describe('T-TPL-C043 状态栏', () => {
  it('T-TPL-C043-1 manifest 合法，默认参数清洗后不变，时间线是三段', () => {
    expect(manifest.id).toBe('allay.builtin.hud-status');
    expect(manifest.category).toBe('overlay');
    expect(manifest.tags?.[0]).toBe('ui');
    const d = defaultParams(defs, { locale: 'zh-CN' });
    expect(sanitizeParams(defs, d)).toEqual(d);
    expect(manifest.timeline?.segments.map((s) => s.param)).toEqual(['inDuration', 'hold', 'outDuration']);
    expect(ALLOWED_SOUNDS.has(d.hurtSound ?? null)).toBe(true);
    // 游戏里的默认状态：10 颗心、空气满（不显示）
    expect(d.maxHealth).toBe(20);
    expect(d.air).toBe(300);
    expect(d.anchor).toBe('game');
  });

  it('T-TPL-C043-2 每个自带预设都能载入：值经过清洗后不变', () => {
    expect(manifest.presets?.length).toBeGreaterThanOrEqual(3);
    for (const preset of manifest.presets ?? []) {
      const applied = sanitizeParams(defs, { ...defaultParams(defs), ...preset.params });
      for (const [k, v] of Object.entries(preset.params)) expect(sameValue(applied[k], v as ParamValue), `${preset.key}.${k}`).toBe(true);
      expect(ALLOWED_SOUNDS.has(applied.hurtSound ?? null), preset.key).toBe(true);
      const total = (applied.inDuration as number) + (applied.hold as number) + (applied.outDuration as number);
      expect(total).toBeGreaterThanOrEqual(0.1);
      expect(total).toBeLessThanOrEqual(30);
    }
  });

  it('T-TPL-C043-3 版式：1080p、界面缩放 6（320 × 180）时各排图标的位置', () => {
    const f = gameFrame(320, 180);
    expect(f).toEqual({ left: 160 - 91, right: 160 + 91, baseY: 180 - 39 });
    // 宽度为奇数时中心按整数除法
    expect(gameFrame(321, 180).left).toBe(160 - 91);
    // 10 颗心一排，相邻 8 个界面像素
    const { normal, total } = heartCounts(20, 0);
    expect([normal, total]).toEqual([10, 10]);
    const gap = rowGap(heartRows(total));
    // 只有一排时公式给 11，但用不到（排距只在第二排起才乘上去）
    expect(gap).toBe(11);
    expect(heartPos(0, f.left, f.baseY, gap)).toEqual({ x: 69, y: 141 });
    expect(heartPos(9, f.left, f.baseY, gap)).toEqual({ x: 69 + 72, y: 141 });
    // 护甲在心的上方 10；饥饿从右往左排，最右一个的右边正好是右边界
    expect(armorTop(f.baseY, 1, gap)).toBe(131);
    expect(armorX(3, f.left)).toBe(69 + 24);
    expect(rightX(0, f.right)).toBe(251 - 9);
    expect(rightX(9, f.right)).toBe(251 - 72 - 9);
    expect(airTop(f.baseY)).toBe(131);
    // 左边 10 颗心和右边 10 个饥饿图标之间不重叠
    expect(heartPos(9, f.left, f.baseY, gap).x + 9).toBeLessThan(rightX(9, f.right));
  });

  it('T-TPL-C043-4 多排的心：排距随排数收紧，吸收的心接在后面，护甲跟着上移', () => {
    expect(heartCounts(20, 4)).toEqual({ normal: 10, total: 12 });
    expect(heartCounts(40, 20)).toEqual({ normal: 20, total: 30 });
    expect(heartCounts(19, 1)).toEqual({ normal: 10, total: 11 });
    expect([1, 2, 3, 4, 9, 20].map(rowGap)).toEqual([11, 10, 9, 8, 3, 3]);
    // 单排时不会用到排距；两排是 10
    expect(heartPos(10, 69, 141, 10)).toEqual({ x: 69, y: 131 });
    expect(heartPos(25, 69, 141, 9)).toEqual({ x: 69 + 40, y: 141 - 18 });
    expect(armorTop(141, 3, 9)).toBe(141 - 18 - 10);
    // 外框高度：一排是 9；有护甲或空气时多 10；三排（排距 9）加护甲是 9 + 18 + 10
    expect(blockHeight(1, 11, false, false)).toBe(9);
    expect(blockHeight(1, 11, true, false)).toBe(19);
    expect(blockHeight(1, 11, false, true)).toBe(19);
    expect(blockHeight(3, 9, true, true)).toBe(37);
  });

  it('T-TPL-C043-5 满、半、空：心、护甲、饥饿、空气泡', () => {
    // 生命 7：前 3 颗满，第 4 颗半，其余不画
    expect([0, 1, 2, 3, 4, 9].map((i) => heartState(i, 7))).toEqual(['full', 'full', 'full', 'half', 'empty', 'empty']);
    expect(heartState(0, 0)).toBe('empty');
    expect(heartState(9, 20)).toBe('full');
    // 护甲 15：7 个满、1 个半、2 个空
    expect(Array.from({ length: 10 }, (_, i) => pointState(i, 15))).toEqual([...Array<string>(7).fill('full'), 'half', 'empty', 'empty']);
    expect(pointState(0, 0)).toBe('empty');
    // 空气泡：满 300 时 10 个；每 30 刻少一个，少之前的 2 刻是破裂的样子
    expect(airBubbles(300)).toEqual({ full: 10, bursting: 0 });
    expect(airBubbles(272)).toEqual({ full: 9, bursting: 1 });
    expect(airBubbles(271)).toEqual({ full: 9, bursting: 1 });
    expect(airBubbles(270)).toEqual({ full: 9, bursting: 0 });
    expect(airBubbles(90)).toEqual({ full: 3, bursting: 0 });
    expect(airBubbles(1)).toEqual({ full: 0, bursting: 1 });
    expect(airBubbles(0)).toEqual({ full: 0, bursting: 0 });
  });

  it('T-TPL-C043-6 闪白：掉血 20 刻、回血 10 刻，剩余刻数 / 3 是奇数时亮；变化前的值保留 20 刻', () => {
    // 掉血：剩余 20…1 → 亮的是剩余 17–15、11–9、5–3，也就是变化后的第 3–5、9–11、15–17 刻
    const on = Array.from({ length: 22 }, (_, k) => blinkOn(k, true));
    expect(on.flatMap((v, k) => (v ? [k] : []))).toEqual([3, 4, 5, 9, 10, 11, 15, 16, 17]);
    // 回血：剩余 10…1 → 亮的是剩余 5–3 和 11–9 里落在 10 以内的 10、9
    const heal = Array.from({ length: 12 }, (_, k) => blinkOn(k, false));
    expect(heal.flatMap((v, k) => (v ? [k] : []))).toEqual([0, 1, 5, 6, 7]);
    expect(blinkOn(-1, true)).toBe(false);
    expect(blinkOn(20, true)).toBe(false);
    expect(healthAt(-1, 20, 7)).toEqual({ health: 20, display: 20 });
    expect(healthAt(0, 20, 7)).toEqual({ health: 7, display: 20 });
    expect(healthAt(19, 20, 7)).toEqual({ health: 7, display: 20 });
    expect(healthAt(20, 20, 7)).toEqual({ health: 7, display: 7 });
  });

  it('T-TPL-C043-7 抖动和波浪的条件', () => {
    expect(heartsShake(4, 0)).toBe(true);
    expect(heartsShake(5, 0)).toBe(false);
    expect(heartsShake(2, 4)).toBe(false);
    // 生命恢复：周期是生命上限 + 5 刻，序号超出心的个数的那些刻没有心被抬起
    expect(regenIndex(0, 20)).toBe(0);
    expect(regenIndex(9, 20)).toBe(9);
    expect(regenIndex(24, 20)).toBe(24);
    expect(regenIndex(25, 20)).toBe(0);
    // 饱和度耗尽：每 饥饿值 × 3 + 1 刻抖一次
    expect([0, 1, 18, 19, 38].map((k) => foodShakes(k, 6))).toEqual([true, false, false, true, true]);
    expect(foodShakes(7, 0)).toBe(true);
  });

  it('T-TPL-C043-8 贴图名和旧图集里的位置', () => {
    expect(heartPrefix('normal', false)).toBe('');
    expect(heartPrefix('normal', true)).toBe('hardcore_');
    expect(heartPrefix('poisoned', true)).toBe('poisoned_hardcore_');
    expect(heartPrefix('absorbing', false)).toBe('absorbing_');
    expect(heartPrefix('frozen', true)).toBe('frozen_hardcore_');
    expect(atlasHeartRegion('normal', false, false, false)).toEqual([52, 0, 9, 9]);
    expect(atlasHeartRegion('normal', true, false, false)).toEqual([61, 0, 9, 9]);
    expect(atlasHeartRegion('normal', false, true, false)).toEqual([70, 0, 9, 9]);
    expect(atlasHeartRegion('normal', true, true, false)).toEqual([79, 0, 9, 9]);
    expect(atlasHeartRegion('poisoned', false, true, false)).toEqual([106, 0, 9, 9]);
    // 没核对过位置的闪白变体退回不闪的那张
    expect(atlasHeartRegion('poisoned', true, true, false)).toEqual([97, 0, 9, 9]);
    expect(atlasHeartRegion('withered', false, true, false)).toEqual([124, 0, 9, 9]);
    expect(atlasHeartRegion('frozen', true, true, true)).toEqual([187, 45, 9, 9]);
    expect(atlasHeartRegion('absorbing', false, false, true)).toEqual([160, 45, 9, 9]);
    expect(ATLAS.container).toEqual([16, 0, 9, 9]);
    expect(ATLAS.armor_full).toEqual([34, 9, 9, 9]);
    expect(ATLAS.food_full_hunger).toEqual([88, 27, 9, 9]);
    expect(ATLAS.air_bursting).toEqual([25, 18, 9, 9]);
    expect(ATLAS.air_empty).toBeUndefined();
  });

  it('T-TPL-C043-9 整体的不透明度：首末帧为 0，停留阶段为 1', () => {
    const w = overlayWindows(60, 0.25, 3.5, 0.25);
    const a = (t: number) => progress(t, w.in) * (1 - progress(t, w.out));
    expect(w.duration).toBe(4);
    expect(a(0)).toBe(0);
    expect(a(1 / 60)).toBe(0);
    expect(a(w.duration - 1 / 60)).toBe(0);
    expect(a(w.duration)).toBe(0);
    expect(a(2)).toBe(1);
    expect(a(0.1)).toBeGreaterThan(0);
    expect(a(0.1)).toBeLessThan(a(0.2));
  });
});
