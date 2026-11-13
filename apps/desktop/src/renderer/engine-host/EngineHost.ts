// 宿主一侧的引擎封装（docs/02-engine.md 2.3）：创建 Worker、Comlink 调用、看门狗、资源回调。
// 看门狗：load 10 秒，预览单帧 5 秒，导出单帧 30 秒。超时就 terminate()，交给调用方重建 Worker。
import type { EngineApi, HostCallbacks } from '@allay/engine';
import {
  FrameStatsSchema,
  LoadResultSchema,
  TemplateDiagnosticSchema,
  diagnosticOf,
  type TemplateDiagnostic,
  type EngineMode,
  type FrameQuality,
  type FrameStats,
  type LoadRequest,
  type LoadResult,
  type Opaque,
  type ParamValues,
  type ResourceKind,
  type ResourcePayload,
  type ThumbRequest,
} from '@allay/template-sdk';
import * as Comlink from 'comlink';
import { createEngineWorker } from './create-worker';
import { analyzeTemplateCode } from '../../shared/template-code';

export const WATCHDOG_MS = { load: 10_000, previewFrame: 5_000, exportFrame: 30_000 } as const;
export type WatchdogTimeouts = { [K in keyof typeof WATCHDOG_MS]: number };

/** 模板在时限内没有返回：Worker 已被终止 */
export class EngineUnresponsiveError extends Error {
  /** watchdog 类诊断（H5）。Worker 已被终止，拿不到卡在哪一行 */
  readonly diagnostic: TemplateDiagnostic;

  constructor(
    readonly operation: string,
    timeoutMs = 0,
  ) {
    super(`engine did not respond to ${operation} in time`);
    this.name = 'EngineUnresponsiveError';
    this.diagnostic = { kind: 'watchdog', severity: 'error', code: 'unresponsive', message: this.message, operation, timeoutMs };
  }
}

/** Worker 自己挂了（脚本错误、显卡丢失等），或者已经被销毁 */
export class EngineCrashedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EngineCrashedError';
  }
}

export interface EngineHostOptions {
  mode: EngineMode;
  /** 预览模式：页面上的 <canvas>，由这里 transferControlToOffscreen() 交给 Worker */
  canvas?: HTMLCanvasElement;
  resolveResource(kind: ResourceKind, id: string): Promise<ResourcePayload | null>;
  log?(level: 'debug' | 'warn' | 'error', message: string): void;
  timeouts?: Partial<WatchdogTimeouts>;
  /** 开发构建里打开（2.4） */
  strictDeterminism?: boolean;
  /** Worker 被看门狗终止或自己崩溃时调用一次 */
  onDead?(error: EngineUnresponsiveError | EngineCrashedError): void;
}

let workerSeq = 0;

/** 载荷里所有可以零拷贝转移的缓冲（去重：同一个 ArrayBuffer 只能列一次） */
export function payloadBuffers(payload: ResourcePayload): ArrayBuffer[] {
  const views: ArrayBufferView[] = [];
  if (payload.kind === 'rgba') views.push(payload.data);
  else if (payload.kind === 'font') {
    for (const p of payload.providers) if (p.type === 'bitmap') views.push(p.image.data);
  } else views.push(payload.codepoints, payload.metrics, payload.offsets, payload.bits);
  const set = new Set<ArrayBuffer>();
  for (const v of views) if (v.buffer instanceof ArrayBuffer) set.add(v.buffer);
  return [...set];
}

export class EngineHost {
  readonly mode: EngineMode;
  private readonly worker: Worker;
  private readonly api: Comlink.Remote<EngineApi>;
  private readonly timeouts: WatchdogTimeouts;
  private deadError: EngineUnresponsiveError | EngineCrashedError | null = null;
  private released = false;
  private rejectDeath!: (error: Error) => void;
  private readonly death: Promise<never>;

  private constructor(private readonly opts: EngineHostOptions) {
    this.mode = opts.mode;
    this.timeouts = { ...WATCHDOG_MS, ...opts.timeouts };
    this.death = new Promise<never>((_resolve, reject) => {
      this.rejectDeath = reject;
    });
    // 没人等的时候不要报 unhandled rejection
    this.death.catch(() => undefined);
    this.worker = createEngineWorker(`engine-${opts.mode}-${++workerSeq}`);
    this.worker.addEventListener('error', (event) => {
      event.preventDefault();
      this.die(new EngineCrashedError(`engine worker error: ${event.message || 'unknown'}`));
    });
    this.worker.addEventListener('messageerror', () => this.die(new EngineCrashedError('engine worker sent an unreadable message')));
    this.api = Comlink.wrap<EngineApi>(this.worker);
  }

  /** 建 Worker 并 init；预览模式要传 canvas */
  static async create(opts: EngineHostOptions): Promise<EngineHost> {
    const host = new EngineHost(opts);
    const callbacks: HostCallbacks = {
      resolveResource: async (kind, id) => {
        const payload = await opts.resolveResource(kind, id);
        // 载荷交给 Worker 后在这里就不能再用了：调用方每次都要给一份新的（缓存里的要先复制）
        return payload ? Comlink.transfer(payload, payloadBuffers(payload)) : null;
      },
      log: (level, message) => opts.log?.(level, String(message).slice(0, 2000)),
    };
    const canvas = opts.mode === 'preview' ? opts.canvas?.transferControlToOffscreen() : undefined;
    if (opts.mode === 'preview' && !canvas) throw new Error('preview engine needs a canvas');
    const init = { canvas, mode: opts.mode, strictDeterminism: opts.strictDeterminism === true };
    try {
      await host.call('init', host.timeouts.load, () => host.api.init(Comlink.transfer(init, canvas ? [canvas] : []), Comlink.proxy(callbacks)));
    } catch (error) {
      host.dispose();
      throw error;
    }
    return host;
  }

  get dead(): boolean {
    return this.deadError !== null;
  }

  /**
   * 预检源码（语法、不含 import），再装载模板并完成 setup。
   * 预检不过时抛 TemplateCodeError（带 compile 类诊断）；静态规则的提示附在结果的 diagnostics 里（H12）。
   */
  async load(req: LoadRequest): Promise<LoadResult> {
    const rules = await analyzeTemplateCode(req.code);
    const result = LoadResultSchema.parse(await this.call('load', this.timeouts.load, () => this.api.load(req)));
    return { ...result, diagnostics: rules };
  }

  async setParams(params: ParamValues): Promise<LoadResult> {
    return LoadResultSchema.parse(await this.call('setParams', this.timeouts.load, () => this.api.setParams(params)));
  }

  async resize(width: number, height: number): Promise<void> {
    await this.call('resize', this.timeouts.previewFrame, () => this.api.resize(width, height));
  }

  async render(t: number, quality?: FrameQuality): Promise<FrameStats> {
    return FrameStatsSchema.parse(await this.call('render', this.timeouts.previewFrame, () => this.api.render(t, quality)));
  }

  /** 导出一帧：直通 alpha 的 RGBA8，第一行是顶部 */
  async renderFrame(index: number, quality: FrameQuality, opaque?: Opaque): Promise<Uint8Array<ArrayBuffer>> {
    const buf = await this.call('renderFrame', this.timeouts.exportFrame, () => this.api.renderFrame(index, quality, opaque));
    if (!(buf instanceof ArrayBuffer)) throw new EngineCrashedError('renderFrame returned no pixels');
    return new Uint8Array(buf);
  }

  /** 方块、物品的缩略图（杂务或导出引擎） */
  async renderThumbnail(req: ThumbRequest): Promise<ImageBitmap> {
    const bitmap = await this.call('renderThumbnail', this.timeouts.exportFrame, () => this.api.renderThumbnail(req));
    if (!(bitmap instanceof ImageBitmap)) throw new EngineCrashedError('renderThumbnail returned no image');
    return bitmap;
  }

  /** 诊断与测试用：画一帧预览并读回画布像素（预乘 alpha） */
  async readPreview(t: number): Promise<Uint8Array<ArrayBuffer>> {
    const buf = await this.call('readPreview', this.timeouts.previewFrame, () => this.api.readPreview(t));
    if (!(buf instanceof ArrayBuffer)) throw new EngineCrashedError('readPreview returned no pixels');
    return new Uint8Array(buf);
  }

  /**
   * 确定性自检（2.4）：probe 帧渲染两次，中间穿插渲染 others。一致时为 null，否则是 determinism 类诊断。
   * 杂务或导出引擎；时限按每帧的导出时限累计。
   */
  async checkDeterminism(probe: number, others: number[], quality: FrameQuality): Promise<TemplateDiagnostic | null> {
    const budget = this.timeouts.exportFrame * (others.length + 2);
    const result: unknown = await this.call('checkDeterminism', budget, async (): Promise<unknown> => this.api.checkDeterminism(probe, others, quality));
    return result === null ? null : TemplateDiagnosticSchema.parse(result);
  }

  /** 释放 GPU 资源并终止 Worker。可以重复调用 */
  dispose(): void {
    if (!this.deadError) {
      void this.api.dispose().catch(() => undefined);
      this.deadError = new EngineCrashedError('engine disposed');
      this.rejectDeath(this.deadError);
    }
    if (this.released) return;
    this.released = true;
    try {
      this.api[Comlink.releaseProxy]();
    } catch {
      // Worker 已经没了
    }
    this.worker.terminate();
  }

  private die(error: EngineUnresponsiveError | EngineCrashedError): void {
    if (this.deadError) return;
    this.deadError = error;
    this.worker.terminate();
    this.rejectDeath(error);
    this.opts.onDead?.(error);
  }

  /** 带看门狗的调用：超时就终止 Worker */
  private async call<T>(operation: string, timeoutMs: number, fn: () => Promise<T>): Promise<T> {
    if (this.deadError) throw this.deadError;
    const timer = setTimeout(() => this.die(new EngineUnresponsiveError(operation, timeoutMs)), timeoutMs);
    try {
      return await Promise.race([fn(), this.death]);
    } catch (error) {
      // Worker 交来的诊断是线程边界外的数据：不合 schema 就去掉（2.3 的校验约定）
      if (error && typeof error === 'object' && 'diagnostic' in error && !(error instanceof EngineUnresponsiveError)) {
        const valid = diagnosticOf(error);
        if (valid) (error as { diagnostic: unknown }).diagnostic = valid;
        else delete (error as { diagnostic?: unknown }).diagnostic;
      }
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }
}
