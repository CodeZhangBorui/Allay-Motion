// 022 掉落物涌入 allay.builtin.item-swarm 的验收测试（docs/template-catalog.md 第 2 节、docs/templates/item-swarm.md）。
// 画面本身（首末帧透明、剪辑点不透明、同一时刻两次渲染一致、三种画幅）由 test:engine 的 T-TPL-3、4、5 检查；这里测 manifest 和纯函数。
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { wallGrid } from '../../packages/templates/_lib/src/block-kit';
import {
  BOB_HIGH,
  BOB_LOW,
  BOB_PERIOD,
  bobHeight,
  exitDistance,
  FLIGHT_SCALE,
  flightProgress,
  landScale,
  ORIGINS,
  scatterProgress,
  spinAngle,
  startPoint,
} from '../../packages/templates/item-swarm/src/layout';
import { applyPreset, defaultParams, localizePresetParams, parseManifest, sameValue, sanitizeParams, type ParamValue } from '../../packages/template-sdk/src/index';

const manifest = (() => {
  const r = parseManifest(JSON.parse(readFileSync(join(import.meta.dirname, '../../packages/templates/item-swarm/manifest.json'), 'utf8')));
  if (!r.ok) throw new Error(`manifest invalid: ${JSON.stringify(r)}`);
  return r.manifest;
})();
const defs = manifest.params ?? [];

/** 默认值和预设里出现的音效：都对照过本机游戏文件（26.3、26.2、1.21.1、1.20.1 的 sounds.json）。不用 allay:whoosh：内置层不提供音效，没有资源包时它是静音的 */
const ALLOWED_SOUNDS = new Set<ParamValue>([null, 'minecraft:entity.item.pickup', 'minecraft:entity.player.attack.sweep']);
const SOUND_KEYS = defs.filter((d) => d.type === 'sound').map((d) => d.key);
const STAGES = [
  [1920, 1080],
  [1080, 1920],
  [1080, 1080],
] as const;
const backOut = (x: number) => 1 + 2.70158 * (x - 1) ** 3 + 1.70158 * (x - 1) ** 2;

describe('T-TPL-C022 掉落物涌入', () => {
  it('T-TPL-C022-1 manifest 合法：转场、标签 items 在前、三段时间线，默认参数清洗后不变，默认音效都对照过', () => {
    expect(manifest.id).toBe('allay.builtin.item-swarm');
    expect(manifest.category).toBe('transition');
    expect(manifest.tags?.[0]).toBe('items');
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
    const origin = defs.find((p) => p.key === 'origin');
    expect(origin?.type === 'enum' ? origin.options.map((o) => o.value) : []).toEqual([...ORIGINS]);
    for (const key of ['arrangement', 'fillOrder']) {
      const def = defs.find((p) => p.key === key);
      expect(def?.type === 'enum' && def.ui).toBe('pattern');
    }
  });

  it('T-TPL-C022-2 每个自带预设都能载入：值经过清洗后不变，总时长在范围内，音效在允许的范围里', () => {
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

  it('T-TPL-C022-3 出发点：五种来向、三种画幅，掉落物（半格大）出发时整个在舞台外', () => {
    for (const [w, h] of STAGES) {
      const g = wallGrid(w, h, 14);
      for (const origin of ORIGINS) {
        for (let i = 0; i < g.count; i += 7) {
          for (const r of [[0, 0, 0], [0.5, 0.5, 0.5], [0.99, 0.99, 0.99]]) {
            const p = startPoint(origin, { x: g.px[i]!, y: g.py[i]! }, w, h, g.size, r);
            const outside = Math.max(Math.abs(p.x) - w / 2, Math.abs(p.y) - h / 2);
            expect(outside, `${w}x${h} ${origin} #${i}`).toBeGreaterThanOrEqual((FLIGHT_SCALE * g.size) / 2);
          }
        }
      }
    }
  });

  it('T-TPL-C022-4 自转：飞行前四分之三按角速度转，落位时停在整 90°；落位的缩放从半格长到一格', () => {
    const spin = Math.PI * 2;
    for (const phase of [0, 0.3, 2.1, 5]) {
      for (const flight of [0.3, 0.47, 0.8]) {
        expect(spinAngle(phase, spin, flight * 0.5, flight, 0.5)).toBeCloseTo(phase + spin * flight * 0.5);
        const end = spinAngle(phase, spin, flight, flight, 1);
        expect(Math.abs(end / (Math.PI / 2) - Math.round(end / (Math.PI / 2)))).toBeLessThan(1e-9);
        // 停在前面的那个整 90°（不倒转）
        expect(end).toBeGreaterThanOrEqual(phase + spin * flight - 1e-9);
      }
    }
    expect(landScale(0, backOut)).toBe(FLIGHT_SCALE);
    expect(landScale(0.5, backOut)).toBe(FLIGHT_SCALE);
    expect(landScale(1, backOut)).toBe(1);
  });

  it('T-TPL-C022-5 散开：沿方向走 exitDistance 就出画（多出 margin）；进度曲线两端精确', () => {
    for (const [w, h] of STAGES) {
      const g = wallGrid(w, h, 14);
      for (let i = 0; i < g.count; i += 5) {
        for (const a of [0, 0.7, 2, 3.5, 5.1]) {
          const dx = Math.cos(a);
          const dy = Math.sin(a);
          const d = exitDistance({ x: g.px[i]!, y: g.py[i]! }, dx, dy, w, h, 1.5 * g.size);
          const x = g.px[i]! + dx * d;
          const y = g.py[i]! + dy * d;
          expect(Math.max(Math.abs(x) - w / 2, Math.abs(y) - h / 2)).toBeGreaterThanOrEqual(1.5 * g.size - 1e-6);
        }
      }
    }
    for (const f of [scatterProgress, (p: number) => flightProgress(p, (x) => x * x)]) {
      expect(f(0)).toBe(0);
      expect(f(1)).toBe(1);
      let prev = 0;
      for (let k = 1; k <= 100; k++) {
        const v = f(k / 100);
        expect(v).toBeGreaterThanOrEqual(prev);
        prev = v;
      }
    }
  });

  it('T-TPL-C022-6 上下浮动照游戏：0.0625–0.2625 格，周期 π 秒', () => {
    for (let k = 0; k <= 200; k++) {
      const b = bobHeight(k * 0.05, 1.3);
      expect(b).toBeGreaterThanOrEqual(BOB_LOW - 1e-12);
      expect(b).toBeLessThanOrEqual(BOB_HIGH + 1e-12);
    }
    expect(bobHeight(0.4, 0.2)).toBeCloseTo(bobHeight(0.4 + BOB_PERIOD, 0.2));
  });

  it('T-TPL-C022-7 实例预算：列数取到最大、竖屏时掉落物也不超过 5000 个', () => {
    for (const [w, h] of STAGES) expect(wallGrid(w, h, 32).count).toBeLessThanOrEqual(5000);
  });
});
