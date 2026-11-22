// 017 传送门穿越 allay.builtin.portal-gate 的验收测试（docs/template-catalog.md 第 2 节、docs/templates/portal-gate.md）。
// 画面本身（首末帧透明、剪辑点不透明、同一时刻两次渲染一致、三种画幅）由 test:engine 的 T-TPL-3、4、5 检查；这里测 manifest 和纯函数。
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { BUILD_ORDERS, coverDistance, FRAME_H, FRAME_W, frameCells, frameSize, inSchedule, scatter, TILE_DIV } from '../../packages/templates/portal-gate/src/layout';
import { applyPreset, defaultParams, localizePresetParams, parseManifest, sameValue, sanitizeParams, type ParamValue } from '../../packages/template-sdk/src/index';

const manifest = (() => {
  const r = parseManifest(JSON.parse(readFileSync(join(import.meta.dirname, '../../packages/templates/portal-gate/manifest.json'), 'utf8')));
  if (!r.ok) throw new Error(`manifest invalid: ${JSON.stringify(r)}`);
  return r.manifest;
})();
const defs = manifest.params ?? [];

/** 默认值和预设里出现的音效：都对照过本机游戏文件（26.3、26.2、1.21.1、1.20.1 的 sounds.json） */
const ALLOWED_SOUNDS = new Set<ParamValue>([null, 'minecraft:block.stone.place', 'minecraft:item.flintandsteel.use', 'minecraft:block.portal.trigger', 'minecraft:block.portal.travel']);
const SOUND_KEYS = defs.filter((d) => d.type === 'sound').map((d) => d.key);
const STAGES = [
  [1920, 1080],
  [1080, 1920],
  [1080, 1080],
] as const;

describe('T-TPL-C017 传送门穿越', () => {
  it('T-TPL-C017-1 manifest 合法：转场、标签 blocks 在前、三段时间线，默认参数清洗后不变，默认音效都对照过', () => {
    expect(manifest.id).toBe('allay.builtin.portal-gate');
    expect(manifest.category).toBe('transition');
    expect(manifest.tags?.[0]).toBe('blocks');
    expect(manifest.timeline?.segments.map((s) => s.param)).toEqual(['inDuration', 'hold', 'outDuration']);
    for (const locale of ['zh-CN', 'en'] as const) {
      const d = defaultParams(defs, { locale });
      expect(sanitizeParams(defs, d)).toEqual(d);
    }
    const d = defaultParams(defs);
    for (const k of SOUND_KEYS) expect(ALLOWED_SOUNDS.has(d[k]!), k).toBe(true);
    const order = defs.find((p) => p.key === 'buildOrder');
    expect(order?.type === 'enum' ? order.options.map((o) => o.value) : []).toEqual([...BUILD_ORDERS]);
    expect(order?.type === 'enum' && order.ui).toBe('pattern');
  });

  it('T-TPL-C017-2 每个自带预设都能载入：值经过清洗后不变，总时长在范围内，音效在允许的范围里', () => {
    expect(manifest.presets?.length).toBeGreaterThanOrEqual(2);
    for (const preset of manifest.presets ?? []) {
      const applied = applyPreset(defs, preset);
      for (const [k, v] of Object.entries(localizePresetParams(defs, preset.params, 'en'))) expect(sameValue(applied[k], v), `${preset.key}.${k}`).toBe(true);
      const total = (applied.inDuration as number) + (applied.hold as number) + (applied.outDuration as number);
      expect(total).toBeGreaterThanOrEqual(0.1);
      expect(total).toBeLessThanOrEqual(30);
      for (const k of SOUND_KEYS) expect(ALLOWED_SOUNDS.has(applied[k]!), `${preset.key}.${k}`).toBe(true);
    }
  });

  it('T-TPL-C017-3 门框：最小的 4 × 5（里面 2 × 3），连角 14 块，三种搭建顺序都是这 14 块、不重复', () => {
    expect([FRAME_W, FRAME_H]).toEqual([4, 5]);
    const key = (c: { x: number; y: number }) => `${c.x},${c.y}`;
    const all = new Set(frameCells('bottomUp').map(key));
    expect(all.size).toBe(14);
    for (const order of BUILD_ORDERS) {
      const cells = frameCells(order, Array.from({ length: 14 }, (_, i) => ((i * 7) % 14) / 14));
      expect(cells).toHaveLength(14);
      expect(new Set(cells.map(key))).toEqual(all);
    }
    // 都在外框上：x = ±1.5 或 y = ±2
    for (const c of frameCells('bottomUp')) expect(Math.abs(c.x) === 1.5 || Math.abs(c.y) === 2).toBe(true);
    // 先底后柱再封顶：前 4 块是底边，最后 4 块是顶边
    const b = frameCells('bottomUp');
    expect(b.slice(0, 4).every((c) => c.y === -2)).toBe(true);
    expect(b.slice(10).every((c) => c.y === 2)).toBe(true);
  });

  it('T-TPL-C017-4 进入阶段的时间：搭框在点火之前结束，传送门亮起后才推镜头，都在阶段里', () => {
    for (const igniteAt of [0.2, 0.3, 0.55, 0.8, 0.95]) {
      const s = inSchedule(igniteAt);
      expect(s.buildEnd).toBeLessThan(s.ignite);
      expect(s.zoomStart).toBeGreaterThan(s.ignite);
      expect(s.zoomStart).toBeLessThan(1);
      expect(s.ignite).toBeGreaterThanOrEqual(0.3);
      expect(s.ignite).toBeLessThanOrEqual(0.8);
    }
  });

  it('T-TPL-C017-5 推镜头的终点：传送门（2 × 3 格）铺满画面，宽高都只用到 97%；三种画幅门框都放得下', () => {
    for (const [w, h] of STAGES) {
      const b = frameSize(w, h);
      // 门框放得下：高不超过画面高的 66%，宽不超过画面宽的 80%
      expect(FRAME_H * b).toBeLessThanOrEqual(0.66 * h + 1e-9);
      expect(FRAME_W * b).toBeLessThanOrEqual(0.8 * w + 1e-9);
      const d = coverDistance(b, 40, w / h);
      const halfH = d * Math.tan((40 * Math.PI) / 360);
      const halfW = halfH * (w / h);
      expect(halfW).toBeLessThanOrEqual(0.97 * b + 1e-9);
      expect(halfH).toBeLessThanOrEqual(0.97 * 1.5 * b + 1e-9);
      // 其中一个方向正好 97%
      expect(Math.max(halfW / b, halfH / (1.5 * b))).toBeCloseTo(0.97);
    }
  });

  it('T-TPL-C017-6 穿过时碎片：每格 4 × 4 块；沿离开中心的方向往外、朝镜头走，进度为 0 时在原位', () => {
    expect(TILE_DIV).toBe(4);
    expect(scatter(10, 20, 1, 0, 100, 50, 0)).toEqual([10, 20, 0]);
    expect(scatter(10, 20, 0.6, 0.8, 100, 50, 1)).toEqual([70, 100, 50]);
  });
});
