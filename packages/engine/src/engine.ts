// 引擎本体（docs/02-engine.md）。运行在 Dedicated Worker 里；宿主经 Comlink 调用（2.3）。
// 不依赖 DOM、React、Electron、Node，只用 Worker 里可用的 Web API。
import * as THREE from 'three';
import {
  FrameQualitySchema,
  LoadRequestSchema,
  OpaqueSchema,
  ParamValuesSchema,
  ResizeSchema,
  ThumbRequestSchema,
  EngineModeSchema,
  type AudioCue,
  type EngineMode,
  type FrameQuality,
  type FrameStats,
  type LoadRequest,
  type LoadResult,
  type Opaque,
  type ParamValues,
  type ResourceKind,
  type ResourcePayload,
  type SetupContext,
  type StageInfo,
  type TemplateInstance,
  type TemplateModule,
  type ThumbRequest,
  sanitizeParams,
  seedOf,
  type TemplateManifest,
} from '@allay/template-sdk';
import { createBlockHandle } from './blocks';
import { ease, math, segment } from './ease';
import { frameTime, subframeTimes } from './frames';
import { DeterminismGuard } from './harden';
import { createNoise2D, type Noise2D } from './noise';
import { createItemHandle } from './items';
import { FramePipeline } from './pipeline';
import { createRng } from './random';
import { EngineResources } from './resources';
import { createSprite } from './sprite';
import { computeStage, createDefaultCamera, createStageCamera } from './stage';
import { createGlyphSource, createText } from './text';
import { buildThumbScene } from './thumbnail';

/** 宿主实现的回调，经 Comlink.proxy 传入（2.3） */
export interface HostCallbacks {
  resolveResource(kind: ResourceKind, id: string): Promise<ResourcePayload | null>;
  log(level: 'debug' | 'warn' | 'error', message: string): void;
}

export interface InitOptions {
  /** 预览模式：主线程用 transferControlToOffscreen() 交来的画布 */
  canvas?: OffscreenCanvas;
  mode: EngineMode;
  /** 开发构建：update(t) 期间拦截 Math.random、Date.now、performance.now（2.4） */
  strictDeterminism?: boolean;
}

/** 引擎对外的接口（2.3） */
export interface EngineApi {
  init(opts: InitOptions, host: HostCallbacks): Promise<void>;
  load(req: LoadRequest): Promise<LoadResult>;
  setParams(params: ParamValues): Promise<LoadResult>;
  resize(width: number, height: number): void;
  render(t: number, quality?: FrameQuality): Promise<FrameStats>;
  renderFrame(index: number, quality: FrameQuality, opaque?: Opaque): Promise<ArrayBuffer>;
  /** 方块、物品的缩略图（03-assets.md 3.10）；杂务和导出引擎可用 */
  renderThumbnail(req: ThumbRequest): Promise<ImageBitmap>;
  /** 诊断与测试用：按 t 画一帧预览（N = 1），并读回 canvas 上的像素（预乘 alpha，第一行是顶部） */
  readPreview(t: number): Promise<ArrayBuffer>;
  dispose(): void;
}

export class TemplateError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'TemplateError';
  }
}

const DEFAULT_QUALITY: FrameQuality = { subframes: 1, shutterAngle: 180 };
const MAX_WARNINGS = 50;

interface Loaded {
  module: TemplateModule;
  code: string;
  manifest: TemplateManifest;
  locale: string;
  output: LoadRequest['output'];
  stage: StageInfo;
  params: ParamValues;
}

interface Active {
  instance: TemplateInstance;
  scene: THREE.Scene;
  /** 这次 setup 自己建的贴图（文字），实例销毁时释放 */
  owned: THREE.Texture[];
  /** setup 之后模板还可能经 setCamera 换相机：渲染时取最新的 */
  camera(): THREE.Camera;
  duration: number;
  cutTime: number | null;
}

/** sRGB 编码的 #RRGGBB → 线性 RGB */
function hexToLinear(hex: string): [number, number, number] {
  const c = new THREE.Color().setStyle(hex, THREE.SRGBColorSpace);
  return [c.r, c.g, c.b];
}

/** 把模板源码当作 ESM 装载（2.4）：Blob URL + 动态 import */
async function importTemplate(code: string): Promise<TemplateModule> {
  const url = URL.createObjectURL(new Blob([code], { type: 'text/javascript' }));
  let mod: unknown;
  try {
    mod = await import(/* @vite-ignore */ url);
  } catch (error) {
    throw new TemplateError(`template failed to load: ${error instanceof Error ? error.message : String(error)}`, { cause: error });
  } finally {
    URL.revokeObjectURL(url);
  }
  const def = (mod as { default?: unknown }).default;
  if (!def || typeof (def as { setup?: unknown }).setup !== 'function') {
    throw new TemplateError('template must default-export an object with a setup(ctx) function');
  }
  return def as TemplateModule;
}

function validateInstance(value: unknown): Active['instance'] {
  if (!value || typeof value !== 'object') throw new TemplateError('setup() must return an object');
  const inst = value as Partial<TemplateInstance>;
  if (typeof inst.update !== 'function') throw new TemplateError('instance.update must be a function');
  if (typeof inst.duration !== 'number' || !Number.isFinite(inst.duration) || inst.duration < 0.1 || inst.duration > 30) {
    throw new TemplateError(`instance.duration must be between 0.1 and 30 seconds, got ${String(inst.duration)}`);
  }
  const cut = inst.cutTime;
  if (cut !== undefined && cut !== null && (typeof cut !== 'number' || !Number.isFinite(cut) || cut < 0 || cut > inst.duration)) {
    throw new TemplateError(`instance.cutTime must be within [0, duration], got ${String(cut)}`);
  }
  if (inst.dispose !== undefined && typeof inst.dispose !== 'function') throw new TemplateError('instance.dispose must be a function');
  return inst as TemplateInstance;
}

/** manifest 有参数定义时按定义清洗；派生模板交来的是生效 manifest（4.7），也带参数定义 */
function cleanParams(manifest: TemplateManifest, params: ParamValues, locale: string): ParamValues {
  return manifest.params ? sanitizeParams(manifest.params, params, { locale }) : params;
}

/** 释放场景里模板创建的几何体和材质。贴图属于引擎的缓存，不在这里释放 */
function disposeScene(scene: THREE.Scene): void {
  scene.traverse((obj) => {
    const mesh = obj as Partial<THREE.Mesh>;
    mesh.geometry?.dispose();
    const material = mesh.material;
    if (Array.isArray(material)) for (const m of material) m.dispose();
    else material?.dispose();
  });
  scene.clear();
}

export class Engine implements EngineApi {
  private mode: EngineMode = 'preview';
  private host: HostCallbacks | null = null;
  private renderer: THREE.WebGLRenderer | null = null;
  private pipeline: FramePipeline | null = null;
  private guard = new DeterminismGuard(false);

  private loaded: Loaded | null = null;
  private active: Active | null = null;
  private resources: EngineResources | null = null;
  private readonly times: number[] = [];

  async init(opts: InitOptions, host: HostCallbacks): Promise<void> {
    if (this.renderer) throw new Error('engine already initialised');
    this.mode = EngineModeSchema.parse(opts.mode);
    this.host = host;
    this.resources = new EngineResources(
      (kind, id) => host.resolveResource(kind, id),
      (level, message) => host.log(level, message),
    );
    this.guard = new DeterminismGuard(opts.strictDeterminism === true);
    THREE.ColorManagement.enabled = true;

    let canvas: OffscreenCanvas;
    if (this.mode === 'preview') {
      if (!(opts.canvas instanceof OffscreenCanvas)) throw new Error('preview mode needs an OffscreenCanvas');
      canvas = opts.canvas;
    } else {
      // 导出和杂务只渲染到离屏目标，默认帧缓冲用不到
      canvas = new OffscreenCanvas(1, 1);
    }
    const renderer = new THREE.WebGLRenderer({
      canvas,
      alpha: true,
      premultipliedAlpha: true,
      antialias: false,
      depth: true,
      stencil: false,
      preserveDrawingBuffer: false,
      powerPreference: 'high-performance',
    });
    renderer.setPixelRatio(1);
    renderer.toneMapping = THREE.NoToneMapping;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.setClearColor(0x000000, 0);
    const gl = renderer.getContext();
    if (!(gl instanceof WebGL2RenderingContext)) throw new Error('WebGL2 is required');
    if (!gl.getExtension('EXT_color_buffer_float') && !gl.getExtension('EXT_color_buffer_half_float')) {
      throw new Error('half-float render targets are not supported');
    }
    this.renderer = renderer;
    this.pipeline = new FramePipeline(renderer, Math.max(1, canvas.width), Math.max(1, canvas.height), this.mode !== 'preview');
  }

  async load(req: LoadRequest): Promise<LoadResult> {
    const parsed = LoadRequestSchema.parse(req);
    this.requireInit();
    this.resources!.setStamp(parsed.resourceStamp);
    const module = this.loaded && this.loaded.code === parsed.code ? this.loaded.module : await importTemplate(parsed.code);
    const stage = computeStage(parsed.output);
    const locale = parsed.locale ?? 'en';
    // 参数经 template-sdk 的校验函数清洗（4.4）：缺的补默认值，多的丢弃，类型不对的回到默认值，越界的钳制
    const params = cleanParams(parsed.manifest, parsed.params, locale);
    this.loaded = { module, code: parsed.code, manifest: parsed.manifest, locale, output: parsed.output, stage, params };
    if (this.mode !== 'preview') this.pipeline!.setSize(parsed.output.width, parsed.output.height);
    return this.setup();
  }

  async setParams(params: ParamValues): Promise<LoadResult> {
    const parsed = ParamValuesSchema.parse(params);
    if (!this.loaded) throw new Error('no template loaded');
    this.loaded = { ...this.loaded, params: cleanParams(this.loaded.manifest, parsed, this.loaded.locale) };
    return this.setup();
  }

  resize(width: number, height: number): void {
    const [w, h] = ResizeSchema.parse([width, height]);
    if (this.mode !== 'preview') throw new Error('resize() is only for the preview engine');
    this.renderer!.setSize(w, h, false);
    this.pipeline!.setSize(w, h);
  }

  async render(t: number, quality: FrameQuality = DEFAULT_QUALITY): Promise<FrameStats> {
    const q = FrameQualitySchema.parse(quality);
    if (this.mode !== 'preview') throw new Error('render() is only for the preview engine');
    const start = performance.now();
    const active = this.active;
    if (!active) {
      this.renderer!.setRenderTarget(null);
      this.renderer!.clear(true, true, false);
      return { t, ms: performance.now() - start };
    }
    const tc = Math.min(active.duration, Math.max(0, Number.isFinite(t) ? t : 0));
    this.pipeline!.renderToCanvas(this.passOptions(active, tc, q));
    return { t: tc, ms: performance.now() - start };
  }

  async renderFrame(index: number, quality: FrameQuality, opaque?: Opaque): Promise<ArrayBuffer> {
    const q = FrameQualitySchema.parse(quality);
    const o = opaque === undefined ? undefined : OpaqueSchema.parse(opaque);
    if (!Number.isInteger(index) || index < 0) throw new Error('frame index must be a non-negative integer');
    if (this.mode === 'preview') throw new Error('renderFrame() is for export and utility engines');
    const active = this.requireActive();
    const t = frameTime(index, this.loaded!.output.fps, active.duration);
    const pixels = this.pipeline!.renderToPixels(this.passOptions(active, t, q), o ? 'opaque' : 'straight', o ? hexToLinear(o.key) : [0, 0, 0]);
    return pixels.buffer;
  }

  async readPreview(t: number): Promise<ArrayBuffer> {
    if (this.mode !== 'preview') throw new Error('readPreview() is only for the preview engine');
    await this.render(t, DEFAULT_QUALITY);
    // 同一个任务里读，画布还没被提交和清掉
    const gl = this.renderer!.getContext();
    const { width, height } = this.pipeline!.size;
    const raw = new Uint8Array(width * height * 4);
    gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, raw);
    // 默认帧缓冲的第一行是底部，翻成顶部在前
    const out = new Uint8Array(raw.length);
    const row = width * 4;
    for (let y = 0; y < height; y++) out.set(raw.subarray((height - 1 - y) * row, (height - y) * row), y * row);
    return out.buffer;
  }

  async renderThumbnail(req: ThumbRequest): Promise<ImageBitmap> {
    const r = ThumbRequestSchema.parse(req);
    if (this.mode === 'preview') throw new Error('renderThumbnail() is for utility and export engines');
    this.requireInit();
    const resources = this.resources!;
    resources.setStamp(r.resourceStamp);
    const { scene, camera } = await buildThumbScene(resources, r.kind, r.id, () => undefined);
    try {
      const pipeline = this.pipeline!;
      pipeline.setSize(r.size, r.size);
      const pixels = pipeline.renderToPixels({ scene, camera, times: [0], update: (t) => resources.applyAnimations(t) }, 'straight', [0, 0, 0]);
      return await createImageBitmap(new ImageData(new Uint8ClampedArray(pixels.buffer as ArrayBuffer), r.size, r.size), { premultiplyAlpha: 'none' });
    } finally {
      disposeScene(scene);
      // 导出引擎上的模板仍按原来的输出尺寸渲染
      if (this.loaded) this.pipeline!.setSize(this.loaded.output.width, this.loaded.output.height);
    }
  }

  dispose(): void {
    this.disposeActive();
    this.resources?.dispose();
    this.pipeline?.dispose();
    this.renderer?.dispose();
    this.renderer = null;
    this.pipeline = null;
    this.loaded = null;
  }

  // ---- 内部 ----

  private passOptions(active: Active, t: number, q: FrameQuality) {
    const fps = this.loaded!.output.fps;
    return {
      scene: active.scene,
      camera: active.camera(),
      times: subframeTimes(t, q.subframes, q.shutterAngle, fps, active.duration, this.times),
      update: (tk: number) => {
        // 动画贴图的帧是 t 的函数，每个子帧更新（2.8）
        this.resources!.applyAnimations(tk);
        this.guard.run(() => active.instance.update(tk));
      },
    };
  }

  private requireInit(): void {
    if (!this.renderer || !this.pipeline || !this.host) throw new Error('engine not initialised');
  }

  private requireActive(): Active {
    if (!this.active) throw new Error('no template loaded');
    return this.active;
  }

  private disposeActive(): void {
    const active = this.active;
    this.active = null;
    if (!active) return;
    try {
      active.instance.dispose?.();
    } catch (error) {
      this.host?.log('warn', `template dispose() threw: ${error instanceof Error ? error.message : String(error)}`);
    }
    disposeScene(active.scene);
    for (const t of active.owned) t.dispose();
  }

  private async setup(): Promise<LoadResult> {
    this.requireInit();
    const loaded = this.loaded!;
    this.disposeActive();

    const warnings: string[] = [];
    const warn = (message: string) => {
      if (warnings.length < MAX_WARNINGS) warnings.push(String(message).slice(0, 500));
    };
    const cues: AudioCue[] = [];
    let setupDone = false;
    const resources = this.resources!;
    const owned: THREE.Texture[] = [];
    // text.create 是同步的，字体要在 setup 之前载好
    const glyphs = createGlyphSource(await resources.fonts());

    const scene = new THREE.Scene();
    let camera: THREE.Camera = createDefaultCamera(loaded.stage);
    // 模板有 seed 类型的参数时以它为种子（4.4）；没有参数定义的测试模板沿用 params.seed
    const seedParam = loaded.manifest.params ? seedOf(loaded.manifest.params, loaded.params) : loaded.params.seed;
    const seed = typeof seedParam === 'number' && Number.isFinite(seedParam) ? seedParam : 0;
    const noises = new Map<string, Noise2D>();

    const ctx: SetupContext = {
      THREE,
      params: Object.freeze({ ...loaded.params }),
      stage: Object.freeze({ ...loaded.stage }),
      scene,
      get camera() {
        return camera;
      },
      setCamera(next) {
        if (!(next instanceof THREE.Camera)) throw new TypeError('setCamera() expects a THREE.Camera');
        camera = next;
      },
      createStageCamera: (opts) => createStageCamera(loaded.stage, opts.fov),
      resources: {
        texture: (id) => resources.texture(id, warn),
        block: (id, opts) => createBlockHandle(resources, id, opts, warn),
        item: (id) => createItemHandle(resources, id, warn),
      },
      text: { create: (opts) => createText(opts, glyphs, warn, owned) },
      sprite: { create: (texture, opts) => createSprite(texture, opts) },
      random: (key = '') => createRng(seed, String(key)),
      noise2D: (x, y, key = '') => {
        const k = String(key);
        let fn = noises.get(k);
        if (!fn) {
          fn = createNoise2D(seed, k);
          noises.set(k, fn);
        }
        return fn(x, y);
      },
      ease,
      math,
      time: { segment },
      audio: {
        cue(sound, at, opts = {}) {
          if (setupDone) throw new TemplateError('ctx.audio.cue() may only be called during setup()');
          if (sound === null) return;
          if (typeof sound !== 'string' || typeof at !== 'number' || !Number.isFinite(at)) throw new TypeError('invalid audio cue');
          cues.push({ sound, at, gain: opts.gain ?? 1, rate: opts.rate ?? 1, pan: opts.pan ?? 0 });
        },
      },
      warn,
    };

    let instance: TemplateInstance;
    try {
      instance = validateInstance(await loaded.module.setup(ctx));
    } catch (error) {
      disposeScene(scene);
      for (const t of owned) t.dispose();
      if (error instanceof TemplateError) throw error;
      throw new TemplateError(`template setup() failed: ${error instanceof Error ? error.message : String(error)}`, { cause: error });
    } finally {
      setupDone = true;
    }
    const cutTime = instance.cutTime ?? null;
    this.active = { instance, scene, owned, camera: () => camera, duration: instance.duration, cutTime };
    return { duration: instance.duration, cutTime, audioCues: cues, warnings };
  }
}
