// 018 矿道穿梭 allay.builtin.tunnel-rush 的验收测试（docs/template-catalog.md 第 2 节、docs/templates/tunnel-rush.md）。
// 画面本身（首末帧透明、剪辑点不透明、同一时刻两次渲染一致、三种画幅）由 test:engine 的 T-TPL-3、4、5 检查；这里测 manifest 和纯函数。
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { BLOCKS } from '../../packages/assets/src/index';
import { brightness, FOV, ORES, rushProgress, torchLight, torchSlices, tunnelLength, wallDistance, weightedPick } from '../../packages/templates/tunnel-rush/src/layout';
import { applyPreset, defaultParams, localizePresetParams, parseManifest, sameValue, sanitizeParams, type ParamValue } from '../../packages/template-sdk/src/index';

const manifest = (() => {
  const r = parseManifest(JSON.parse(readFileSync(join(import.meta.dirname, '../../packages/templates/tunnel-rush/manifest.json'), 'utf8')));
  if (!r.ok) throw new Error(`manifest invalid: ${JSON.stringify(r)}`);
  return r.manifest;
})();
const defs = manifest.params ?? [];

/** 默认值和预设里出现的音效：都对照过本机游戏文件（26.3、26.2、1.21.1、1.20.1 的 sounds.json） */
const ALLOWED_SOUNDS = new Set<ParamValue>([null, 'minecraft:entity.minecart.riding', 'minecraft:block.stone.break']);
const SOUND_KEYS = defs.filter((d) => d.type === 'sound').map((d) => d.key);

describe('T-TPL-C018 矿道穿梭', () => {
  it('T-TPL-C018-1 manifest 合法：转场、标签 blocks 在前、三段时间线，默认参数清洗后不变，默认音效都对照过', () => {
    expect(manifest.id).toBe('allay.builtin.tunnel-rush');
    expect(manifest.category).toBe('transition');
    expect(manifest.tags?.[0]).toBe('blocks');
    expect(manifest.timeline?.segments.map((s) => s.param)).toEqual(['inDuration', 'hold', 'outDuration']);
    for (const locale of ['zh-CN', 'en'] as const) {
      const d = defaultParams(defs, { locale });
      expect(sanitizeParams(defs, d)).toEqual(d);
    }
    const d = defaultParams(defs);
    for (const k of SOUND_KEYS) {
      expect(typeof d[k]).toBe('string');
      expect(ALLOWED_SOUNDS.has(d[k]!), k).toBe(true);
    }
  });

  it('T-TPL-C018-2 每个自带预设都能载入：值经过清洗后不变，总时长在范围内，音效在允许的范围里', () => {
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

  it('T-TPL-C018-3 矿石都在方块目录里；按权重挑的结果覆盖整个列表', () => {
    for (const o of ORES) expect(BLOCKS[o.id], o.id).toBeDefined();
    const seen = new Set<number>();
    for (let k = 0; k < 1000; k++) seen.add(weightedPick(ORES, k / 1000));
    expect(seen.size).toBe(ORES.length);
    expect(weightedPick(ORES, 0)).toBe(0);
    expect(weightedPick(ORES, 0.99999)).toBe(ORES.length - 1);
  });

  it('T-TPL-C018-4 撞上尽头时镜头离墙多近：墙（里面 size × size）铺满画面，宽高都只用到 97%；视野是游戏默认的 70°', () => {
    expect(FOV).toBe(70);
    for (const aspect of [16 / 9, 9 / 16, 1]) {
      for (const size of [2, 3, 5]) {
        const d = wallDistance(size, aspect);
        const halfH = d * Math.tan((FOV * Math.PI) / 360);
        const halfW = halfH * aspect;
        expect(halfW).toBeLessThanOrEqual(0.97 * (size / 2) + 1e-9);
        expect(halfH).toBeLessThanOrEqual(0.97 * (size / 2) + 1e-9);
      }
    }
  });

  it('T-TPL-C018-5 矿道长度和镜头的进度：长度随速度和时长、在 8–120 节之间；进度两端精确、单调', () => {
    expect(tunnelLength(30, 1.2)).toBe(25);
    expect(tunnelLength(10, 0.5)).toBe(8);
    expect(tunnelLength(60, 3)).toBe(120);
    expect(rushProgress(0)).toBe(0);
    expect(rushProgress(1)).toBe(1);
    let prev = 0;
    for (let k = 1; k <= 100; k++) {
      const v = rushProgress(k / 100);
      expect(v).toBeGreaterThan(prev);
      prev = v;
    }
  });

  it('T-TPL-C018-6 火把的光照：14 级、每格减 1；没有照到的地方用最低亮度；火把按间隔放、0 是不放', () => {
    expect(torchLight(0)).toBeCloseTo(14 / 15 / (4 - 3 * (14 / 15)));
    expect(torchLight(14)).toBe(0);
    expect(torchLight(20)).toBe(0);
    expect(torchLight(1)).toBeLessThan(torchLight(0));
    expect(brightness([30, 40], 0.28)).toBe(0.28);
    expect(brightness([0, 30], 0.28)).toBeCloseTo(torchLight(0));
    expect(torchSlices(25, 6)).toEqual([3, 9, 15, 21]);
    expect(torchSlices(25, 0)).toEqual([]);
  });
});
