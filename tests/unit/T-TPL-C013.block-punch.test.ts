// 013 方块冲镜 allay.builtin.block-punch 的验收测试（docs/template-catalog.md 第 2 节、docs/templates/block-punch.md）。
// 画面本身（首末帧透明、剪辑点不透明、同一时刻两次渲染一致、三种画幅）由 test:engine 的 T-TPL-3、4、5 检查；这里测 manifest 和纯函数。
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { approachStart, cameraDistance, exitPath, FRAMINGS, impactLayout, OVERSCAN, shakeAngle, SHAKE_DEGREES } from '../../packages/templates/block-punch/src/layout';
import { applyPreset, defaultParams, localizePresetParams, parseManifest, sameValue, sanitizeParams, type ParamValue } from '../../packages/template-sdk/src/index';

const manifest = (() => {
  const r = parseManifest(JSON.parse(readFileSync(join(import.meta.dirname, '../../packages/templates/block-punch/manifest.json'), 'utf8')));
  if (!r.ok) throw new Error(`manifest invalid: ${JSON.stringify(r)}`);
  return r.manifest;
})();
const defs = manifest.params ?? [];

/** 默认值和预设里出现的音效：都对照过本机游戏文件（26.3、26.2、1.21.1、1.20.1 的 sounds.json）。不用 allay:whoosh：内置层不提供音效，没有资源包时它是静音的 */
const ALLOWED_SOUNDS = new Set<ParamValue>([null, 'minecraft:entity.player.attack.sweep', 'minecraft:block.grass.place', 'minecraft:block.metal.place', 'minecraft:block.wood.place']);
const SOUND_KEYS = defs.filter((d) => d.type === 'sound').map((d) => d.key);
const STAGES = [
  [1920, 1080],
  [1080, 1920],
  [1080, 1080],
] as const;
const FOV = 40;

describe('T-TPL-C013 方块冲镜', () => {
  it('T-TPL-C013-1 manifest 合法：转场、标签 blocks 在前、三段时间线，默认参数清洗后不变，默认音效都对照过', () => {
    expect(manifest.id).toBe('allay.builtin.block-punch');
    expect(manifest.category).toBe('transition');
    expect(manifest.tags?.[0]).toBe('blocks');
    expect(manifest.timeline?.segments.map((s) => s.param)).toEqual(['inDuration', 'hold', 'outDuration']);
    for (const locale of ['zh-CN', 'en'] as const) {
      const d = defaultParams(defs, { locale });
      expect(sanitizeParams(defs, d)).toEqual(d);
    }
    const d = defaultParams(defs);
    for (const k of SOUND_KEYS) expect(ALLOWED_SOUNDS.has(d[k]!), k).toBe(true);
    const framing = defs.find((p) => p.key === 'framing');
    expect(framing?.type === 'enum' ? framing.options.map((o) => o.value).sort() : []).toEqual([...FRAMINGS].sort());
  });

  it('T-TPL-C013-2 每个自带预设都能载入：值经过清洗后不变，总时长在范围内，音效在允许的范围里', () => {
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

  it('T-TPL-C013-3 撞上时：面比画面大 14%，三种取景都盖住整个画面（四边留得出晃动的余量）', () => {
    for (const [w, h] of STAGES) {
      for (const framing of FRAMINGS) {
        const { size, y } = impactLayout(w, h, framing);
        expect(size).toBeCloseTo(Math.max(w, h) * OVERSCAN);
        // 面在 z = 0 平面上：左右、上下的边都在画外
        expect(size / 2).toBeGreaterThan(w / 2);
        expect(y + size / 2).toBeGreaterThan(h / 2);
        expect(y - size / 2).toBeLessThan(-h / 2);
        // 上下各至少留边长的 2%（2.5° 的晃动在透视下最多往里收约 2%）
        expect(y + size / 2 - h / 2).toBeGreaterThanOrEqual(size * 0.02 - 1e-9);
        expect(-h / 2 - (y - size / 2)).toBeGreaterThanOrEqual(size * 0.02 - 1e-9);
      }
    }
    // 靠上取景时面往下挪（面的上沿留在画面上方一点）
    expect(impactLayout(1920, 1080, 'top').y).toBeLessThan(0);
    expect(impactLayout(1920, 1080, 'bottom').y).toBeGreaterThan(0);
    expect(impactLayout(1920, 1080, 'center').y).toBe(0);
  });

  it('T-TPL-C013-4 飞来的起点：在画外（投影后整个方块不在画面里）', () => {
    for (const [w, h] of STAGES) {
      const { size } = impactLayout(w, h, 'center');
      const D = cameraDistance(h, FOV);
      const far = D * (size / (0.32 * h) - 1);
      for (const a of [0, 45, 90, 135, 180, 195, 225, 270, 315]) {
        const s = approachStart(a, w, h, size, D, far);
        // 中心投影到 z = 0 平面，再减去投影后的半个边长（按最近那个面算，偏大）
        const k = D / (D + far);
        const cx = s.x * (D / (D - s.z));
        const cy = s.y * (D / (D - s.z));
        const half = (size * k) / 2;
        const outside = Math.max(Math.abs(cx) - w / 2, Math.abs(cy) - h / 2) - half;
        expect(outside, `${w}x${h} ${a}°`).toBeGreaterThan(0);
      }
    }
  });

  it('T-TPL-C013-5 晃动：撞上之前为 0，幅度不超过 2.5° × 强度，衰减到很小', () => {
    expect(shakeAngle(0, 1)).toBe(0);
    expect(shakeAngle(-0.1, 1)).toBe(0);
    expect(shakeAngle(0.1, 0)).toBe(0);
    let max = 0;
    for (let k = 1; k < 400; k++) max = Math.max(max, Math.abs(shakeAngle(k / 1000, 1)));
    expect(max).toBeLessThanOrEqual((SHAKE_DEGREES * Math.PI) / 180 + 1e-12);
    expect(Math.abs(shakeAngle(0.8, 1))).toBeLessThan(0.002);
  });

  it('T-TPL-C013-6 飞走：前面经过相机平面时方块整块偏在相机旁边（不从相机里穿过）；终点整个在相机后面', () => {
    for (const [w, h] of STAGES) {
      const { size } = impactLayout(w, h, 'center');
      const D = cameraDistance(h, FOV);
      const from = { x: 0, y: 0, z: -size / 2 };
      for (const a of [0, 90, 195, 270]) {
        let crossed = false;
        for (let k = 0; k <= 1000; k++) {
          const c = exitPath(k / 1000, from, a, size, D);
          // 方块的前面 z = c.z + size / 2 刚过相机所在的平面 z = D
          if (!crossed && c.z + size / 2 >= D) {
            crossed = true;
            expect(Math.hypot(c.x, c.y), `${w}x${h} ${a}°`).toBeGreaterThan(size / 2);
          }
        }
        expect(crossed).toBe(true);
        expect(exitPath(1, from, a, size, D).z - size / 2).toBeGreaterThan(D);
      }
    }
  });
});
