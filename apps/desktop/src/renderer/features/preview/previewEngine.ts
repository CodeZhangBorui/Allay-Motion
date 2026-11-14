// 预览引擎的控制器（docs/02-engine.md 2.2、2.3）：常驻的预览 Worker、画布、只保留最新的预览请求、
// 看门狗触发后重建 Worker。画布由这里创建和替换（一个 <canvas> 只能 transferControlToOffscreen 一次），
// React 只提供放画布的容器。
// 模板开发模式的热重载（H9）也在这里：trySwap 在备用 Worker（新的画布）里试载、试渲当前帧，成功才换上去。
import type { LoadResult, ParamValues } from '@allay/template-sdk';
import { EngineCrashedError, EngineHost, EngineUnresponsiveError, type EngineHostOptions, type WatchdogTimeouts } from '../../engine-host/EngineHost';
import { createResolver, loadStamp } from '../../engine-host/resource-client';
import type { AssetSource, TemplateSource } from '../../templates/catalog';
import { TemplateCodeError } from '../../../shared/template-code';
import { usePreviewStore } from '../../stores/previewStore';
import { useProjectStore } from '../../stores/projectStore';
import { useTransportStore } from '../../stores/transportStore';
import { loadIssuesOf } from './loadIssues';

interface Viewport {
  cssWidth: number;
  cssHeight: number;
  pixelWidth: number;
  pixelHeight: number;
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export class PreviewEngine {
  private container: HTMLElement | null = null;
  private canvas: HTMLCanvasElement | null = null;
  private host: EngineHost | null = null;
  private creating: Promise<void> | null = null;
  private viewport: Viewport | null = null;
  private appliedSize = '';
  private generation = 0;
  private loadedRevision = -1;
  /** 正在装载的工程版本：同一版本不重复装载 */
  private loadingRevision = -1;
  /** 已装载、正在装载时用的 resourceStamp：资源栈变了要重新装载（引擎据此清空贴图缓存） */
  private loadedStamp = '';
  private loadingStamp = '';
  /** 已装载的模板与输出的版本（projectStore.structureRevision）：没变时改参数走 setParams，不重新装载代码 */
  private loadedStructure = -1;
  /** 当前 Worker 里有一个装载成功的模板（loadedRevision 可能是 -1：热重载换上去之后参数还要再推一次） */
  private hasLoaded = false;
  /** 装载进行中又来了新的工程版本：做完这一次再来一次（同一时刻最多一个在途的装载） */
  private busy = false;
  private again = false;
  private scheduled = false;
  /** 高质量预览（6.4 播放条右侧的开关）：预览也做子帧累积 */
  quality: { subframes: number; shutterAngle: number } | undefined = undefined;
  private rendering = false;
  private pendingTime: number | null = null;
  /** 看门狗之后不自动重新装载同一个模板，等用户点“重试” */
  private holdLoad = false;
  timeouts: Partial<WatchdogTimeouts> = {};
  /** 正在装载或已装载的模板的 asset: 来源（引擎要模板自带的图片时从这里读） */
  private assets: AssetSource | null = null;
  private readonly resolveResource = createResolver(() => this.assets);

  /** 预览区挂载时交来容器；卸载时传 null */
  mount(container: HTMLElement | null): void {
    if (container === this.container) return;
    this.container = container;
    if (container && this.canvas) container.replaceChildren(this.canvas);
    if (container && !this.host && !this.creating) void this.recreate();
  }

  /** 预览区大小变了：CSS 尺寸和设备像素尺寸（已按输出分辨率封顶） */
  setViewport(viewport: Viewport): void {
    this.viewport = viewport;
    void this.applyViewport();
  }

  /** 当前工程（模板、参数、输出）变了：重新装载或改参数。每个动画帧最多一次（1.7） */
  reload(): void {
    if (this.holdLoad || this.scheduled) return;
    this.scheduled = true;
    requestAnimationFrame(() => {
      this.scheduled = false;
      void this.loadCurrent();
    });
  }

  /** 高质量预览开关 */
  setQuality(quality: { subframes: number; shutterAngle: number } | undefined): void {
    this.quality = quality;
    this.requestRender(useTransportStore.getState().time);
  }

  /** 错误卡片上的“重试” */
  retry(): void {
    this.holdLoad = false;
    this.hasLoaded = false;
    this.loadedRevision = -1;
    this.loadingRevision = -1;
    // 正在建 Worker 时不再建第二个：建好后它会装载当前工程
    if (this.creating) return;
    if (!this.host) void this.recreate();
    else void this.loadCurrent();
  }

  /** 只保留最新的预览请求：同一时刻最多一个在途 render，新的 t 覆盖排队中的旧请求（2.3） */
  requestRender(t: number): void {
    this.pendingTime = t;
    if (!this.rendering) void this.drain();
  }

  /** 诊断与测试用 */
  async readPreview(t: number): Promise<Uint8Array> {
    if (!this.host) throw new Error('preview engine not ready');
    return this.host.readPreview(t);
  }

  /** 预览画布的设备像素尺寸 */
  get pixelSize(): { width: number; height: number } | null {
    return this.viewport ? { width: this.viewport.pixelWidth, height: this.viewport.pixelHeight } : null;
  }

  /** 预览当前装载的是工程的第几版（projectStore.revision）；还没装载时为 -1 */
  get loadedProjectRevision(): number {
    return this.loadedRevision;
  }

  get workerGeneration(): number {
    return this.generation;
  }

  /** 实测预览帧率：播放时记下每一帧画完的时刻，取最近约 1 秒的滑动平均（状态栏用）；暂停时清空 */
  private frameTimes: number[] = [];
  private countFrame(): void {
    if (!useTransportStore.getState().playing) {
      if (this.frameTimes.length > 0) {
        this.frameTimes = [];
        usePreviewStore.getState().setMeasuredFps(null);
      }
      return;
    }
    const now = performance.now();
    this.frameTimes.push(now);
    while (this.frameTimes.length > 0 && now - this.frameTimes[0]! > 1000) this.frameTimes.shift();
    if (this.frameTimes.length >= 2) {
      const span = (now - this.frameTimes[0]!) / 1000;
      usePreviewStore.getState().setMeasuredFps(span > 0 ? (this.frameTimes.length - 1) / span : null);
    }
  }

  private async drain(): Promise<void> {
    this.rendering = true;
    try {
      while (this.pendingTime !== null) {
        const t = this.pendingTime;
        this.pendingTime = null;
        const host = this.host;
        if (!host || this.loadedRevision < 0) break;
        try {
          await host.render(t, this.quality);
          this.countFrame();
        } catch (error) {
          this.handleError(error);
          break;
        }
      }
    } finally {
      this.rendering = false;
    }
  }

  /** 建新的画布和 Worker（首次，或看门狗终止之后） */
  private recreate(): Promise<void> {
    const run = async () => {
      this.host?.dispose();
      this.host = null;
      this.loadedRevision = -1;
      this.loadingRevision = -1;
      this.loadedStructure = -1;
      this.hasLoaded = false;
      this.appliedSize = '';
      const generation = ++this.generation;
      usePreviewStore.getState().setGeneration(generation);

      const canvas = this.makeCanvas();
      this.canvas = canvas;
      this.container?.replaceChildren(canvas);
      this.styleCanvas();

      try {
        const host = await this.createHost(canvas, this.resolveResource);
        if (generation !== this.generation) {
          host.dispose();
          return;
        }
        this.host = host;
      } catch (error) {
        usePreviewStore.getState().setStatus({ kind: 'crashed', message: message(error) });
        return;
      }
      await this.applyViewport();
      if (!this.holdLoad) await this.loadCurrent();
    };
    const p = run().finally(() => {
      if (this.creating === p) this.creating = null;
    });
    this.creating = p;
    return p;
  }

  private makeCanvas(): HTMLCanvasElement {
    const canvas = document.createElement('canvas');
    canvas.dataset.testid = 'preview-canvas';
    canvas.className = 'block';
    return canvas;
  }

  /** 建一个预览 Worker。它死掉时，只有它还是当前的 Worker 才重建（备用 Worker 死了由热重载自己处理） */
  private async createHost(canvas: HTMLCanvasElement, resolveResource: EngineHostOptions['resolveResource']): Promise<EngineHost> {
    let created: EngineHost | null = null;
    created = await EngineHost.create({
      mode: 'preview',
      canvas,
      resolveResource,
      strictDeterminism: import.meta.env.DEV,
      timeouts: this.timeouts,
      log: (level, msg) => (level === 'error' ? console.error : console.warn)(`[engine] ${msg}`),
      onDead: (error) => {
        if (created !== null && created === this.host) this.onDead(error);
      },
    });
    return created;
  }

  /**
   * 热重载（H9）：在备用 Worker 里装载 source（参数用 params）并试渲当前时刻，每一步都受看门狗约束。
   * 成功时返回 commit：把备用 Worker 和它的画布换上去、销毁旧的，并在中间同步调用 apply() 改工程；
   * 失败时备用 Worker 已销毁，旧 Worker 和画面不动。error 是原样的错误（诊断由调用方取）。
   */
  async trySwap(source: TemplateSource, params: ParamValues): Promise<SwapTrial> {
    const output = useProjectStore.getState().output;
    const stamp = loadStamp(source.assets);
    const time = useTransportStore.getState().time;
    const vp = this.viewport;
    const canvas = this.makeCanvas();
    let promoted = false;
    // 换上去之前从 source 读模板自带的图片；换上去之后和主 Worker 一样跟着 this.assets 走
    const resolver = createResolver(() => (promoted ? this.assets : source.assets));
    let standby: EngineHost | null = null;
    let result: LoadResult;
    try {
      standby = await this.createHost(canvas, resolver);
      if (vp) await standby.resize(vp.pixelWidth, vp.pixelHeight);
      result = await standby.load({ manifest: source.manifest, code: source.code, params, output, resourceStamp: stamp });
      await standby.render(time, this.quality);
    } catch (error) {
      standby?.dispose();
      return { ok: false, error };
    }
    const host = standby;
    return {
      ok: true,
      result,
      discard: () => host.dispose(),
      commit: (apply) => {
        const old = this.host;
        promoted = true;
        this.host = host;
        this.canvas = canvas;
        this.container?.replaceChildren(canvas);
        this.styleCanvas();
        this.appliedSize = vp ? `${vp.pixelWidth}x${vp.pixelHeight}` : '';
        // 看门狗之后正在重建的空闲 Worker 随之作废（recreate 按 generation 判断）
        usePreviewStore.getState().setGeneration(++this.generation);
        this.holdLoad = false;
        this.assets = source.assets;
        old?.dispose();
        apply();
        const s = useProjectStore.getState();
        this.loadingRevision = -1;
        this.loadedStamp = stamp;
        this.loadedStructure = s.structureRevision;
        // 输出在试载期间变了：整体重新装载；只是参数变了：结构已经对上，参数走 setParams 再推一次
        this.hasLoaded = output === s.output;
        this.loadedRevision = this.hasLoaded && sameParams(s.params, params) ? s.revision : -1;
        useTransportStore.getState().setTimeline(result.duration, result.cutTime);
        usePreviewStore.getState().setAudioCues(result.audioCues);
        usePreviewStore.getState().setStatus({ kind: 'ready', warnings: result.warnings });
        if (this.loadedRevision !== s.revision) this.reload();
        this.requestRender(useTransportStore.getState().time);
      },
    };
  }

  private onDead(error: EngineUnresponsiveError | EngineCrashedError): void {
    this.host = null;
    if (error instanceof EngineUnresponsiveError) {
      this.holdLoad = true;
      usePreviewStore.getState().setStatus({ kind: 'unresponsive', operation: error.operation });
    } else {
      usePreviewStore.getState().setStatus({ kind: 'crashed', message: error.message });
    }
    useTransportStore.getState().setPlaying(false);
    // 重建一个空闲的 Worker（不装载刚才那个模板）
    void this.recreate();
  }

  private styleCanvas(): void {
    if (!this.canvas || !this.viewport) return;
    this.canvas.style.width = `${this.viewport.cssWidth}px`;
    this.canvas.style.height = `${this.viewport.cssHeight}px`;
  }

  private async applyViewport(): Promise<void> {
    this.styleCanvas();
    const host = this.host;
    const vp = this.viewport;
    if (!host || !vp) return;
    const key = `${vp.pixelWidth}x${vp.pixelHeight}`;
    if (key === this.appliedSize) return;
    this.appliedSize = key;
    try {
      await host.resize(vp.pixelWidth, vp.pixelHeight);
      this.requestRender(useTransportStore.getState().time);
    } catch (error) {
      this.handleError(error);
    }
  }

  private async loadCurrent(): Promise<void> {
    if (this.busy) {
      this.again = true;
      return;
    }
    this.busy = true;
    try {
      await this.loadOnce();
    } finally {
      this.busy = false;
      if (this.again) {
        this.again = false;
        void this.loadCurrent();
      }
    }
  }

  private async loadOnce(): Promise<void> {
    const host = this.host;
    if (!host) return;
    const { template, params, output, revision, structureRevision } = useProjectStore.getState();
    // 模板列表还没取到：等 projectStore 里有了模板再装
    if (!template) return;
    const stamp = loadStamp(template.assets);
    if ((revision === this.loadingRevision && stamp === this.loadingStamp) || (revision === this.loadedRevision && stamp === this.loadedStamp)) return;
    this.loadingRevision = revision;
    this.loadingStamp = stamp;
    // 只改了参数（模板、输出、资源栈都没变，上一次装载成功）：setParams，不重新装载代码，也不进入“装载中”
    const paramsOnly = this.hasLoaded && structureRevision === this.loadedStructure && stamp === this.loadedStamp && usePreviewStore.getState().status.kind === 'ready';
    if (!paramsOnly) usePreviewStore.getState().setStatus({ kind: 'loading' });
    this.assets = template.assets;
    let result: LoadResult;
    try {
      result = paramsOnly ? await host.setParams(params) : await host.load({ manifest: template.manifest, code: template.code, params, output, resourceStamp: stamp });
    } catch (error) {
      // 装载期间这个 Worker 已经被换掉（热重载）：它的失败与当前状态无关
      if (host !== this.host) return;
      this.loadedRevision = -1;
      this.loadedStructure = -1;
      this.hasLoaded = false;
      this.handleError(error);
      return;
    } finally {
      if (this.loadingRevision === revision) this.loadingRevision = -1;
    }
    if (host !== this.host) return;
    this.hasLoaded = true;
    this.loadedRevision = revision;
    this.loadedStructure = structureRevision;
    this.loadedStamp = stamp;
    // 装载期间工程又变了：再来一次（这一次的结果照样画出来）
    if (revision !== useProjectStore.getState().revision) this.again = true;
    // 装载期间资源栈又变了：再装一次
    if (stamp !== loadStamp(useProjectStore.getState().template?.assets ?? null)) queueMicrotask(() => this.reload());
    useTransportStore.getState().setTimeline(result.duration, result.cutTime);
    usePreviewStore.getState().setAudioCues(result.audioCues);
    usePreviewStore.getState().setStatus({ kind: 'ready', warnings: result.warnings });
    this.requestRender(useTransportStore.getState().time);
  }

  private handleError(error: unknown): void {
    // 看门狗和崩溃由 onDead 处理
    if (error instanceof EngineUnresponsiveError || error instanceof EngineCrashedError) return;
    useTransportStore.getState().setPlaying(false);
    const text = error instanceof TemplateCodeError ? `${error.problem}: ${error.message}` : message(error);
    const issues = loadIssuesOf(error);
    usePreviewStore.getState().setStatus(issues ? { kind: 'error', message: text, issues } : { kind: 'error', message: text });
  }
}

function sameParams(a: ParamValues, b: ParamValues): boolean {
  const keys = Object.keys(a);
  return keys.length === Object.keys(b).length && keys.every((k) => Object.hasOwn(b, k) && JSON.stringify(a[k]) === JSON.stringify(b[k]));
}

export type SwapTrial = { ok: true; result: LoadResult; commit(apply: () => void): void; discard(): void } | { ok: false; error: unknown };

export const previewEngine = new PreviewEngine();
