// test:engine 的测试页：用应用里同一份 EngineHost（Worker、Comlink、看门狗）驱动引擎，
// 在页面里算好统计量再交给 Playwright，避免把整帧像素序列化回 Node。
import blockWipe from '../../../packages/templates/m1-block-wipe/template.js?raw';
import manifestJson from '../../../packages/templates/m1-block-wipe/manifest.json';
import alphaRects from '../../fixtures/templates/alpha-rects.js?raw';
import movingRect from '../../fixtures/templates/moving-rect.js?raw';
import randomInUpdate from '../../fixtures/templates/random-in-update.js?raw';
import hangUpdate from '../../fixtures/templates/hang-update.js?raw';
import usesImport from '../../fixtures/templates/uses-import.js?raw';
import escapeAttempts from '../../fixtures/templates/escape-attempts.js?raw';
import m2Features from '../../fixtures/templates/m2-features.js?raw';
import { EngineHost, type WatchdogTimeouts } from '../../../apps/desktop/src/renderer/engine-host/EngineHost';
import { ANIM_COLORS, FAKE_STAMP, fakeColor, fakeResolveResource, setFakeVanillaFont } from './fake-resources';
import { frameCount } from '../../../packages/engine/src/frames';
import { TemplateManifestSchema, type FrameQuality, type OutputSettings, type ParamValues } from '../../../packages/template-sdk/src/index';

export const TEMPLATES = { blockWipe, alphaRects, movingRect, randomInUpdate, hangUpdate, usesImport, escapeAttempts, m2Features } as const;
export type TemplateName = keyof typeof TEMPLATES;

const manifest = TemplateManifestSchema.parse({ ...manifestJson, id: 'test.engine.fixture' });

async function exportEngine(name: TemplateName, output: OutputSettings, params: ParamValues = {}, timeouts?: Partial<WatchdogTimeouts>) {
  const host = await EngineHost.create({ mode: 'export', resolveResource: fakeResolveResource, strictDeterminism: true, timeouts });
  const loaded = await host.load({ manifest, code: TEMPLATES[name], params, output, resourceStamp: FAKE_STAMP });
  return { host, loaded };
}

async function sha256(bytes: Uint8Array<ArrayBuffer>): Promise<string> {
  const d = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  return Array.from(d, (b) => b.toString(16).padStart(2, '0')).join('');
}

function px(buf: Uint8Array, width: number, x: number, y: number): number[] {
  const o = (y * width + x) * 4;
  return [buf[o]!, buf[o + 1]!, buf[o + 2]!, buf[o + 3]!];
}

/** 确定性的洗牌（不用 Math.random，测试本身也要可复现） */
function shuffled(n: number): number[] {
  const order = Array.from({ length: n }, (_, i) => i);
  let s = 12345;
  for (let i = n - 1; i > 0; i--) {
    s = (Math.imul(s, 1103515245) + 12345) >>> 0;
    const j = s % (i + 1);
    [order[i], order[j]] = [order[j]!, order[i]!];
  }
  return order;
}

const harness = {
  frameCount,
  fakeColor,
  animColors: () => ANIM_COLORS,
  setFakeVanillaFont,

  /** M2 的场景（方块、物品、文字、精灵、动画贴图、缺失资源）：取若干帧的若干像素，以及 warnings */
  async scenario(scenario: string, extra: ParamValues, output: OutputSettings, indices: number[], points: [number, number][]) {
    const { host, loaded } = await exportEngine('m2Features', output, { scenario, ...extra });
    try {
      const frames: number[][][] = [];
      for (const i of indices) {
        const buf = await host.renderFrame(i, { subframes: 1, shutterAngle: 180 });
        frames.push(points.map(([x, y]) => px(buf, output.width, x, y)));
      }
      return { warnings: loaded.warnings, frames };
    } finally {
      host.dispose();
    }
  },

  /** 缩略图（3.10）：尺寸、不透明像素比例、中心像素 */
  async thumbnail(kind: 'block' | 'item', id: string, size: 64 | 128) {
    const host = await EngineHost.create({ mode: 'utility', resolveResource: fakeResolveResource, strictDeterminism: true });
    try {
      const bitmap = await host.renderThumbnail({ kind, id, size, resourceStamp: FAKE_STAMP });
      const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
      const g = canvas.getContext('2d')!;
      g.drawImage(bitmap, 0, 0);
      const d = g.getImageData(0, 0, bitmap.width, bitmap.height).data;
      let opaque = 0;
      for (let k = 3; k < d.length; k += 4) if (d[k]! > 200) opaque++;
      const c = ((bitmap.height >> 1) * bitmap.width + (bitmap.width >> 1)) * 4;
      return { width: bitmap.width, height: bitmap.height, opaqueFraction: opaque / (bitmap.width * bitmap.height), center: [d[c]!, d[c + 1]!, d[c + 2]!, d[c + 3]!], corner: d[3]! };
    } finally {
      host.dispose();
    }
  },

  /** T-ENG-1：每帧的 SHA-256；order 是渲染顺序，结果按帧号排列 */
  async frameHashes(name: TemplateName, output: OutputSettings, quality: FrameQuality, shuffle: boolean) {
    const { host, loaded } = await exportEngine(name, output);
    try {
      const total = frameCount(loaded.duration, output.fps);
      const order = shuffle ? shuffled(total) : Array.from({ length: total }, (_, i) => i);
      const hashes: string[] = new Array<string>(total);
      for (const i of order) hashes[i] = await sha256(await host.renderFrame(i, quality));
      return { duration: loaded.duration, cutTime: loaded.cutTime, order, hashes };
    } finally {
      host.dispose();
    }
  },

  /** 取一帧里若干像素 */
  async samplePixels(name: TemplateName, output: OutputSettings, index: number, quality: FrameQuality, points: [number, number][]) {
    const { host } = await exportEngine(name, output);
    try {
      const buf = await host.renderFrame(index, quality);
      return { length: buf.length, pixels: points.map(([x, y]) => px(buf, output.width, x, y)) };
    } finally {
      host.dispose();
    }
  },

  /** 一行的 alpha（T-ENG-3） */
  async rowAlpha(name: TemplateName, output: OutputSettings, index: number, quality: FrameQuality, y: number) {
    const { host } = await exportEngine(name, output);
    try {
      const buf = await host.renderFrame(index, quality);
      return Array.from({ length: output.width }, (_, x) => buf[(y * output.width + x) * 4 + 3]!);
    } finally {
      host.dispose();
    }
  },

  /** 帧的 alpha 极值（首末帧透明、剪辑点不透明） */
  async alphaRange(name: TemplateName, output: OutputSettings, indices: number[], quality: FrameQuality) {
    const { host, loaded } = await exportEngine(name, output);
    try {
      const out: { index: number; min: number; max: number }[] = [];
      for (const i of indices) {
        const idx = i < 0 ? frameCount(loaded.duration, output.fps) + i : i;
        const buf = await host.renderFrame(idx, quality);
        let min = 255;
        let max = 0;
        for (let k = 3; k < buf.length; k += 4) {
          if (buf[k]! < min) min = buf[k]!;
          if (buf[k]! > max) max = buf[k]!;
        }
        out.push({ index: idx, min, max });
      }
      return { duration: loaded.duration, cutTime: loaded.cutTime, frames: out };
    } finally {
      host.dispose();
    }
  },

  /**
   * T-ENG-4：同一 t、同一分辨率、N = 1，预览画布读回（预乘 alpha）换算成直通 alpha，与 renderFrame 比较。
   * 返回 alpha 的最大差、按 alpha 分档的颜色最大差，以及预乘域里的最大差。
   */
  async previewVsExport(name: TemplateName, output: OutputSettings, indices: number[]) {
    const canvas = document.createElement('canvas');
    document.body.append(canvas);
    const preview = await EngineHost.create({ mode: 'preview', canvas, resolveResource: fakeResolveResource, strictDeterminism: true });
    const { host } = await exportEngine(name, output);
    try {
      await preview.resize(output.width, output.height);
      await preview.load({ manifest, code: TEMPLATES[name], params: {}, output, resourceStamp: FAKE_STAMP });
      const results = [];
      for (const index of indices) {
        const t = index / output.fps;
        const p = await preview.readPreview(t);
        const e = await host.renderFrame(index, { subframes: 1, shutterAngle: 180 });
        let alpha = 0;
        let colorOpaque = 0; // alpha = 255
        let colorHigh = 0; // alpha ≥ 128
        let colorAny = 0; // alpha > 0
        let premul = 0;
        let partial = 0;
        let nonEmpty = 0;
        for (let k = 0; k < e.length; k += 4) {
          const a = e[k + 3]!;
          const pa = p[k + 3]!;
          alpha = Math.max(alpha, Math.abs(a - pa));
          if (a > 0) nonEmpty++;
          if (a > 0 && a < 255) partial++;
          for (let c = 0; c < 3; c++) {
            premul = Math.max(premul, Math.abs(Math.round((e[k + c]! * a) / 255) - p[k + c]!));
            if (pa === 0) continue;
            const straight = Math.min(255, Math.round((p[k + c]! * 255) / pa));
            const d = Math.abs(straight - e[k + c]!);
            colorAny = Math.max(colorAny, d);
            if (a >= 128) colorHigh = Math.max(colorHigh, d);
            if (a === 255) colorOpaque = Math.max(colorOpaque, d);
          }
        }
        results.push({ index, alpha, colorOpaque, colorHigh, colorAny, premul, partial, nonEmpty, length: p.length === e.length });
      }
      return results;
    } finally {
      preview.dispose();
      host.dispose();
      canvas.remove();
    }
  },

  /** T-ENG-5：同一帧按 1× 和 2× 分辨率渲染，后者 2×2 平均缩小一半（预乘域），比较平均绝对误差 */
  async resolutionIndependence(name: TemplateName, base: OutputSettings, index: number, quality: FrameQuality) {
    const big: OutputSettings = { ...base, width: base.width * 2, height: base.height * 2 };
    const a = await exportEngine(name, base);
    const b = await exportEngine(name, big);
    try {
      const small = await a.host.renderFrame(index, quality);
      const large = await b.host.renderFrame(index, quality);
      const W = base.width;
      const premulAt = (buf: Uint8Array, w: number, x: number, y: number, c: number) => {
        const o = (y * w + x) * 4;
        return c === 3 ? buf[o + 3]! : (buf[o + c]! * buf[o + 3]!) / 255;
      };
      let sum = 0;
      let opaque = 0;
      for (let y = 0; y < base.height; y++) {
        for (let x = 0; x < W; x++) {
          if (small[(y * W + x) * 4 + 3] === 255) opaque++;
          for (let c = 0; c < 4; c++) {
            const s = premulAt(small, W, x, y, c);
            let l = 0;
            for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 2; dx++) l += premulAt(large, big.width, 2 * x + dx, 2 * y + dy, c);
            sum += Math.abs(s - l / 4);
          }
        }
      }
      return { mae: sum / (W * base.height * 4), opaqueFraction: opaque / (W * base.height) };
    } finally {
      a.host.dispose();
      b.host.dispose();
    }
  },

  /** 装载或渲染应当失败的模板：返回错误信息 */
  async expectFailure(name: TemplateName, output: OutputSettings, timeouts?: Partial<WatchdogTimeouts>) {
    const started = performance.now();
    try {
      const { host } = await exportEngine(name, output, {}, timeouts);
      try {
        await host.renderFrame(0, { subframes: 1, shutterAngle: 180 });
        return { failed: false, name: '', message: '', ms: performance.now() - started, dead: host.dead };
      } catch (error) {
        return { failed: true, name: (error as Error).name, message: (error as Error).message, ms: performance.now() - started, dead: host.dead };
      } finally {
        host.dispose();
      }
    } catch (error) {
      return { failed: true, name: (error as Error).name, message: (error as Error).message, ms: performance.now() - started, dead: true };
    }
  },

  /** 装载模板，返回 warnings（escape-attempts 用它报告结果） */
  async loadWarnings(name: TemplateName, output: OutputSettings) {
    const { host, loaded } = await exportEngine(name, output);
    host.dispose();
    return loaded.warnings;
  },

  /** 一个 Worker 实例重复用：渲染两次同一帧，中间穿插别的帧（2.4 的确定性自检） */
  async selfCheck(name: TemplateName, output: OutputSettings, index: number, other: number[]) {
    const { host } = await exportEngine(name, output);
    try {
      const q = { subframes: 8, shutterAngle: 180 };
      const first = await sha256(await host.renderFrame(index, q));
      for (const o of other) await host.renderFrame(o, q);
      const second = await sha256(await host.renderFrame(index, q));
      return { first, second };
    } finally {
      host.dispose();
    }
  },
};

export type Harness = typeof harness;
declare global {
  interface Window {
    harness: Harness;
    harnessReady: boolean;
  }
}
window.harness = harness;
window.harnessReady = true;
