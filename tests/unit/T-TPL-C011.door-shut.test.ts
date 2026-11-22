// 011 关门 allay.builtin.door-shut 的验收测试（docs/template-catalog.md 第 2 节、docs/templates/door-shut.md）。
// 画面本身（首末帧透明、剪辑点不透明、同一时刻两次渲染一致、三种画幅）由 test:engine 的 T-TPL-3、4、5 检查；这里测 manifest 和纯函数。
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { closeAngle, DOOR_LAYOUTS, DOOR_THICKNESS, doorGrid, DOORS, doorSound, maxPerspective, openAngle, openLimit, SLAM_AT, swingShade, WOODEN_CLOSE, WOODEN_OPEN } from '../../packages/templates/door-shut/src/layout';
import { applyPreset, defaultParams, localizePresetParams, parseManifest, sameValue, sanitizeParams, type ParamValue } from '../../packages/template-sdk/src/index';

const manifest = (() => {
  const r = parseManifest(JSON.parse(readFileSync(join(import.meta.dirname, '../../packages/templates/door-shut/manifest.json'), 'utf8')));
  if (!r.ok) throw new Error(`manifest invalid: ${JSON.stringify(r)}`);
  return r.manifest;
})();
const defs = manifest.params ?? [];

/**
 * 默认值、预设里出现的音效，以及保持默认时按门的种类换成的音效：都对照过本机游戏文件（26.3、26.2、1.21.1 的 sounds.json；
 * copper_door 1.20.1 没有，铜门本身也是 1.21 才有）
 */
const ALLOWED_SOUNDS = new Set<ParamValue>([
  null,
  'minecraft:block.wooden_door.close',
  'minecraft:block.wooden_door.open',
  'minecraft:block.iron_door.close',
  'minecraft:block.iron_door.open',
  'minecraft:block.cherry_wood_door.close',
  'minecraft:block.cherry_wood_door.open',
  'minecraft:block.bamboo_wood_door.close',
  'minecraft:block.bamboo_wood_door.open',
  'minecraft:block.nether_wood_door.close',
  'minecraft:block.nether_wood_door.open',
  'minecraft:block.copper_door.close',
  'minecraft:block.copper_door.open',
]);
const SOUND_KEYS = defs.filter((d) => d.type === 'sound').map((d) => d.key);
const STAGES = [
  [1920, 1080],
  [1080, 1920],
  [1080, 1080],
] as const;
const quadIn = (x: number) => x * x;

describe('T-TPL-C011 关门', () => {
  it('T-TPL-C011-1 manifest 合法：转场、标签 blocks 在前、三段时间线，默认参数清洗后不变；门的种类和代码一致', () => {
    expect(manifest.id).toBe('allay.builtin.door-shut');
    expect(manifest.category).toBe('transition');
    expect(manifest.tags?.[0]).toBe('blocks');
    expect(manifest.timeline?.segments.map((s) => s.param)).toEqual(['inDuration', 'hold', 'outDuration']);
    for (const locale of ['zh-CN', 'en'] as const) {
      const d = defaultParams(defs, { locale });
      expect(sanitizeParams(defs, d)).toEqual(d);
    }
    const d = defaultParams(defs);
    for (const k of SOUND_KEYS) expect(ALLOWED_SOUNDS.has(d[k]!), k).toBe(true);
    const door = defs.find((p) => p.key === 'door');
    expect(door?.type === 'enum' ? door.options.map((o) => o.value) : []).toEqual([...DOORS]);
    const layout = defs.find((p) => p.key === 'layout');
    expect(layout?.type === 'enum' ? layout.options.map((o) => o.value) : []).toEqual([...DOOR_LAYOUTS]);
  });

  it('T-TPL-C011-2 每个自带预设都能载入：值经过清洗后不变，总时长在范围内，音效在允许的范围里', () => {
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

  it('T-TPL-C011-3 音效：保持木门的默认值时按门的种类换成游戏里那种门的音效，用户改过的照用', () => {
    expect(doorSound(WOODEN_CLOSE, 'oak', 'close')).toBe(WOODEN_CLOSE);
    expect(doorSound(WOODEN_OPEN, 'iron', 'open')).toBe('minecraft:block.iron_door.open');
    expect(doorSound(WOODEN_CLOSE, 'crimson', 'close')).toBe('minecraft:block.nether_wood_door.close');
    expect(doorSound(WOODEN_CLOSE, 'warped', 'close')).toBe('minecraft:block.nether_wood_door.close');
    expect(doorSound(WOODEN_CLOSE, 'pale_oak', 'close')).toBe(WOODEN_CLOSE);
    expect(doorSound('minecraft:block.anvil.land', 'iron', 'close')).toBe('minecraft:block.anvil.land');
    expect(doorSound(null, 'iron', 'close')).toBeNull();
    for (const door of DOORS) for (const kind of ['close', 'open'] as const) expect(ALLOWED_SOUNDS.has(doorSound(kind === 'close' ? WOODEN_CLOSE : WOODEN_OPEN, door, kind)), `${door} ${kind}`).toBe(true);
  });

  it('T-TPL-C011-4 门扇的排法：贴图像素是正方形（门宽 : 高 = 1 : 2），三种画幅都盖满（多 1%），竖屏自动单开', () => {
    expect(DOOR_THICKNESS).toBeCloseTo(3 / 16);
    for (const [w, h] of STAGES) {
      for (const layout of DOOR_LAYOUTS) {
        const g = doorGrid(w, h, layout);
        // 横向：每行 leaves 扇宽 width，盖住舞台宽
        expect(g.leaves * g.width).toBeGreaterThanOrEqual(w * 1.01 - 1e-9);
        // 竖向：rows 行、每行高 2 × width，盖住舞台高
        expect(g.rows * 2 * g.width).toBeGreaterThanOrEqual(h * 1.01 - 1e-9);
      }
    }
    expect(doorGrid(1920, 1080, 'auto').leaves).toBe(2);
    expect(doorGrid(1080, 1080, 'auto').leaves).toBe(2);
    expect(doorGrid(1080, 1920, 'auto').leaves).toBe(1);
    // 竖屏硬要对开：叠两行
    expect(doorGrid(1080, 1920, 'double').rows).toBe(2);
    expect(doorGrid(1920, 1080, 'double').rows).toBe(1);
  });

  it('T-TPL-C011-5 关门的角度：从刚好出画的角度越关越快，在 80% 处撞上门框，回弹后正好落在 0；开门越开越慢、到刚好出画', () => {
    const open = openLimit(1920, 1713);
    expect(open).toBeGreaterThan(60);
    expect(open).toBeLessThanOrEqual(90);
    expect(closeAngle(0, quadIn, 3, open)).toBe(open);
    expect(closeAngle(1, quadIn, 3, open)).toBe(0);
    expect(closeAngle(SLAM_AT, quadIn, 3, open)).toBeCloseTo(0, 9);
    // 越关越快：前一半转得比后一半少
    expect(open - closeAngle(SLAM_AT / 2, quadIn, 0, open)).toBeLessThan(closeAngle(SLAM_AT / 2, quadIn, 0, open));
    // 回弹：撞上之后打开一点再落定，不超过 bounce
    let max = 0;
    for (let p = SLAM_AT; p <= 1; p += 0.01) max = Math.max(max, closeAngle(p, quadIn, 3, open));
    expect(max).toBeGreaterThan(0);
    expect(max).toBeLessThanOrEqual(3);
    expect(openAngle(0, open)).toBe(0);
    expect(openAngle(1, open)).toBe(open);
    expect(openAngle(0.5, open)).toBeGreaterThan(open / 2);
  });

  it('T-TPL-C011-6 开到 openLimit 时整扇门在画外：门轴在画面边上、门扇朝相机转开，tan θ ≥ 2D / W', () => {
    for (const [w, h] of STAGES) {
      for (const fov of [15, 35, 60]) {
        const D = h / 2 / Math.tan((fov * Math.PI) / 360);
        const theta = (openLimit(w, D) * Math.PI) / 180;
        expect(Math.tan(theta)).toBeGreaterThanOrEqual((2 * D) / w - 1e-9);
        // 门扇上离门轴 r 的点投影到 z = 0 平面后在画外
        for (const r of [0.1, 0.5, 1]) {
          const L = w / 2;
          const x = -w / 2 + r * L * Math.cos(theta);
          const z = r * L * Math.sin(theta);
          if (z < D) expect(x * (D / (D - z))).toBeLessThanOrEqual(-w / 2 + 1e-6);
        }
      }
    }
  });

  it('T-TPL-C011-7 转动时的面明暗：关上时 0.8（朝南），转到 90° 时 0.6（朝东西），中间单调', () => {
    expect(swingShade(0)).toBeCloseTo(0.8);
    expect(swingShade(90)).toBeCloseTo(0.6);
    let prev = 1;
    for (let a = 0; a <= 90; a += 5) {
      expect(swingShade(a)).toBeLessThanOrEqual(prev + 1e-12);
      prev = swingShade(a);
    }
  });

  it('T-TPL-C011-8 门转动时不扫过相机：透视收到 maxPerspective 以内时，转动的全程相机都在门扇外面（离门扇至少 5% 门宽）', () => {
    for (const [w, h] of STAGES) {
      for (const layout of DOOR_LAYOUTS) {
        const grid = doorGrid(w, h, layout);
        const L = grid.width;
        const T = L * DOOR_THICKNESS;
        // 相机相对门轴的水平位置：单开时门轴在 x = −L/2，对开时左扇的门轴在 x = −L（右扇对称）
        const cx = grid.leaves === 1 ? L / 2 : L;
        for (const asked of [15, 35, 45, 60]) {
          const fov = Math.min(asked, maxPerspective(h, grid));
          const D = h / 2 / Math.tan((fov * Math.PI) / 360);
          for (let a = 0; a <= 90; a += 0.5) {
            const th = (a * Math.PI) / 180;
            // 相机换到门扇自己的坐标里（门扇占 x ∈ [0, L]、z ∈ [0, T]，绕门轴转 −θ）
            const xl = cx * Math.cos(th) + D * Math.sin(th);
            const zl = -cx * Math.sin(th) + D * Math.cos(th);
            const dx = Math.max(0, -xl, xl - L);
            const dz = Math.max(0, -zl, zl - T);
            expect(Math.hypot(dx, dz), `${w}x${h} ${layout} fov ${asked} θ ${a}`).toBeGreaterThan(0.05 * L);
          }
        }
      }
    }
    // 对开、竖屏单开不收（上限在参数范围 60° 以上）；横屏单开时门扇比画面还宽，16:9 收到 31° 左右，方屏 53° 左右
    expect(maxPerspective(1080, doorGrid(1920, 1080, 'double'))).toBeGreaterThan(60);
    expect(maxPerspective(1920, doorGrid(1080, 1920, 'single'))).toBeGreaterThan(60);
    expect(maxPerspective(1080, doorGrid(1920, 1080, 'single'))).toBeCloseTo(31.1, 0);
    expect(maxPerspective(1080, doorGrid(1080, 1080, 'single'))).toBeCloseTo(52.6, 0);
  });
});
