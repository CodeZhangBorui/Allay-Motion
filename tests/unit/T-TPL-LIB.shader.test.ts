// _lib 里第 4 批加的着色器工具（packages/templates/_lib/src/shader-*.ts）的单元测试：纯函数部分。
// 着色器本身（编译、画面）由各模板的引擎测试 T-TPL-3、4、5 覆盖。
import { describe, expect, it } from 'vitest';
import { framesPerStep, frameStep, GLSL_COMMON, outputPixel, shaderSeed, stepStart, VERTEX } from '../../packages/templates/_lib/src/shader-kit';
import { polygonArea, polygonCentroid, voronoiCells, type Point } from '../../packages/templates/_lib/src/shader-voronoi';

/** 固定种子的伪随机数（mulberry32），测试可复现 */
function prng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe('T-TPL-LIB shader', () => {
  it('T-TPL-LIB-S1 泰森多边形：每块包含自己的格点，面积加起来正好是整个矩形，凸、逆时针', () => {
    const r = prng(7);
    const sites: Point[] = Array.from({ length: 60 }, () => [r() * 1920 - 960, r() * 1080 - 540] as const);
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

  it('T-TPL-LIB-S2 泰森多边形：只有一个格点时是整个矩形；形心和面积的公式', () => {
    const [only] = voronoiCells([[10, 20]], 0, 0, 100, 50);
    expect(polygonArea(only!.polygon)).toBeCloseTo(5000, 6);
    expect(polygonCentroid(only!.polygon)).toEqual([50, 25]);
    // 退化的多边形取顶点平均
    expect(polygonCentroid([[0, 0], [2, 0], [4, 0]])).toEqual([2, 0]);
  });

  it('T-TPL-LIB-S3 按帧对齐的步：同一帧的所有子帧（离帧时刻不到半帧）落在同一步里，换步在两帧正中间', () => {
    for (const fps of [24, 30, 60]) {
      const k = framesPerStep(0.05, fps);
      expect(k).toBe(Math.max(1, Math.round(0.05 * fps)));
      for (let frame = 0; frame < 120; frame++) {
        const t = frame / fps;
        const s = frameStep(t, fps, k);
        // 快门角 360° 时子帧最多偏离 (0.5 − 0.5 / N) 帧
        for (const off of [-0.49, -0.25, 0, 0.25, 0.49]) expect(frameStep(t + off / fps, fps, k)).toBe(s);
        expect(s).toBe(Math.floor((frame + 0.5) / k));
        // 这一步开始的时刻在它的第一帧之前半帧
        expect(stepStart(s, fps, k)).toBeLessThanOrEqual(t + 1e-9);
        expect(frameStep(stepStart(s, fps, k) + 1e-9, fps, k)).toBe(s);
      }
    }
    expect(framesPerStep(0, 60)).toBe(1);
  });

  it('T-TPL-LIB-S4 种子、输出像素', () => {
    expect(shaderSeed(1)).toBe(1);
    expect(shaderSeed(-1)).toBe(16777215);
    expect(shaderSeed(16777216 + 5)).toBe(5);
    expect(shaderSeed('x')).toBe(1);
    expect(outputPixel({ pixelScale: 1 })).toBe(1);
    expect(outputPixel({ pixelScale: 0.125 })).toBe(8);
  });

  it('T-TPL-LIB-S5 公用的 GLSL：不设 glslVersion 也能编译的写法（用 gl_FragColor 的着色器里不出现 GLSL3 才有的 out 声明），带上舞台尺寸', () => {
    expect(GLSL_COMMON).toContain('uniform vec2 uStage;');
    expect(GLSL_COMMON).not.toMatch(/\bout\s+vec4\b/);
    expect(GLSL_COMMON).not.toMatch(/#version/);
    expect(VERTEX).toContain('vPos');
    // 不用 GLSL 的保留字当变量名（half、short 在 GLSL ES 里是保留的）
    expect(GLSL_COMMON).not.toMatch(/\b(half|short|long|double)\b\s+\w+\s*=/);
  });
});
