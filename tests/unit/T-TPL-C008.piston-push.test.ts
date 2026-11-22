// 008 活塞合拢 allay.builtin.piston-push 的验收测试（docs/template-catalog.md 第 2 节、docs/templates/piston-push.md）。
// 画面本身（首末帧透明、剪辑点不透明、同一时刻两次渲染一致、三种画幅）由 test:engine 的 T-TPL-3、4、5 检查；这里测 manifest 和纯函数。
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { AXES, emptyRowState, MIN_CELLS, pistonGrid, placeTick, PUSH_TICKS, pushTicks, rowSchedule, rowState, rowTicks } from '../../packages/templates/piston-push/src/layout';
import { applyPreset, defaultParams, localizePresetParams, parseManifest, sameValue, sanitizeParams, type ParamValue } from '../../packages/template-sdk/src/index';

const manifest = (() => {
  const r = parseManifest(JSON.parse(readFileSync(join(import.meta.dirname, '../../packages/templates/piston-push/manifest.json'), 'utf8')));
  if (!r.ok) throw new Error(`manifest invalid: ${JSON.stringify(r)}`);
  return r.manifest;
})();
const defs = manifest.params ?? [];

/** 默认值和预设里出现的音效：都对照过本机游戏文件（26.3、26.2、1.21.1、1.20.1 的 sounds.json） */
const ALLOWED_SOUNDS = new Set<ParamValue>([null, 'minecraft:block.piston.extend', 'minecraft:block.piston.contract']);
const SOUND_KEYS = defs.filter((d) => d.type === 'sound').map((d) => d.key);
const STAGES = [
  [1920, 1080],
  [1080, 1920],
  [1080, 1080],
] as const;

describe('T-TPL-C008 活塞合拢', () => {
  it('T-TPL-C008-1 manifest 合法：转场、标签 blocks 在前、三段时间线，默认参数清洗后不变，默认音效都对照过', () => {
    expect(manifest.id).toBe('allay.builtin.piston-push');
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
    const axis = defs.find((p) => p.key === 'axis');
    expect(axis?.type === 'enum' ? axis.options.map((o) => o.value) : []).toEqual([...AXES]);
  });

  it('T-TPL-C008-2 每个自带预设都能载入：值经过清洗后不变，总时长在范围内，音效在允许的范围里', () => {
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

  it('T-TPL-C008-3 格子：三种画幅都铺满（排向多 1%、推送方向从中线到边上），每边至少三格；auto 沿长边推', () => {
    for (const [w, h] of STAGES) {
      for (const axis of AXES) {
        for (const rows of [2, 4, 12]) {
          const g = pistonGrid(w, h, axis, rows);
          const along = g.horizontal ? w : h;
          const across = g.horizontal ? h : w;
          expect(g.rows * g.size).toBeGreaterThanOrEqual(across * 1.01 - 1e-9);
          expect(g.cells * g.size).toBeGreaterThanOrEqual(along / 2 - 1e-9);
          expect(g.cells).toBeGreaterThanOrEqual(MIN_CELLS);
          expect(g.rows).toBeGreaterThanOrEqual(rows);
        }
      }
    }
    expect(pistonGrid(1920, 1080, 'auto', 4).horizontal).toBe(true);
    expect(pistonGrid(1080, 1920, 'auto', 4).horizontal).toBe(false);
    // 方屏 4 排推不了两格：自动加到 5 排
    expect(pistonGrid(1080, 1080, 'auto', 4).rows).toBe(5);
  });

  it('T-TPL-C008-4 活塞的刻：伸出、收回各 2 刻（游戏里活塞每刻走半格），放一块方块 1 刻，一排共 2 + (m − 1) + 4 (m − 2) 刻', () => {
    expect(PUSH_TICKS).toBe(2);
    expect(rowTicks(4)).toBe(2 + 3 + 8);
    expect(placeTick(1)).toBe(2);
    expect(placeTick(2)).toBe(2 + 1 + 4);
    const pushes = pushTicks(4);
    expect(pushes).toEqual([
      { extend: 3, retract: 5 },
      { extend: 8, retract: 10 },
    ]);
  });

  it('T-TPL-C008-5 一排的过程：活塞滑进最外一格，方块在活塞前出现、被一格格推到中线，最后一块挨着活塞；推送是匀速的', () => {
    const m = 4;
    const s = emptyRowState(m);
    rowState(0, m, s);
    expect(s.pistonCell).toBe(m);
    expect(Number.isNaN(s.blockCell[0]!)).toBe(true);
    rowState(rowTicks(m), m, s);
    expect(s.pistonCell).toBe(m - 1);
    expect(s.head).toBe(0);
    // 第 j 块停在第 j − 1 格：第一块在中线
    expect(Array.from(s.blockCell)).toEqual([0, 1, 2]);
    expect(Array.from(s.blockPop)).toEqual([1, 1, 1]);
    // 第一次推送进行到一半：活塞头伸出半格，第一块方块走了半格
    rowState(3 + 1, m, s);
    expect(s.head).toBeCloseTo(0.5);
    expect(s.blockCell[0]).toBeCloseTo(m - 2 - 0.5);
    // 收回到一半：方块不动
    rowState(5 + 1, m, s);
    expect(s.head).toBeCloseTo(0.5);
    expect(s.blockCell[0]).toBeCloseTo(m - 3);
    // 任何时候方块都不重叠、不越过中线
    for (let tau = 0; tau <= rowTicks(m); tau += 0.1) {
      rowState(tau, m, s);
      const cells = Array.from(s.blockCell).filter((c) => !Number.isNaN(c));
      for (let k = 1; k < cells.length; k++) expect(cells[k]! - cells[k - 1]!).toBeGreaterThanOrEqual(1 - 1e-9);
      for (const c of cells) expect(c).toBeGreaterThanOrEqual(-1e-9);
    }
  });

  it('T-TPL-C008-6 各排的先后：最后一排恰好在阶段末做完；不错开时所有排同时动', () => {
    for (const rows of [2, 4, 9]) {
      for (const stagger of [0, 0.35, 1]) {
        const r = rowSchedule(rows, stagger);
        expect(r.start[0]).toBe(0);
        expect(r.start[rows - 1]! + r.length).toBeCloseTo(1, 9);
        if (stagger === 0) expect(r.length).toBe(1);
      }
    }
  });
});
