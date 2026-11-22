// 012 区块升起 allay.builtin.chunk-rise 的验收测试（docs/template-catalog.md 第 2 节、docs/templates/chunk-rise.md）。
// 画面本身（首末帧透明、剪辑点不透明、同一时刻两次渲染一致、三种画幅）由 test:engine 的 T-TPL-3、4、5 检查；这里测 manifest 和纯函数。
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  BIOMES,
  cameraDistance,
  cameraRig,
  CHUNK_ORDERS,
  chunkOrder,
  columnSurface,
  convexHull,
  footprint,
  hullInset,
  palette,
  PEAK_LEVEL,
  projectToScreen,
  terrainHeight,
} from '../../packages/templates/chunk-rise/src/layout';
import { applyPreset, defaultParams, localizePresetParams, parseManifest, sameValue, sanitizeParams, type ParamValue } from '../../packages/template-sdk/src/index';

const manifest = (() => {
  const r = parseManifest(JSON.parse(readFileSync(join(import.meta.dirname, '../../packages/templates/chunk-rise/manifest.json'), 'utf8')));
  if (!r.ok) throw new Error(`manifest invalid: ${JSON.stringify(r)}`);
  return r.manifest;
})();
const defs = manifest.params ?? [];

/** 默认值和预设里出现的音效：都对照过本机游戏文件（26.3、26.2、1.21.1、1.20.1 的 sounds.json） */
const ALLOWED_SOUNDS = new Set<ParamValue>([
  null,
  'minecraft:block.gravel.place',
  'minecraft:block.gravel.break',
  'minecraft:block.sand.place',
  'minecraft:block.sand.break',
  'minecraft:block.snow.place',
  'minecraft:block.snow.break',
  'minecraft:block.stone.place',
  'minecraft:block.stone.break',
]);
const SOUND_KEYS = defs.filter((d) => d.type === 'sound').map((d) => d.key);

describe('T-TPL-C012 区块升起', () => {
  it('T-TPL-C012-1 manifest 合法：转场、标签 blocks 在前、三段时间线，默认参数清洗后不变；群系、顺序的选项和代码一致', () => {
    expect(manifest.id).toBe('allay.builtin.chunk-rise');
    expect(manifest.category).toBe('transition');
    expect(manifest.tags?.[0]).toBe('blocks');
    expect(manifest.timeline?.segments.map((s) => s.param)).toEqual(['inDuration', 'hold', 'outDuration']);
    for (const locale of ['zh-CN', 'en'] as const) {
      const d = defaultParams(defs, { locale });
      expect(sanitizeParams(defs, d)).toEqual(d);
    }
    const d = defaultParams(defs);
    for (const k of SOUND_KEYS) expect(ALLOWED_SOUNDS.has(d[k]!), k).toBe(true);
    const biome = defs.find((p) => p.key === 'palette');
    expect(biome?.type === 'enum' ? biome.options.map((o) => o.value) : []).toEqual([...BIOMES]);
    const order = defs.find((p) => p.key === 'order');
    expect(order?.type === 'enum' ? order.options.map((o) => o.value) : []).toEqual([...CHUNK_ORDERS]);
  });

  it('T-TPL-C012-2 每个自带预设都能载入：值经过清洗后不变，总时长在范围内，音效在允许的范围里', () => {
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

  it('T-TPL-C012-3 生物群系：贴图不超过 8 张（着色器一次绘制），各种地表的下标都在贴图表里；草、水用游戏的着色常量', () => {
    for (const b of BIOMES) {
      const p = palette(b);
      expect(p.textures.length).toBeGreaterThan(0);
      expect(p.textures.length).toBeLessThanOrEqual(8);
      expect(p.tints).toHaveLength(p.textures.length);
      for (const s of [p.ground, p.shore, p.peak, p.liquid, p.patch]) {
        if (!s) continue;
        for (const i of [s.top, s.side, s.fill, s.deep]) expect(i).toBeLessThan(p.textures.length);
      }
      for (const t of p.textures) expect(t).toMatch(/^block\/[a-z_]+$/);
    }
    const plains = palette('plains');
    expect(plains.tints[plains.textures.indexOf('block/grass_block_top')]).toBe('#91BD59');
    expect(plains.tints[plains.textures.indexOf('block/water_still')]).toBe('#3F76E4');
  });

  it('T-TPL-C012-4 地表：低于水面的变成水（顶面在水面上），水面那一圈是水边，高处露出石头', () => {
    const p = palette('plains');
    expect(columnSurface(p, -4, 0)).toEqual({ surface: p.liquid, top: p.liquidLevel });
    expect(columnSurface(p, p.liquidLevel, 0)).toEqual({ surface: p.shore, top: p.liquidLevel });
    expect(columnSurface(p, 1, 0)).toEqual({ surface: p.ground, top: 1 });
    expect(columnSurface(p, PEAK_LEVEL, 0)).toEqual({ surface: p.peak, top: PEAK_LEVEL });
    // 末地没有水
    const end = palette('end');
    expect(end.liquid).toBeNull();
    expect(columnSurface(end, -9, 0).top).toBe(-9);
    // 起伏为 0 时是平地
    expect(terrainHeight(0.9, -0.4, 0)).toBe(0);
    expect(terrainHeight(1, 1, 1)).toBe(Math.round(1.5 + 7));
  });

  it('T-TPL-C012-5 镜头和视野：中心看向原点；四个角的射线落在地面上，原点投影在画面正中', () => {
    for (const aspect of [16 / 9, 9 / 16, 1]) {
      for (const tilt of [40, 55, 90]) {
        const rig = cameraRig(tilt, cameraDistance(34, 35, aspect), 35, aspect);
        const center = projectToScreen(rig, tilt, 35, aspect, 0, 0, 0)!;
        expect(center.sx).toBeCloseTo(0, 9);
        expect(center.sy).toBeCloseTo(0, 9);
        const fp = footprint(rig, -8);
        expect(fp).not.toBeNull();
        // 四个角落在地面上的点投影回画面四角（±1）
        for (const [x, z] of fp!) {
          const s = projectToScreen(rig, tilt, 35, aspect, x, -8, z)!;
          expect(Math.abs(Math.abs(s.sx) - 1)).toBeLessThan(1e-6);
          expect(Math.abs(Math.abs(s.sy) - 1)).toBeLessThan(1e-6);
        }
      }
    }
  });

  it('T-TPL-C012-6 凸包：里面的点余量为正、外面为负；按画面位置排的先后：画面下方先、中心先', () => {
    const hull = convexHull([[0, 0], [4, 0], [4, 3], [0, 3], [2, 1]]);
    expect(hull).toHaveLength(4);
    expect(hullInset(hull, 2, 1.5)).toBeCloseTo(1.5);
    expect(hullInset(hull, 5, 1)).toBeLessThan(0);
    expect(chunkOrder('nearFirst', 0, -1, 0)).toBeLessThan(chunkOrder('nearFirst', 0, 1, 0));
    expect(chunkOrder('centerOut', 0, 0, 0)).toBeLessThan(chunkOrder('centerOut', 0.8, 0.8, 0));
    expect(chunkOrder('random', 0.3, 0.3, 0.42)).toBe(0.42);
  });
});
