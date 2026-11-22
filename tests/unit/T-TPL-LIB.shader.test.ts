// _lib 里第 4 批加的着色器工具（packages/templates/_lib/src/shader-*.ts）的单元测试：纯函数部分。
// 着色器本身（编译、画面）由各模板的引擎测试 T-TPL-3、4、5 覆盖。
import { describe, expect, it } from 'vitest';
import { framesPerStep, frameStep, GLSL_COMMON, outputPixel, shaderSeed, stepStart, VERTEX } from '../../packages/templates/_lib/src/shader-kit';
import { fitLife } from '../../packages/templates/_lib/src/shader-particles';

describe('T-TPL-LIB shader', () => {
  it('T-TPL-LIB-S1 按帧对齐的步：同一帧的所有子帧（离帧时刻不到半帧）落在同一步里，换步在两帧正中间', () => {
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

  it('T-TPL-LIB-S2 种子、输出像素', () => {
    expect(shaderSeed(1)).toBe(1);
    expect(shaderSeed(-1)).toBe(16777215);
    expect(shaderSeed(16777216 + 5)).toBe(5);
    expect(shaderSeed('x')).toBe(1);
    expect(outputPixel({ pixelScale: 1 })).toBe(1);
    expect(outputPixel({ pixelScale: 0.125 })).toBe(8);
  });

  it('T-TPL-LIB-S3 公用的 GLSL：不设 glslVersion 也能编译的写法（用 gl_FragColor 的着色器里不出现 GLSL3 才有的 out 声明），带上舞台尺寸', () => {
    expect(GLSL_COMMON).toContain('uniform vec2 uStage;');
    expect(GLSL_COMMON).not.toMatch(/\bout\s+vec4\b/);
    expect(GLSL_COMMON).not.toMatch(/#version/);
    expect(VERTEX).toContain('vPos');
    // 不用 GLSL 的保留字当变量名（half、short 在 GLSL ES 里是保留的）
    expect(GLSL_COMMON).not.toMatch(/\b(half|short|long|double)\b\s+\w+\s*=/);
  });

  it('T-TPL-LIB-S4 粒子的寿命收进时间窗：出生不早于开始，死亡不晚于结束，寿命至少 minLife（时间窗更短时是整个时间窗）', () => {
    const [first, last] = [0.1, 2.4];
    for (let i = 0; i < 400; i++) {
      // 出生从时间窗前 0.5 秒到后 0.5 秒，寿命 0–1.5 秒
      const birth = first - 0.5 + ((i * 0.6180339887) % 1) * (last - first + 1);
      const life = ((i * 0.4142135623) % 1) * 1.5;
      const f = fitLife(birth, life, first, last);
      expect(f.birth).toBeGreaterThanOrEqual(first);
      expect(f.birth + f.life).toBeLessThanOrEqual(last + 1e-12);
      expect(f.life).toBeGreaterThanOrEqual(0.05 - 1e-12);
      // 本来就在时间窗里的不动
      if (birth >= first && birth + Math.max(life, 0.05) <= last) expect(f).toEqual({ birth, life: Math.max(life, 0.05) });
    }
    expect(fitLife(5, 1, 0, 0.02)).toEqual({ birth: 0, life: 0.02 });
  });
});
