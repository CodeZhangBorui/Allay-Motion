// 054 调试屏幕 allay.builtin.debug-f3 的验收测试（docs/template-catalog.md 第 2 节、docs/templates/debug-f3.md）。
// 画面本身（首末帧透明、同一时刻两次渲染一致、三种画幅）由 test:engine 的 T-TPL-3、4、5 检查；这里测 manifest 和纯函数。
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { overlayWindows, progress } from '../../packages/templates/_lib/src/timing';
import {
  facingIndex,
  FACINGS,
  fitRoot,
  formatLine,
  formatValue,
  isNumericKey,
  lineBackground,
  lineTop,
  NUMERIC_CHARS,
  NUMERIC_MAX_LEN,
  parseLine,
  PITCH_SWAY,
  poseAt,
  rightLineX,
  routeProgress,
  splitLines,
  sway,
  TOWARDS,
  travelYaw,
  wrapDegrees,
  YAW_SWAY,
  type Pose,
  type Route,
  type ValueKey,
} from '../../packages/templates/debug-f3/src/layout';
import { defaultParams, parseManifest, sameValue, sanitizeParams, type ParamValue } from '../../packages/template-sdk/src/index';

const manifest = (() => {
  const r = parseManifest(JSON.parse(readFileSync(join(import.meta.dirname, '../../packages/templates/debug-f3/manifest.json'), 'utf8')));
  if (!r.ok) throw new Error(`manifest invalid: ${JSON.stringify(r)}`);
  return r.manifest;
})();
const defs = manifest.params ?? [];

const pose = (over: Partial<Pose> = {}): Pose => ({ x: 0, y: 64, z: 0, yaw: 0, pitch: 0, fps: 60, ...over });
const route = (over: Partial<Route> = {}): Route => ({ from: [0, 64, 0], to: [10, 64, 0], pitch: 0, fpsBase: 60, yawPhases: [0, 0], pitchPhases: [0, 0], fpsJitter: [0], ...over });

describe('T-TPL-C054 调试屏幕', () => {
  it('T-TPL-C054-1 manifest 合法，默认参数能装载；字色、灰底、不带阴影照游戏', () => {
    expect(manifest.id).toBe('allay.builtin.debug-f3');
    expect(manifest.category).toBe('overlay');
    const d = defaultParams(defs, { locale: 'zh-CN' });
    expect(sanitizeParams(defs, d)).toEqual(d);
    // 调试屏幕的文字不分语言
    expect(defaultParams(defs, { locale: 'en' })).toEqual(d);
    expect(manifest.timeline?.segments.map((s) => s.param)).toEqual(['inDuration', 'hold', 'outDuration']);
    expect(d.textColor).toBe('#E0E0E0');
    expect(d.bgColor).toBe('#50505090');
    expect((d.font as { shadow: boolean }).shadow).toBe(false);
    // 游戏里没有声音：不设音效参数
    expect(defs.some((p) => p.type === 'sound')).toBe(false);
    // 默认文字里的占位符都认识
    for (const key of ['left', 'right']) {
      for (const m of (d[key] as string).matchAll(/\{([a-z]+)\}/g)) expect(parseLine(m[0]), m[0]).toEqual([{ kind: 'value', key: m[1] }]);
    }
  });

  it('T-TPL-C054-2 每个自带预设都能载入：值经过清洗后不变', () => {
    expect(manifest.presets?.length).toBeGreaterThanOrEqual(3);
    for (const preset of manifest.presets ?? []) {
      const applied = sanitizeParams(defs, { ...defaultParams(defs), ...preset.params });
      for (const [k, v] of Object.entries(preset.params)) expect(sameValue(applied[k], v as ParamValue), `${preset.key}.${k}`).toBe(true);
      const total = (applied.inDuration as number) + (applied.hold as number) + (applied.outDuration as number);
      expect(total).toBeGreaterThanOrEqual(0.1);
      expect(total).toBeLessThanOrEqual(30);
    }
  });

  it('T-TPL-C054-3 版式：左栏从 (2, 2) 起、行距 9；灰底比文字各多 1、高 9；右栏的行右端在 w − 2', () => {
    expect([lineTop(0), lineTop(1), lineTop(6)]).toEqual([2, 11, 56]);
    expect(lineBackground(2, 2, 100)).toEqual([1, 1, 102, 9]);
    expect(lineBackground(2, lineTop(3), 57)).toEqual([1, 28, 59, 9]);
    expect(rightLineX(480, 100)).toBe(378);
    expect(lineBackground(rightLineX(480, 100), 2, 100)).toEqual([377, 1, 102, 9]);
    // 相邻两行的灰底首尾相接，不重叠
    expect(lineBackground(2, lineTop(0), 10)[1] + 9).toBe(lineBackground(2, lineTop(1), 10)[1]);
    // 空行保留位置，行尾空白和末尾的空行去掉
    expect(splitLines('a\n\nb  \n\n')).toEqual(['a', '', 'b']);
    expect(splitLines('')).toEqual([]);
    expect(splitLines('1\n2\n3', 2)).toEqual(['1', '2']);
  });

  it('T-TPL-C054-4 放不下时整体缩小：16:9 不缩，9:16、1:1 按两栏最宽的行缩', () => {
    // 480 宽：左 250 + 右 110，加两侧各 3 和中间 4 = 370，放得下
    expect(fitRoot(480, 270, 250, 110, 7)).toBe(1);
    // 270 宽（9:16、界面缩放 4）：370 放不下
    expect(fitRoot(270, 480, 250, 110, 7)).toBeCloseTo(270 / 370);
    // 只有左栏时不留中间的间隔
    expect(fitRoot(200, 480, 250, 0, 7)).toBeCloseTo(200 / 253);
    // 行太多时按高度缩：2 + 40 × 9 + 2 = 364
    expect(fitRoot(480, 270, 100, 0, 40)).toBeCloseTo(270 / 364);
    expect(fitRoot(480, 270, 0, 0, 0)).toBe(1);
  });

  it('T-TPL-C054-5 占位符：认识的拆出来，不认识的当普通文字', () => {
    expect(parseLine('XYZ: {x} / {y} / {z}')).toEqual([
      { kind: 'text', text: 'XYZ: ' },
      { kind: 'value', key: 'x' },
      { kind: 'text', text: ' / ' },
      { kind: 'value', key: 'y' },
      { kind: 'text', text: ' / ' },
      { kind: 'value', key: 'z' },
    ]);
    expect(parseLine('{fps} fps {nope} {X}')).toEqual([
      { kind: 'value', key: 'fps' },
      { kind: 'text', text: ' fps {nope} {X}' },
    ]);
    expect(parseLine('plain')).toEqual([{ kind: 'text', text: 'plain' }]);
    expect(parseLine('')).toEqual([]);
  });

  it('T-TPL-C054-6 数值格式：x、z 三位小数，y 五位，方块、区块和区块内坐标，负数向下取整', () => {
    const p = pose({ x: 104.5, y: 64, z: -231.5, yaw: -79.99, pitch: 8.04, fps: 61 });
    expect(formatLine(parseLine('XYZ: {x} / {y} / {z}'), p)).toBe('XYZ: 104.500 / 64.00000 / -231.500');
    expect(formatLine(parseLine('Block: {bx} {by} {bz} [{rx} {ry} {rz}]'), p)).toBe('Block: 104 64 -232 [8 0 8]');
    expect(formatLine(parseLine('Chunk: {cx} {cy} {cz}'), p)).toBe('Chunk: 6 4 -15');
    expect(formatLine(parseLine('Facing: {facing} (Towards {towards}) ({yaw} / {pitch})'), p)).toBe('Facing: east (Towards positive X) (-80.0 / 8.0)');
    expect(formatLine(parseLine('{fps} fps'), p)).toBe('61 fps');
    // 区块内坐标总在 0–15；区块坐标是方块坐标除以 16 向下取整
    const n = pose({ x: -0.5, y: -64, z: -16 });
    expect(['bx', 'cx', 'rx', 'by', 'cy', 'ry', 'bz', 'cz', 'rz'].map((k) => formatValue(k as ValueKey, n))).toEqual(['-1', '-1', '15', '-64', '-4', '0', '-16', '-1', '0']);
  });

  it('T-TPL-C054-7 数值的字符和长度：坐标到 ±30,000,000 也不超过预留的个数', () => {
    const extremes = [
      pose({ x: -30000000, y: -64, z: -30000000, yaw: -180, pitch: -90, fps: 1039 }),
      pose({ x: 30000000, y: 320, z: 30000000, yaw: 179.94, pitch: 90, fps: 1 }),
      pose({ x: -29999999.9996, y: -63.999996, z: -0.0001, yaw: -0.04, pitch: -89.96, fps: 999 }),
    ];
    for (const p of extremes) {
      for (const [key, max] of Object.entries(NUMERIC_MAX_LEN)) {
        const s = formatValue(key as ValueKey, p);
        expect(s.length, `${key} = ${s}`).toBeLessThanOrEqual(max);
        for (const ch of s) expect(NUMERIC_CHARS.includes(ch), `${key} = ${s}`).toBe(true);
        // 负号、小数点各只备了一个
        expect(s.split('-').length - 1).toBeLessThanOrEqual(1);
        expect(s.split('.').length - 1).toBeLessThanOrEqual(1);
      }
    }
    expect(isNumericKey('x')).toBe(true);
    expect(isNumericKey('facing')).toBe(false);
  });

  it('T-TPL-C054-8 朝向：偏航 0 是南（+Z）、90 是西（−X）、±180 是北（−Z）、−90 是东（+X）', () => {
    expect(travelYaw(0, 1)).toBeCloseTo(0);
    expect(travelYaw(-1, 0)).toBeCloseTo(90);
    expect(Math.abs(travelYaw(0, -1))).toBeCloseTo(180);
    expect(travelYaw(1, 0)).toBeCloseTo(-90);
    // 起点和终点相同（或只有高度变化）时偏航是 0
    expect(travelYaw(0, 0)).toBe(0);
    expect(wrapDegrees(190)).toBe(-170);
    expect(wrapDegrees(-190)).toBe(170);
    expect(wrapDegrees(180)).toBe(-180);
    expect(wrapDegrees(720 + 45)).toBe(45);
    expect([0, 90, 180, -180, -90].map((y) => FACINGS[facingIndex(y)])).toEqual(['south', 'west', 'north', 'north', 'east']);
    expect([0, 90, 180, -90].map((y) => TOWARDS[facingIndex(y)])).toEqual(['positive Z', 'negative X', 'negative Z', 'positive X']);
    // 分界在 ±45°、±135°
    expect(FACINGS[facingIndex(44.9)]).toBe('south');
    expect(FACINGS[facingIndex(45.1)]).toBe('west');
    expect(FACINGS[facingIndex(-44.9)]).toBe('south');
    expect(FACINGS[facingIndex(-45.1)]).toBe('east');
    expect(FACINGS[facingIndex(-135.1)]).toBe('north');
  });

  it('T-TPL-C054-9 路线：进入阶段停在起点，停留阶段匀速走完，退出阶段停在终点；帧率每秒变一次', () => {
    expect(routeProgress(0, 0.15, 4)).toBe(0);
    expect(routeProgress(0.15, 0.15, 4)).toBe(0);
    expect(routeProgress(2.15, 0.15, 4)).toBeCloseTo(0.5);
    expect(routeProgress(4.15, 0.15, 4)).toBe(1);
    expect(routeProgress(4.3, 0.15, 4)).toBe(1);
    const r = route({ from: [0, 64, 0], to: [10, 80, -20], pitch: 10, fpsJitter: [0, 1, -1] });
    expect(poseAt(0, 0, r)).toMatchObject({ x: 0, y: 64, z: 0 });
    expect(poseAt(1, 0.5, r)).toMatchObject({ x: 5, y: 72, z: -10 });
    expect(poseAt(2, 1, r)).toMatchObject({ x: 10, y: 80, z: -20 });
    expect(poseAt(2, 7, r)).toMatchObject({ x: 10, y: 80, z: -20 });
    // 相位为 0 时 t = 0 没有晃动：偏航就是行进方向，俯仰就是参数
    expect(poseAt(0, 0, r).yaw).toBeCloseTo(travelYaw(10, -20));
    expect(poseAt(0, 0, r).pitch).toBeCloseTo(10);
    // 晃动的幅度不超过声明的度数；俯仰不出 ±90
    for (let t = 0; t < 30; t += 0.37) {
      expect(Math.abs(sway(t, [1, 2], YAW_SWAY))).toBeLessThanOrEqual(YAW_SWAY);
      expect(Math.abs(poseAt(t, 0, route({ pitch: 90, pitchPhases: [1, 2] })).pitch)).toBeLessThanOrEqual(90);
      expect(Math.abs(poseAt(t, 0, r).pitch - 10)).toBeLessThanOrEqual(PITCH_SWAY);
    }
    // 帧率：一秒之内不变，下一秒换；浮动 4%
    expect(poseAt(0.1, 0, r).fps).toBe(60);
    expect(poseAt(0.9, 0, r).fps).toBe(60);
    expect(poseAt(1.5, 0, r).fps).toBe(62);
    expect(poseAt(2.5, 0, r).fps).toBe(58);
    expect(poseAt(3.5, 0, r).fps).toBe(60);
    expect(poseAt(0, 0, route({ fpsBase: 1, fpsJitter: [-1] })).fps).toBe(1);
    // 同一时刻两次算出的结果相同
    expect(poseAt(1.234, 0.3, r)).toEqual(poseAt(1.234, 0.3, r));
  });

  it('T-TPL-C054-10 整体不透明度：首末帧为 0，停留阶段为 1', () => {
    const w = overlayWindows(60, 0.15, 4, 0.15);
    const a = (t: number) => progress(t, w.in) * (1 - progress(t, w.out));
    expect(a(0)).toBe(0);
    expect(a(1 / 60)).toBe(0);
    expect(a(0.15)).toBe(1);
    expect(a(2)).toBe(1);
    expect(a(w.duration - 1 / 60)).toBe(0);
    expect(a(w.duration)).toBe(0);
  });
});
