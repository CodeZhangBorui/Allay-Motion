// 014 冰封碎裂 allay.builtin.ice-shatter 的验收测试（docs/template-catalog.md 第 2 节、docs/templates/ice-shatter.md）。
// 画面本身由 test:engine 的 T-TPL-3、4、5 检查；这里测 manifest 和纯函数（结冰的阈值、裂纹、碎片的先后、碎片网不漏缝）。
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { applyPreset, defaultParams, localizePresetParams, parseManifest, sameValue, sanitizeParams, type ParamDef } from '../../packages/template-sdk/src/index';
import { polygonArea, polygonCentroid, voronoiCells, type Point } from '../../packages/templates/ice-shatter/src/voronoi';
import { BURST_START, CRACK_END, crackRadius, FREEZE_MARGIN, freezeThreshold, shardDelay, shardMesh, shardProgress, shardSites } from '../../packages/templates/ice-shatter/src/layout';

const manifest = (() => {
  const r = parseManifest(JSON.parse(readFileSync(join(import.meta.dirname, '../../packages/templates/ice-shatter/manifest.json'), 'utf8')));
  if (!r.ok) throw new Error(`manifest invalid: ${JSON.stringify(r)}`);
  return r.manifest;
})();
const defs = manifest.params ?? [];
const def = (key: string): ParamDef => defs.find((p) => p.key === key)!;
const range = (key: string): [number, number] => {
  const p = def(key);
  if (p.type !== 'duration') throw new Error(key);
  return [p.min, p.max];
};

/** mulberry32 */
function prng(seed: number) {
  let a = seed >>> 0;
  return {
    next() {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    },
  };
}

describe('T-TPL-C014 冰封碎裂', () => {
  it('T-TPL-C014-1 manifest 合法，默认参数清洗后不变；转场、分组 blocks、三段时间线；默认的冰是浮冰，默认音效带命名空间', () => {
    expect(manifest.id).toBe('allay.builtin.ice-shatter');
    expect(manifest.category).toBe('transition');
    expect(manifest.tags?.[0]).toBe('blocks');
    const d = defaultParams(defs, { locale: 'zh-CN' });
    expect(sanitizeParams(defs, d)).toEqual(d);
    expect(manifest.timeline?.segments.map((s) => s.param)).toEqual(['inDuration', 'hold', 'outDuration']);
    const [i, h, o] = [range('inDuration'), range('hold'), range('outDuration')];
    expect(i[0] + h[0] + o[0]).toBeGreaterThanOrEqual(0.1);
    expect(i[1] + h[1] + o[1]).toBeLessThanOrEqual(30);
    expect(d.block).toBe('minecraft:packed_ice');
    expect(d.shatterSound).toBe('minecraft:block.glass.break');
    for (const p of defs) if (p.type === 'sound' && p.default !== null) expect(p.default).toMatch(/^minecraft:[a-z0-9_.]+$/);
  });

  it('T-TPL-C014-2 每个自带预设都能载入：值经过清洗后不变', () => {
    expect(manifest.presets?.length).toBeGreaterThanOrEqual(2);
    for (const preset of manifest.presets ?? []) {
      for (const locale of ['zh-CN', 'en']) {
        // 和应用里套用预设走同一条路（applyPreset：按界面语言取出双语的文字，再清洗）
        const applied = applyPreset(defs, preset, { locale });
        for (const [k, v] of Object.entries(localizePresetParams(defs, preset.params, locale))) expect(sameValue(applied[k], v), `${preset.key}.${k} ${locale}`).toBe(true);
      }
    }
  });

  it('T-TPL-C014-3 结冰的阈值：进度 0 时一点冰和霜都没有，进度 1 时全是冰、刚结冰的白也褪完了', () => {
    // 结冰场 f ∈ [0, 1]；冰在 f < A，前沿外面的白霜在 A − 0.07 < f < A 之外……着色器里是 d = A − f
    expect(freezeThreshold(0)).toBe(-FREEZE_MARGIN);
    expect(freezeThreshold(0) + 0.07).toBeLessThan(0);
    // 进度 1：离最晚结冰的地方（f = 1）也有 0.14 以上，刚结冰的白（d < 0.14）没有了，和碎片静止时的样子一样
    expect(freezeThreshold(1) - 1).toBeGreaterThanOrEqual(0.14);
    let last = -Infinity;
    for (let a = 0; a <= 1; a += 0.05) {
      expect(freezeThreshold(a)).toBeGreaterThanOrEqual(last);
      last = freezeThreshold(a);
    }
  });

  it('T-TPL-C014-4 裂纹和碎片的先后：裂纹在 CRACK_END 前扩散到最远处；碎片在 BURST_START 之后陆续飞、退出结束时全部走完', () => {
    expect(crackRadius(0)).toBe(0);
    expect(crackRadius(CRACK_END)).toBeGreaterThanOrEqual(1);
    expect(BURST_START).toBeLessThan(CRACK_END);
    for (const dist of [0, 0.3, 1]) {
      for (const j of [0, 0.5, 1]) {
        const d = shardDelay(dist, j);
        expect(d).toBeGreaterThanOrEqual(BURST_START);
        expect(d).toBeLessThanOrEqual(0.7);
        expect(shardProgress(d, d)).toBe(0);
        expect(shardProgress(1, d)).toBe(1);
      }
    }
    // 近的先飞
    expect(shardDelay(0.1, 0.5)).toBeLessThan(shardDelay(0.9, 0.5));
  });

  it('T-TPL-C014-5 碎片网：拼起来正好是整个矩形，内部的每条边被相邻两块共用（顶点合并过，静止时不漏缝）', () => {
    const [x0, y0, x1, y1] = [-980, -560, 980, 560];
    const sites = shardSites(40, [120, 60], x0, y0, x1, y1, prng(3));
    expect(sites.length).toBe(40);
    const mesh = shardMesh(sites, x0, y0, x1, y1);
    let area = 0;
    const edges = new Map<string, number>();
    for (const s of mesh.shards) {
      const poly = s.ring.map((i) => mesh.vertices[i]!);
      area += polygonArea(poly);
      for (let k = 0; k < s.ring.length; k++) {
        const a = s.ring[k]!;
        const b = s.ring[(k + 1) % s.ring.length]!;
        edges.set(`${a}>${b}`, (edges.get(`${a}>${b}`) ?? 0) + 1);
      }
    }
    expect(area).toBeCloseTo((x1 - x0) * (y1 - y0), 0);
    // 每条有向边最多出现一次；不在外框上的边，反方向也出现（相邻那一块）
    const onBorder = (i: number) => {
      const [x, y] = mesh.vertices[i]!;
      return Math.abs(x - x0) < 1e-6 || Math.abs(x - x1) < 1e-6 || Math.abs(y - y0) < 1e-6 || Math.abs(y - y1) < 1e-6;
    };
    for (const [key, n] of edges) {
      expect(n).toBe(1);
      const [a, b] = key.split('>').map(Number) as [number, number];
      if (!(onBorder(a) && onBorder(b))) expect(edges.has(`${b}>${a}`), key).toBe(true);
    }
  });

  it('T-TPL-C014-6 泰森多边形：每块包含自己的格点，面积加起来正好是整个矩形，凸、逆时针', () => {
    const r = prng(7);
    const sites: Point[] = Array.from({ length: 60 }, () => [r.next() * 1920 - 960, r.next() * 1080 - 540] as const);
    const cells = voronoiCells(sites, -960, -540, 960, 540);
    expect(cells).toHaveLength(60);
    let total = 0;
    for (const cell of cells) {
      const a = polygonArea(cell.polygon);
      expect(a).toBeGreaterThan(0);
      total += a;
      // 格点在自己那一块里：每条边的叉积同号（逆时针时都 ≥ 0）
      const poly = cell.polygon;
      for (let i = 0; i < poly.length; i++) {
        const p = poly[i]!;
        const q = poly[(i + 1) % poly.length]!;
        const cross = (q[0] - p[0]) * (cell.site[1] - p[1]) - (q[1] - p[1]) * (cell.site[0] - p[0]);
        expect(cross).toBeGreaterThanOrEqual(-1e-6);
      }
      // 块里的点离自己的格点最近
      const c = polygonCentroid(poly);
      const own = Math.hypot(c[0] - cell.site[0], c[1] - cell.site[1]);
      for (const s of sites) expect(Math.hypot(c[0] - s[0], c[1] - s[1])).toBeGreaterThanOrEqual(own - 1e-6);
    }
    expect(total).toBeCloseTo(1920 * 1080, 3);
  });

  it('T-TPL-C014-7 泰森多边形：只有一个格点时是整个矩形；形心和面积的公式', () => {
    const [only] = voronoiCells([[10, 20]], 0, 0, 100, 50);
    expect(polygonArea(only!.polygon)).toBeCloseTo(5000, 6);
    expect(polygonCentroid(only!.polygon)).toEqual([50, 25]);
    // 退化的多边形取顶点平均
    expect(polygonCentroid([[0, 0], [2, 0], [4, 0]])).toEqual([2, 0]);
  });
});
