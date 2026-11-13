// 引擎本体（docs/02-engine.md）。运行在 Dedicated Worker 里；宿主经 Comlink 调用（2.3）。
// 不依赖 DOM、React、Electron、Node，只用 Worker 里可用的 Web API。
import * as THREE from 'three';
import {
  FrameQualitySchema,
  LoadRequestSchema,
  OpaqueSchema,
  ParamValuesSchema,
  ResizeSchema,
  TexturePayloadSchema,
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
} from '@allay/template-sdk';
import { ease, math, segment } from './ease';
import { frameTime, subframeTimes } from './frames';
import { DeterminismGuard } from './harden';
import { createNoise2D, type Noise2D } from './noise';
import { FramePipeline } from './pipeline';
import { createRng } from './random';
import { computeStage, createDefaultCamera, createStageCamera } from './stage';

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

/** 引擎对外的接口（2.3）。renderThumbnail 在 M2 加入 */
export interface EngineApi {
  init(opts: InitOptions, host: HostCallbacks): Promise<void>;
  load(req: LoadRequest): Promise<LoadResult>;
  setParams(params: ParamValues): Promise<LoadResult>;
  resize(width: number, height: number): void;
  render(t: number, quality?: FrameQuality): Promise<FrameStats>;
  renderFrame(index: number, quality: FrameQuality, opaque?: Opaque): Promise<ArrayBuffer>;
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
  output: LoadRequest['output'];
  stage: StageInfo;
  params: ParamValues;
}

interface Active {
  instance: TemplateInstance;
  scene: THREE.Scene;
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
  private resourceStamp: string | null = null;
  private readonly textures = new Map<string, Promise<THREE.Texture>>();
  private placeholder: THREE.Texture | null = null;
  private readonly times: number[] = [];

  async init(opts: InitOptions, host: HostCallbacks): Promise<void> {
    if (this.renderer) throw new Error('engine already initialised');
    this.mode = EngineModeSchema.parse(opts.mode);
    this.host = host;
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
    if (parsed.resourceStamp !== this.resourceStamp) {
      this.clearTextures();
      this.resourceStamp = parsed.resourceStamp;
    }
    const module = this.loaded && this.loaded.code === parsed.code ? this.loaded.module : await importTemplate(parsed.code);
    const stage = computeStage(parsed.output);
    this.loaded = { module, code: parsed.code, output: parsed.output, stage, params: parsed.params };
    if (this.mode !== 'preview') this.pipeline!.setSize(parsed.output.width, parsed.output.height);
    return this.setup();
  }

  async setParams(params: ParamValues): Promise<LoadResult> {
    const parsed = ParamValuesSchema.parse(params);
    if (!this.loaded) throw new Error('no template loaded');
    this.loaded = { ...this.loaded, params: parsed };
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

  dispose(): void {
    this.disposeActive();
    this.clearTextures();
    this.placeholder?.dispose();
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
      update: (tk: number) => this.guard.run(() => active.instance.update(tk)),
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
  }

  private clearTextures(): void {
    for (const p of this.textures.values()) void p.then((t) => t.dispose(), () => undefined);
    this.textures.clear();
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

    const scene = new THREE.Scene();
    let camera: THREE.Camera = createDefaultCamera(loaded.stage);
    const seedParam = loaded.params.seed;
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
      resources: { texture: (id) => this.texture(id, warn) },
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
      if (error instanceof TemplateError) throw error;
      throw new TemplateError(`template setup() failed: ${error instanceof Error ? error.message : String(error)}`, { cause: error });
    } finally {
      setupDone = true;
    }
    const cutTime = instance.cutTime ?? null;
    this.active = { instance, scene, camera: () => camera, duration: instance.duration, cutTime };
    return { duration: instance.duration, cutTime, audioCues: cues, warnings };
  }

  /** ctx.resources.texture：经宿主的 resolveResource 取 RGBA8，做成设好过滤和色彩空间的贴图 */
  private texture(id: string, warn: (m: string) => void): Promise<THREE.Texture> {
    if (typeof id !== 'string' || id.length === 0 || id.length > 512) return Promise.reject(new TypeError('invalid texture id'));
    let p = this.textures.get(id);
    if (!p) {
      p = this.fetchTexture(id).catch((error: unknown) => {
        this.host?.log('warn', `texture ${id} failed: ${error instanceof Error ? error.message : String(error)}`);
        return null;
      }).then((tex) => {
        if (tex) return tex;
        this.textures.delete(id);
        warn(`texture ${id} is missing; a placeholder is used`);
        return this.placeholderTexture();
      });
      this.textures.set(id, p);
    }
    return p;
  }

  private async fetchTexture(id: string): Promise<THREE.Texture | null> {
    const raw = await this.host!.resolveResource('texture', id);
    if (raw === null) return null;
    const payload = TexturePayloadSchema.parse(raw);
    return makeTexture(payload.width, payload.height, payload.data);
  }

  private placeholderTexture(): THREE.Texture {
    if (!this.placeholder) {
      // 品红与黑的 2×2 棋盘，放大成 16×16
      const data = new Uint8Array(16 * 16 * 4);
      for (let y = 0; y < 16; y++)
        for (let x = 0; x < 16; x++) {
          const on = ((x >> 3) + (y >> 3)) % 2 === 0;
          data.set(on ? [248, 0, 248, 255] : [0, 0, 0, 255], (y * 16 + x) * 4);
        }
      this.placeholder = makeTexture(16, 16, data);
    }
    return this.placeholder;
  }
}

/** 贴图：放大用 Nearest，缩小用 LinearMipmapLinear 并生成 mipmap（2.8）；sRGB 编码 */
function makeTexture(width: number, height: number, topFirst: Uint8Array): THREE.Texture {
  // 载荷第一行是顶部；DataTexture 不翻转，第一行对应 v = 0（底部），所以在 CPU 上翻一次
  const data = new Uint8Array(topFirst.length);
  const row = width * 4;
  for (let y = 0; y < height; y++) data.set(topFirst.subarray((height - 1 - y) * row, (height - y) * row), y * row);
  const tex = new THREE.DataTexture(data, width, height, THREE.RGBAFormat, THREE.UnsignedByteType);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.flipY = false;
  tex.needsUpdate = true;
  return tex;
}
