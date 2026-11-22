// 007 挖掘裂纹 allay.builtin.mining-crack 的验收测试（docs/template-catalog.md 第 2 节、docs/templates/mining-crack.md）。
// 画面本身（首末帧透明、剪辑点不透明、同一时刻两次渲染一致、三种画幅）由 test:engine 的 T-TPL-3、4、5 检查；这里测 manifest 和纯函数。
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { wallGrid } from '../../packages/templates/_lib/src/block-kit';
import { transitionWindows } from '../../packages/templates/_lib/src/timing';
import {
  BREAK_ORDERS,
  breakTiming,
  builderOrder,
  CRACK_STAGES,
  crackStage,
  DEBRIS_BUDGET,
  debrisPerBlock,
  debrisVelocity,
  HIT_INTERVAL,
  hitTimes,
  INSTANCE_BUDGET,
  PLACE_ORDERS,
  placeScale,
} from '../../packages/templates/mining-crack/src/layout';
import { applyPreset, defaultParams, localizePresetParams, parseManifest, sameValue, sanitizeParams, type ParamValue } from '../../packages/template-sdk/src/index';

const manifest = (() => {
  const r = parseManifest(JSON.parse(readFileSync(join(import.meta.dirname, '../../packages/templates/mining-crack/manifest.json'), 'utf8')));
  if (!r.ok) throw new Error(`manifest invalid: ${JSON.stringify(r)}`);
  return r.manifest;
})();
const defs = manifest.params ?? [];

/** 默认值和预设里出现的音效：都对照过本机游戏文件（26.3、26.2、1.21.1、1.20.1 的 sounds.json 里有这个事件） */
const ALLOWED_SOUNDS = new Set<ParamValue>([
  null,
  'minecraft:block.stone.place',
  'minecraft:block.stone.hit',
  'minecraft:block.stone.break',
  'minecraft:block.glass.place',
  'minecraft:block.glass.hit',
  'minecraft:block.glass.break',
  'minecraft:block.wood.place',
  'minecraft:block.wood.hit',
  'minecraft:block.wood.break',
]);
const SOUND_KEYS = defs.filter((d) => d.type === 'sound').map((d) => d.key);

const enumValues = (key: string) => {
  const def = defs.find((p) => p.key === key);
  return def?.type === 'enum' ? def.options.map((o) => o.value) : [];
};

/** 三种画幅的舞台（设计单位） */
const STAGES = [
  [1920, 1080],
  [1080, 1920],
  [1080, 1080],
] as const;

describe('T-TPL-C007 挖掘裂纹', () => {
  it('T-TPL-C007-1 manifest 合法：转场、标签 blocks 在前、三段时间线，默认参数清洗后不变，默认音效都对照过游戏文件', () => {
    expect(manifest.id).toBe('allay.builtin.mining-crack');
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
    // 顺序类的选项和代码里的一致，每个都有 16 格的图案
    expect(enumValues('placeOrder')).toEqual([...PLACE_ORDERS]);
    expect(enumValues('breakOrder')).toEqual([...BREAK_ORDERS]);
    for (const key of ['arrangement', 'placeOrder', 'breakOrder']) {
      const def = defs.find((p) => p.key === key);
      expect(def?.type === 'enum' && def.ui).toBe('pattern');
      if (def?.type === 'enum') for (const o of def.options) expect(o.pattern).toHaveLength(16);
    }
  });

  it('T-TPL-C007-2 每个自带预设都能载入：值经过清洗后不变，总时长在范围内，音效在允许的范围里', () => {
    const keys = (manifest.presets ?? []).map((p) => p.key);
    // 目录 1.9 给这个模板列的三个预设
    for (const k of ['diamond-ore', 'obsidian', 'glass']) expect(keys).toContain(k);
    for (const preset of manifest.presets ?? []) {
      const applied = applyPreset(defs, preset);
      for (const [k, v] of Object.entries(localizePresetParams(defs, preset.params, 'en'))) expect(sameValue(applied[k], v), `${preset.key}.${k}`).toBe(true);
      const total = (applied.inDuration as number) + (applied.hold as number) + (applied.outDuration as number);
      expect(total).toBeGreaterThanOrEqual(0.1);
      expect(total).toBeLessThanOrEqual(30);
      for (const k of SOUND_KEYS) expect(ALLOWED_SOUNDS.has(applied[k]!), `${preset.key}.${k}`).toBe(true);
    }
    // 黑曜石裂得慢、玻璃一下就碎
    const crack = (key: string) => (manifest.presets!.find((p) => p.key === key)!.params.crackTime as number);
    expect(crack('obsidian')).toBeGreaterThan(defaultParams(defs).crackTime as number);
    expect(crack('glass')).toBeLessThanOrEqual(0.05);
  });

  it('T-TPL-C007-3 裂纹十级：开挖前 -1，裂纹时长里均分 0–9 级，到时碎掉；敲击声每 4 刻一下', () => {
    expect(CRACK_STAGES).toBe(10);
    const start = 1;
    const crack = 0.5;
    expect(crackStage(0.99, start, crack)).toBe(-1);
    expect(crackStage(1, start, crack)).toBe(0);
    const seen = new Set<number>();
    for (let i = 0; i < 100; i++) seen.add(crackStage(start + (i / 100) * crack, start, crack));
    expect([...seen].sort((a, b) => a - b)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
    // 每级占十分之一
    expect(crackStage(start + crack * 0.29, start, crack)).toBe(2);
    expect(crackStage(start + crack * 0.31, start, crack)).toBe(3);
    expect(crackStage(start + crack, start, crack)).toBe(10);
    expect(HIT_INTERVAL).toBeCloseTo(0.2);
    expect(hitTimes(1, 0.5)).toEqual([1, 1.2, 1.4].map((x) => expect.closeTo(x, 9)));
    expect(hitTimes(1, 0.05)).toHaveLength(1);
  });

  it('T-TPL-C007-4 退出阶段的时间分配：错落 + 裂纹 + 碎屑寿命不超过阶段长度；一起挖时错落很小', () => {
    for (const outLen of [0.28, 0.6, 1.08, 2.2, 3.98]) {
      for (const crackTime of [0.05, 0.3, 1.2, 2]) {
        for (const together of [false, true]) {
          const b = breakTiming(outLen, crackTime, together);
          expect(b.spread + b.crack + b.life).toBeLessThanOrEqual(outLen + 1e-9);
          expect(b.crack).toBeGreaterThan(0);
          expect(b.life).toBeGreaterThan(0);
          expect(b.spread).toBeGreaterThanOrEqual(0);
          if (together) expect(b.spread).toBeLessThanOrEqual(0.12);
        }
      }
    }
    // 阶段够长时裂纹时长照参数
    expect(breakTiming(2, 0.3, false).crack).toBe(0.3);
    // 默认参数在 60 fps 下：退出阶段 1.1 − 1/60 秒
    const w = transitionWindows(60, 0.6, 0.15, 1.1);
    const b = breakTiming(w.out.end - w.out.start, 0.3, false);
    expect(b.crack).toBe(0.3);
    expect(b.spread).toBeGreaterThan(0.2);
  });

  it('T-TPL-C007-5 放置顺序：从下往上砌是蛇形，一列列垒是每列从下往上', () => {
    const rank = (u: Float64Array, n: number) => Array.from(u, (x) => Math.round(x * (n - 1)));
    // 3 列 2 行：r = 0 是上面一行
    expect(rank(builderOrder('buildUp', 3, 2), 6)).toEqual([5, 4, 3, 0, 1, 2]);
    expect(rank(builderOrder('columns', 3, 2), 6)).toEqual([1, 3, 5, 0, 2, 4]);
    // 每个格子的顺序值各不相同（一块块放）
    const u = builderOrder('buildUp', 10, 7);
    expect(new Set(u).size).toBe(70);
  });

  it('T-TPL-C007-6 实例预算：三种画幅、列数取到两端时，方块 + 垫底 + 裂纹 + 碎屑不超过 5000', () => {
    for (const [w, h] of STAGES) {
      for (const cols of [4, 10, 24]) {
        const n = wallGrid(w, h, cols).count;
        const d = debrisPerBlock(32, n);
        expect(3 * n + d * n, `${w}x${h} cols ${cols}`).toBeLessThanOrEqual(INSTANCE_BUDGET);
        expect(d * n).toBeLessThanOrEqual(DEBRIS_BUDGET);
      }
    }
    // 方块不多时照参数
    expect(debrisPerBlock(8, 70)).toBe(8);
    expect(debrisPerBlock(0, 70)).toBe(0);
  });

  it('T-TPL-C007-7 碎屑的初速度：总体向外、带向上的分量；弹出的缩放端点精确', () => {
    for (let k = 0; k < 50; k++) {
      const r = [k / 50, (k * 7) % 50 / 50, (k * 13) % 50 / 50, (k * 17) % 50 / 50, (k * 31) % 50 / 50];
      const [vx, vy, vz] = debrisVelocity(0.4, 0, 0, r);
      const horizontal = Math.hypot(vx, vz);
      // 速率 1.2–3.6 格每秒，再加向上 2 格每秒
      expect(Math.hypot(vx, vy - 2, vz)).toBeGreaterThanOrEqual(1.2 - 1e-9);
      expect(Math.hypot(vx, vy - 2, vz)).toBeLessThanOrEqual(3.6 + 1e-9);
      expect(horizontal).toBeGreaterThan(0);
    }
    const backOut = (x: number) => 1 + 2.70158 * (x - 1) ** 3 + 1.70158 * (x - 1) ** 2;
    expect(placeScale(0, backOut)).toBe(0);
    expect(placeScale(1, backOut)).toBe(1);
    expect(placeScale(0.5, backOut)).toBeGreaterThan(0.6);
  });
});
