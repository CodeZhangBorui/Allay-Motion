// 016 藤蔓蔓生 allay.builtin.vine-overgrow 的验收测试（docs/template-catalog.md 第 2 节、docs/templates/vine-overgrow.md）。
// 画面本身（首末帧透明、剪辑点不透明、同一时刻两次渲染一致、三种画幅）由 test:engine 的 T-TPL-3、4、5 检查；这里测 manifest 和纯函数。
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { averageOpaque, decayOrder, DEFAULT_TINT, FALL_ITEMS, growOrder, leafLayers, leafTint, LEAVES, vineLength, vineTint } from '../../packages/templates/vine-overgrow/src/layout';
import { applyPreset, defaultParams, localizePresetParams, parseManifest, sameValue, sanitizeParams, type ParamValue } from '../../packages/template-sdk/src/index';

const manifest = (() => {
  const r = parseManifest(JSON.parse(readFileSync(join(import.meta.dirname, '../../packages/templates/vine-overgrow/manifest.json'), 'utf8')));
  if (!r.ok) throw new Error(`manifest invalid: ${JSON.stringify(r)}`);
  return r.manifest;
})();
const defs = manifest.params ?? [];

/** 默认值和预设里出现的音效：都对照过本机游戏文件（26.3、26.2、1.21.1、1.20.1 的 sounds.json） */
const ALLOWED_SOUNDS = new Set<ParamValue>([
  null,
  'minecraft:block.vine.place',
  'minecraft:block.grass.place',
  'minecraft:block.grass.break',
  'minecraft:block.cherry_leaves.place',
  'minecraft:block.cherry_leaves.break',
]);
const SOUND_KEYS = defs.filter((d) => d.type === 'sound').map((d) => d.key);

describe('T-TPL-C016 藤蔓蔓生', () => {
  it('T-TPL-C016-1 manifest 合法：转场、标签 blocks 在前、三段时间线，默认参数清洗后不变；树叶、飘落物的选项和代码一致', () => {
    expect(manifest.id).toBe('allay.builtin.vine-overgrow');
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
    expect(d.tint).toBe(DEFAULT_TINT);
    const leaves = defs.find((p) => p.key === 'leaves');
    expect(leaves?.type === 'enum' ? leaves.options.map((o) => o.value) : []).toEqual([...LEAVES]);
    const fall = defs.find((p) => p.key === 'fallItem');
    expect(fall?.type === 'enum' ? fall.options.map((o) => o.value) : []).toEqual([...FALL_ITEMS]);
  });

  it('T-TPL-C016-2 每个自带预设都能载入：值经过清洗后不变，总时长在范围内，音效在允许的范围里', () => {
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

  it('T-TPL-C016-3 树叶颜色：保持默认值时按种类取游戏里的颜色，改过的照用；藤蔓总是着色', () => {
    expect(leafTint('oak', DEFAULT_TINT)).toBe(DEFAULT_TINT);
    expect(leafTint('spruce', DEFAULT_TINT)).toBe('#619961');
    expect(leafTint('birch', DEFAULT_TINT)).toBe('#80A755');
    for (const k of ['cherry', 'azalea', 'flowering_azalea', 'pale_oak'] as const) expect(leafTint(k, DEFAULT_TINT)).toBe('#FFFFFF');
    expect(leafTint('spruce', '#C04030')).toBe('#C04030');
    expect(vineTint('cherry', DEFAULT_TINT)).toBe(DEFAULT_TINT);
    expect(vineTint('spruce', DEFAULT_TINT)).toBe('#619961');
  });

  it('T-TPL-C016-4 树叶分层：最里层铺满、贴在 z = 0；外层错开、离相机近、更亮、不铺满；层数 1–3', () => {
    const three = leafLayers(3);
    expect(three).toHaveLength(3);
    expect(three[0]).toMatchObject({ dx: 0, dy: 0, depth: 0, fill: 1 });
    for (let k = 1; k < 3; k++) {
      expect(three[k]!.depth).toBeGreaterThan(three[k - 1]!.depth);
      expect(three[k]!.shade).toBeGreaterThan(three[k - 1]!.shade);
      expect(three[k]!.fill).toBeLessThan(1);
    }
    expect(leafLayers(1)).toHaveLength(1);
    expect(leafLayers(0)).toHaveLength(1);
    expect(leafLayers(9)).toHaveLength(3);
  });

  it('T-TPL-C016-5 生长和枯落的先后：离藤蔓近的先长，同一处外层晚一点；枯落基本随机、外层略早', () => {
    expect(growOrder(0, 3, 0.1, 0)).toBeLessThan(growOrder(0, 3, 0.8, 0));
    expect(growOrder(0, 3, 0.4, 0)).toBeLessThan(growOrder(2, 3, 0.4, 0));
    expect(decayOrder(2, 3, 0.5)).toBeLessThan(decayOrder(0, 3, 0.5));
    for (const r of [0, 0.3, 1]) for (const l of [0, 1, 2]) {
      expect(decayOrder(l, 3, r)).toBeGreaterThanOrEqual(0);
      expect(decayOrder(l, 3, r)).toBeLessThanOrEqual(1);
    }
    // 藤蔓至少四成画面高
    expect(vineLength(0)).toBeCloseTo(0.4);
    expect(vineLength(1)).toBeGreaterThan(1);
  });

  it('T-TPL-C016-6 树叶后面那层底的颜色：取贴图不透明像素的平均颜色（不算镂空的像素）', () => {
    const px = new Uint8Array([255, 0, 0, 255, 0, 255, 0, 255, 9, 9, 9, 0, 9, 9, 9, 10]);
    const avg = averageOpaque(px)!;
    expect(avg[0]).toBeCloseTo(0.5);
    expect(avg[1]).toBeCloseTo(0.5);
    expect(avg[2]).toBeCloseTo(0);
    expect(averageOpaque(new Uint8Array([1, 2, 3, 0]))).toBeNull();
  });
});
