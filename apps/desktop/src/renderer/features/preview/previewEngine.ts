// 预览引擎的控制器（docs/02-engine.md 2.2、2.3）：常驻的预览 Worker、画布、只保留最新的预览请求、
// 看门狗触发后重建 Worker。画布由这里创建和替换（一个 <canvas> 只能 transferControlToOffscreen 一次），
// React 只提供放画布的容器。
import type { LoadResult } from '@allay/template-sdk';
import { EngineCrashedError, EngineHost, EngineUnresponsiveError, type WatchdogTimeouts } from '../../engine-host/EngineHost';
import { createResolver, loadStamp } from '../../engine-host/resource-client';
import type { AssetSource } from '../../templates/catalog';
import { TemplateCodeError } from '../../../shared/template-code';
import { usePreviewStore } from '../../stores/previewStore';
import { useProjectStore } from '../../stores/projectStore';
import { useTransportStore } from '../../stores/transportStore';

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

  /** 当前工程（模板、参数、输出）变了：重新装载 */
  reload(): void {
    if (this.holdLoad) return;
    void this.loadCurrent();
  }

  /** 错误卡片上的“重试” */
  retry(): void {
    this.holdLoad = false;
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

  private async drain(): Promise<void> {
    this.rendering = true;
    try {
      while (this.pendingTime !== null) {
        const t = this.pendingTime;
        this.pendingTime = null;
        const host = this.host;
        if (!host || this.loadedRevision < 0) break;
        try {
          await host.render(t);
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
      this.appliedSize = '';
      const generation = ++this.generation;
      usePreviewStore.getState().setGeneration(generation);

      const canvas = document.createElement('canvas');
      canvas.dataset.testid = 'preview-canvas';
      canvas.className = 'block';
      this.canvas = canvas;
      this.container?.replaceChildren(canvas);
      this.styleCanvas();

      try {
        const host = await EngineHost.create({
          mode: 'preview',
          canvas,
          resolveResource: this.resolveResource,
          strictDeterminism: import.meta.env.DEV,
          timeouts: this.timeouts,
          log: (level, msg) => (level === 'error' ? console.error : console.warn)(`[engine] ${msg}`),
          onDead: (error) => this.onDead(generation, error),
        });
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

  private onDead(generation: number, error: EngineUnresponsiveError | EngineCrashedError): void {
    if (generation !== this.generation) return;
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
    const host = this.host;
    if (!host) return;
    const { template, params, output, revision } = useProjectStore.getState();
    // 模板列表还没取到：等 projectStore 里有了模板再装
    if (!template) return;
    const stamp = loadStamp(template.assets);
    if ((revision === this.loadingRevision && stamp === this.loadingStamp) || (revision === this.loadedRevision && stamp === this.loadedStamp)) return;
    this.loadingRevision = revision;
    this.loadingStamp = stamp;
    usePreviewStore.getState().setStatus({ kind: 'loading' });
    this.assets = template.assets;
    let result: LoadResult;
    try {
      result = await host.load({ manifest: template.manifest, code: template.code, params, output, resourceStamp: stamp });
    } catch (error) {
      this.loadedRevision = -1;
      this.handleError(error);
      return;
    } finally {
      if (this.loadingRevision === revision) this.loadingRevision = -1;
    }
    if (host !== this.host || revision !== useProjectStore.getState().revision) return;
    this.loadedRevision = revision;
    this.loadedStamp = stamp;
    // 装载期间资源栈又变了：再装一次
    if (stamp !== loadStamp(useProjectStore.getState().template?.assets ?? null)) queueMicrotask(() => this.reload());
    useTransportStore.getState().setTimeline(result.duration, result.cutTime);
    usePreviewStore.getState().setStatus({ kind: 'ready', warnings: result.warnings });
    this.requestRender(useTransportStore.getState().time);
  }

  private handleError(error: unknown): void {
    // 看门狗和崩溃由 onDead 处理
    if (error instanceof EngineUnresponsiveError || error instanceof EngineCrashedError) return;
    useTransportStore.getState().setPlaying(false);
    const text = error instanceof TemplateCodeError ? `${error.problem}: ${error.message}` : message(error);
    usePreviewStore.getState().setStatus({ kind: 'error', message: text });
  }
}

export const previewEngine = new PreviewEngine();
