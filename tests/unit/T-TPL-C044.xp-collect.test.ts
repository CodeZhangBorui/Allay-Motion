// 044 经验收集 allay.builtin.xp-collect 的验收测试（docs/template-catalog.md 第 2 节、docs/templates/xp-collect.md）。
// 画面本身（首末帧透明、同一时刻两次渲染一致、三种画幅）由 test:engine 的 T-TPL-3、4、5 检查；这里测 manifest 和纯函数。
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { overlayWindows, progress } from '../../packages/templates/_lib/src/timing';
import {
  ARRIVE_FROM,
  ARRIVE_TO,
  arrivalFraction,
  BAR_H,
  BAR_W,
  filledWidth,
  fitUnit,
  LEVEL_COLOR,
  levelPopScale,
  ORB_ORIGINS,
  orbAlpha,
  orbCell,
  orbIconIndex,
  orbPosition,
  orbStart,
  orbTint,
  POP_DURATION,
  sampleIndices,
  totalXp,
  xpForLevel,
  xpLayout,
  xpStateAfter,
} from '../../packages/templates/xp-collect/src/layout';
import { defaultParams, parseManifest, sameValue, sanitizeParams, type ParamValue } from '../../packages/template-sdk/src/index';

const manifest = (() => {
  const r = parseManifest(JSON.parse(readFileSync(join(import.meta.dirname, '../../packages/templates/xp-collect/manifest.json'), 'utf8')));
  if (!r.ok) throw new Error(`manifest invalid: ${JSON.stringify(r)}`);
  return r.manifest;
})();
const defs = manifest.params ?? [];

/** 默认音效和预设里的音效只能取这些（第 1 批的约定） */
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

describe('T-TPL-C044 经验收集', () => {
  it('T-TPL-C044-1 manifest 合法，默认参数能装载；等级数字默认是 #80FF20、黑色描边、没有阴影', () => {
    expect(manifest.id).toBe('allay.builtin.xp-collect');
    expect(manifest.category).toBe('overlay');
    expect(manifest.tags?.[0]).toBe('ui');
    const d = defaultParams(defs, { locale: 'zh-CN' });
    expect(sanitizeParams(defs, d)).toEqual(d);
    expect(manifest.timeline?.segments.map((s) => s.param)).toEqual(['inDuration', 'hold', 'outDuration']);
    expect(d.levelColor).toBe(LEVEL_COLOR);
    const font = d.levelFont as { shadow: boolean; outline: string | null };
    expect(font.shadow).toBe(false);
    expect(font.outline).toBe('#000000');
    expect(d.levelPop).toBe(false);
    expect(d.pickupSound).toBe('minecraft:entity.experience_orb.pickup');
    expect(d.levelupSound).toBe('minecraft:entity.player.levelup');
    const origin = defs.find((p) => p.key === 'orbOrigin');
    expect(origin?.type === 'enum' ? origin.options.map((o) => o.value) : []).toEqual([...ORB_ORIGINS]);
  });

  it('T-TPL-C044-2 每个自带预设都能载入：值经过清洗后不变，音效在允许的范围里', () => {
    expect(manifest.presets?.length).toBeGreaterThanOrEqual(3);
    for (const preset of manifest.presets ?? []) {
      const applied = sanitizeParams(defs, { ...defaultParams(defs), ...preset.params });
      for (const [k, v] of Object.entries(preset.params)) expect(sameValue(applied[k], v as ParamValue), `${preset.key}.${k}`).toBe(true);
      const total = (applied.inDuration as number) + (applied.hold as number) + (applied.outDuration as number);
      expect(total).toBeGreaterThanOrEqual(0.1);
      expect(total).toBeLessThanOrEqual(30);
      for (const key of ['pickupSound', 'levelupSound']) expect(ALLOWED_SOUNDS.has(applied[key]!), `${preset.key}.${key}`).toBe(true);
      // 预设确实有经验可收
      expect(totalXp(applied.levelFrom as number, applied.levels as number, applied.startProgress as number, applied.endProgress as number)).toBeGreaterThan(0);
    }
  });

  it('T-TPL-C044-3 版式：经验条 182 × 5，左边 ⌊w / 2⌋ − 91，上边 h − 29；等级数字上边 h − 35', () => {
    expect([BAR_W, BAR_H]).toEqual([182, 5]);
    // 1080p、界面缩放 5：界面 384 × 216
    const l = xpLayout(384, 216);
    expect(l.barX).toBe(192 - 91);
    expect(l.barTop).toBe(216 - 29);
    expect(l.levelTop).toBe(216 - 35);
    expect(l.levelCenterX).toBe(192);
    expect([l.targetX, l.targetY]).toEqual([192, 216 - 29 + 2.5]);
    // 数字（8 高）的下边压进经验条上边 2 个界面像素，和游戏一样
    expect(l.levelTop + 8 - l.barTop).toBe(2);
    // 高度不是整数时按整数算
    expect(xpLayout(384, 216.9).barTop).toBe(187);
    // 三种画幅：宽 1080 在界面缩放 5 时放得下，缩放 8 时整体缩小
    expect(fitUnit(1080, 5)).toBe(5);
    expect(fitUnit(1080, 8)).toBeCloseTo(1080 / 190);
  });

  it('T-TPL-C044-4 进度露出的像素数：⌊进度 × 183⌋，不超过 182', () => {
    expect(filledWidth(0)).toBe(0);
    expect(filledWidth(0.005)).toBe(0);
    expect(filledWidth(0.5)).toBe(91);
    expect(filledWidth(0.99)).toBe(181);
    expect(filledWidth(1)).toBe(182);
    expect(filledWidth(-3)).toBe(0);
    expect(filledWidth(Number.NaN)).toBe(0);
  });

  it('T-TPL-C044-5 升级所需经验：2L + 7（0–15）、5L − 38（16–30）、9L − 158（31 起）', () => {
    expect(xpForLevel(0)).toBe(7);
    expect(xpForLevel(15)).toBe(37);
    expect(xpForLevel(16)).toBe(42);
    expect(xpForLevel(29)).toBe(107);
    expect(xpForLevel(30)).toBe(112);
    expect(xpForLevel(31)).toBe(121);
    // 0 → 30 级一共 1395 点（Wiki 上的累计值）
    expect(totalXp(0, 30, 0, 0)).toBe(1395);
    // 不升级：只涨进度差；结束进度更小时不涨
    expect(totalXp(7, 0, 0.2, 0.6)).toBeCloseTo(0.4 * 21);
    expect(totalXp(7, 0, 0.6, 0.2)).toBe(0);
    // 跨一级：补满当前这一级，再加下一级的一部分
    expect(totalXp(29, 1, 0.35, 0.2)).toBeCloseTo(0.65 * 107 + 0.2 * 112);
  });

  it('T-TPL-C044-6 每到一个球加一份：满了升一级，条从头再涨；最后正好停在结束进度', () => {
    const [from, levels, start, end, orbs] = [12, 5, 0.5, 0.4, 30];
    const total = totalXp(from, levels, start, end);
    const states = Array.from({ length: orbs + 1 }, (_, k) => xpStateAfter(from, start, (total * k) / orbs, from + levels));
    expect(states[0]).toEqual({ level: 12, progress: 0.5 });
    expect(states[orbs]!.level).toBe(17);
    expect(states[orbs]!.progress).toBeCloseTo(0.4);
    for (let k = 1; k <= orbs; k++) {
      const [a, b] = [states[k - 1]!, states[k]!];
      // 等级不降；同一级里进度只涨
      expect(b.level).toBeGreaterThanOrEqual(a.level);
      if (b.level === a.level) expect(b.progress).toBeGreaterThan(a.progress);
    }
    // 正好补满一级时升级、进度归零（浮点误差不卡住）
    const exact = xpStateAfter(3, 0.25, 0.75 * xpForLevel(3), 4);
    expect(exact.level).toBe(4);
    expect(exact.progress).toBeCloseTo(0);
    // 不超过最高等级
    expect(xpStateAfter(0, 0, 1e6, 2)).toEqual({ level: 2, progress: 1 });
  });

  it('T-TPL-C044-7 经验球：大小的 11 个阈值、贴图里的格子、染色', () => {
    expect([1, 2, 3, 6, 7, 16, 17, 37, 73, 149, 307, 617, 1237, 2476, 2477, 99999].map(orbIconIndex)).toEqual([0, 0, 1, 1, 2, 2, 3, 4, 5, 6, 7, 8, 9, 9, 10, 10]);
    expect(orbIconIndex(0)).toBe(0);
    expect(orbCell(0)).toEqual([0, 0, 16, 16]);
    expect(orbCell(3)).toEqual([48, 0, 16, 16]);
    expect(orbCell(4)).toEqual([0, 16, 16, 16]);
    expect(orbCell(10)).toEqual([32, 32, 16, 16]);
    // 绿恒为 1，红 0–1，蓝 0–0.2
    const [r0, g0, b0] = orbTint(0);
    expect(r0).toBeCloseTo(0.5);
    expect(g0).toBe(1);
    expect(b0).toBeCloseTo((Math.sin((4 * Math.PI) / 3) + 1) * 0.1);
    for (let tick = 0; tick < 60; tick++) {
      const [r, g, b] = orbTint(tick);
      expect(r).toBeGreaterThanOrEqual(0);
      expect(r).toBeLessThanOrEqual(1);
      expect(g).toBe(1);
      expect(b).toBeGreaterThanOrEqual(0);
      expect(b).toBeLessThanOrEqual(0.2 + 1e-9);
    }
  });

  it('T-TPL-C044-8 经验球的飞行：到达时刻有序地落在停留的 15%–80%，路径从出发点到经验条正中', () => {
    for (const n of [1, 5, 40]) {
      let prev = ARRIVE_FROM;
      for (let k = 0; k < n; k++) {
        const lo = arrivalFraction(k, n, -0.4);
        const hi = arrivalFraction(k, n, 0.4);
        expect(lo).toBeGreaterThanOrEqual(prev);
        expect(hi).toBeGreaterThan(lo);
        expect(hi).toBeLessThanOrEqual(ARRIVE_TO);
        prev = hi;
      }
    }
    const [w, h, size] = [384, 216, 9];
    const target = { x: 192, y: 189.5 };
    for (const origin of ORB_ORIGINS) {
      for (const [r1, r2] of [
        [0, 0],
        [0.3, 0.9],
        [0.6, 0.5],
        [0.99, 0.99],
      ] as const) {
        const start = orbStart(origin, w, h, r1, r2, size);
        // 从画面外来的三种出发点整个球都在画面外；center 在画面里
        const outside = start.x <= -size || start.x >= w + size || start.y <= -size;
        expect(outside, `${origin} ${r1} ${r2}`).toBe(origin !== 'center');
        expect(orbPosition(0, start, target, 0.1)).toEqual(start);
        const end = orbPosition(1, start, target, 0.1);
        expect(end.x).toBeCloseTo(target.x);
        expect(end.y).toBeCloseTo(target.y);
        // 加速：时间过半时走了不到一半的直线距离（弧高为 0 时）
        const mid = orbPosition(0.5, start, target, 0);
        expect(Math.hypot(mid.x - start.x, mid.y - start.y)).toBeCloseTo(0.25 * Math.hypot(target.x - start.x, target.y - start.y));
      }
    }
    expect(orbAlpha(0)).toBe(0);
    expect(orbAlpha(1)).toBe(0);
    expect(orbAlpha(-0.5)).toBe(0);
    expect(orbAlpha(0.5)).toBe(1);
    expect(orbAlpha(0.05)).toBeCloseTo(0.5);
    expect(orbAlpha(0.94)).toBeCloseTo(0.5);
  });

  it('T-TPL-C044-9 “跳一下”、音效抽样、整体不透明度', () => {
    expect(levelPopScale(-1)).toBe(1);
    expect(levelPopScale(0)).toBeCloseTo(1.4);
    expect(levelPopScale(POP_DURATION / 2)).toBeCloseTo(1.1);
    expect(levelPopScale(POP_DURATION)).toBe(1);
    expect(levelPopScale(Number.POSITIVE_INFINITY)).toBe(1);
    // 同一种声音最多 12 个：少于 12 个全取，多了均匀抽（含首尾，不重复）
    expect(sampleIndices(5, 12)).toEqual([0, 1, 2, 3, 4]);
    const sampled = sampleIndices(40, 12);
    expect(sampled).toHaveLength(12);
    expect(sampled[0]).toBe(0);
    expect(sampled[11]).toBe(39);
    expect(new Set(sampled).size).toBe(12);
    // 首末各一帧全透明
    const w = overlayWindows(60, 0.25, 3, 0.25);
    const a = (t: number) => progress(t, w.in) * (1 - progress(t, w.out));
    expect(a(0)).toBe(0);
    expect(a(1 / 60)).toBe(0);
    expect(a(w.duration - 1 / 60)).toBe(0);
    expect(a(w.duration)).toBe(0);
    expect(a(1.5)).toBe(1);
  });
});
