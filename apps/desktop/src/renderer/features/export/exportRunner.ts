// 导出流程的渲染进程部分（docs/05-export.md 5.1）：新建导出 Worker 并 load，
// 然后逐帧握手：renderFrame(i) → window.allay.export.writeFrame(jobId, pixels)。
// 取消就终止导出 Worker 并让主进程杀掉 FFmpeg、删除 .partial。
// 这里只管“跑一次导出”；任务的编号、状态、命令在 exportTasks.ts。
import { frameCount } from '@allay/engine/frames';
import type { FrameQuality, OutputSettings, ParamValues } from '@allay/template-sdk';
import type { ExportFailure, ExportPreset } from '../../../shared/export';
import { EngineHost, EngineUnresponsiveError } from '../../engine-host/EngineHost';
import { createResolver, loadStamp } from '../../engine-host/resource-client';
import type { TemplateSource } from '../../templates/catalog';
import i18next from 'i18next';
import { reportMissingSounds, soundBank } from '../../audio/app-audio';
import { mixFrames, mixOffline } from '../../audio/mix';
import { notify } from '../../stores/noticeStore';
import { useUiStore } from '../../stores/uiStore';

/** 画质档位（02-engine.md 2.7） */
export const QUALITY_SUBFRAMES = { draft: 1, standard: 8, high: 16, ultra: 32 } as const;
export type QualityLevel = keyof typeof QUALITY_SUBFRAMES;

export interface ExportRequest {
  template: TemplateSource;
  params: ParamValues;
  output: OutputSettings;
  preset: ExportPreset;
  quality: QualityLevel;
  /** 0–360 */
  shutterAngle: number;
  /** 绿幕的底色 #RRGGBB（只有绿幕 MP4 用） */
  key: string;
  /** 文件名（不含扩展名） */
  suggestedName: string;
}

export type ExportStage = 'preparing' | 'rendering' | 'muxing';

export interface ExportProgress {
  stage: ExportStage;
  written: number;
  total: number;
  /** 剩余时间（秒），用最近 20 帧的平均耗时估算（5.7）；还估不出来时为 null */
  etaSeconds: number | null;
}

export interface ExportDone {
  kind: 'done';
  jobId: string;
  path: string;
  frames: number;
  fps: number;
  duration: number;
  cutFrame: number | null;
  /** 剪辑点那一帧的最小 alpha（不透明预设和叠加层为 null） */
  cutMinAlpha: number | null;
  encoder: string | null;
  seconds: number;
  /** 有音轨（5.5）；没有能出声的 cue 时为假 */
  audio: boolean;
  /** 混音峰值超过 0 dBFS，整体压到了 −1 dBFS */
  peakNormalized: boolean;
}

export type ExportOutcome = ExportDone | { kind: 'canceled' } | { kind: 'failed'; error: ExportFailure; frame: number | null };

/**
 * 每写完一帧后调用的闸门，只给自动化测试用（test-hooks 里的 pauseExportAfter）：让导出停在确定的一帧上，
 * 测试就不必假设“导出慢到来得及点取消”。正式运行时为 null，导出不等待任何东西。
 */
export type ExportGate = (written: number) => Promise<void>;
let exportGate: ExportGate | null = null;
export function setExportGate(gate: ExportGate | null): void {
  exportGate = gate;
}

/** 剩余时间：最近 20 帧的平均耗时 × 剩下的帧数 */
export class EtaEstimator {
  private readonly times: number[] = [];
  constructor(private readonly window = 20) {}
  /** 记一帧完成的时刻（毫秒） */
  mark(now: number): void {
    this.times.push(now);
    if (this.times.length > this.window + 1) this.times.shift();
  }
  eta(remaining: number): number | null {
    if (this.times.length < 2) return null;
    const span = this.times.at(-1)! - this.times[0]!;
    return ((span / (this.times.length - 1)) * remaining) / 1000;
  }
}

/** 直通 alpha 的 RGBA 里最小的 alpha */
export function minAlpha(pixels: Uint8Array): number {
  let min = 255;
  for (let i = 3; i < pixels.length; i += 4) {
    const a = pixels[i]!;
    if (a < min) {
      min = a;
      if (min === 0) break;
    }
  }
  return min;
}

export class ExportRun {
  private canceled = false;
  private resolveCanceled!: () => void;
  /** 取消时兑现：等待闸门时也要能被取消打断 */
  private readonly canceledSignal = new Promise<void>((resolve) => {
    this.resolveCanceled = resolve;
  });
  private host: EngineHost | null = null;
  private jobId: string | null = null;

  constructor(
    private readonly req: ExportRequest,
    private readonly onProgress: (p: ExportProgress) => void,
  ) {}

  /** 用户点了“取消”：终止导出 Worker，主进程杀掉 FFmpeg 并删掉临时文件 */
  async cancel(): Promise<void> {
    this.canceled = true;
    this.resolveCanceled();
    this.host?.dispose();
    if (this.jobId) await window.allay.export.cancel(this.jobId);
  }

  async run(): Promise<ExportOutcome> {
    const started = performance.now();
    const { req } = this;
    const quality: FrameQuality = { subframes: QUALITY_SUBFRAMES[req.quality], shutterAngle: req.shutterAngle };
    // 只有绿幕预设用不透明模式渲染（5.1 第 2 步）
    const opaque = req.preset === 'greenscreen-mp4' ? { key: req.key } : undefined;
    let frame: number | null = null;
    this.onProgress({ stage: 'preparing', written: 0, total: 0, etaSeconds: null });
    try {
      // 1. 导出 Worker：每次导出新建，用输出分辨率的离屏画布
      const assets = req.template.assets;
      const host = await EngineHost.create({ mode: 'export', resolveResource: createResolver(() => assets), strictDeterminism: import.meta.env.DEV });
      this.host = host;
      if (this.canceled) return { kind: 'canceled' };
      const loaded = await host.load({ manifest: req.template.manifest, code: req.template.code, params: req.params, output: req.output, resourceStamp: loadStamp(assets) });
      const total = frameCount(loaded.duration, req.output.fps);
      const cutFrame = loaded.cutTime === null ? null : Math.round(loaded.cutTime * req.output.fps);

      // 离线混音（5.5，M6b）：和预览同一段调度代码，变体是导出引擎写进 cue 的（与预览同一个选择）。
      // 四个预设都带音轨。没有能出声的 cue 时不加音轨；缺失或还没取回的音效静音并提示——导出过程中不联网
      if (this.canceled) return { kind: 'canceled' };
      // 空间音效：和预览同一个开关、同一份算法（schedule.ts 的 spatialFactors）
      const mix = await mixOffline(loaded.audioCues, mixFrames(total, req.output.fps), soundBank, { spatial: useUiStore.getState().settings.editor.spatialAudio });
      reportMissingSounds(mix.missing);
      if (mix.peakNormalized) notify('info', i18next.t('audio.peakNormalized'));

      // 2. 主进程：定位置、校验可写、需要时探测 H.264 编码器、启动 FFmpeg（有音轨时等 writeAudio 之后才启动）
      if (this.canceled) return { kind: 'canceled' };
      const start = await window.allay.export.start({
        preset: req.preset,
        width: req.output.width,
        height: req.output.height,
        fps: req.output.fps as 24 | 25 | 30 | 50 | 60,
        totalFrames: total,
        cutFrame,
        suggestedName: req.suggestedName,
        audio: mix.wav !== null,
      });
      if (!start.ok) return 'canceled' in start ? { kind: 'canceled' } : { kind: 'failed', error: start.error, frame: null };
      this.jobId = start.job.jobId;
      if (this.canceled) {
        await window.allay.export.cancel(start.job.jobId);
        return { kind: 'canceled' };
      }
      if (mix.wav) {
        const audio = await window.allay.export.writeAudio(start.job.jobId, mix.wav);
        if (!audio.ok) {
          this.jobId = null;
          return { kind: 'failed', error: audio.error, frame: null };
        }
        if (this.canceled) return { kind: 'canceled' };
      }

      // 3. 逐帧握手
      const eta = new EtaEstimator();
      eta.mark(performance.now());
      let cutMinAlpha: number | null = null;
      this.onProgress({ stage: 'rendering', written: 0, total, etaSeconds: null });
      for (let i = 0; i < total; i++) {
        frame = i;
        const pixels = await host.renderFrame(i, quality, opaque);
        if (this.canceled) return { kind: 'canceled' };
        if (i === cutFrame && !opaque) cutMinAlpha = minAlpha(pixels);
        const step = await window.allay.export.writeFrame(start.job.jobId, pixels);
        if (!step.ok) return { kind: 'failed', error: step.error, frame: i };
        eta.mark(performance.now());
        this.onProgress({ stage: 'rendering', written: i + 1, total, etaSeconds: eta.eta(total - i - 1) });
        if (exportGate) await Promise.race([exportGate(i + 1), this.canceledSignal]);
        if (this.canceled) return { kind: 'canceled' };
      }
      frame = null;

      // 4. 封装
      this.onProgress({ stage: 'muxing', written: total, total, etaSeconds: 0 });
      const done = await window.allay.export.finish(start.job.jobId);
      const jobId = start.job.jobId;
      this.jobId = null;
      if (!done.ok) return { kind: 'failed', error: done.error, frame: null };
      return {
        kind: 'done',
        jobId,
        path: done.path,
        frames: done.frames,
        fps: req.output.fps,
        duration: loaded.duration,
        cutFrame,
        cutMinAlpha,
        encoder: start.job.encoder,
        seconds: (performance.now() - started) / 1000,
        audio: mix.wav !== null,
        peakNormalized: mix.peakNormalized,
      };
    } catch (error) {
      if (this.canceled) return { kind: 'canceled' };
      if (this.jobId) await window.allay.export.cancel(this.jobId).catch(() => undefined);
      const code = error instanceof EngineUnresponsiveError ? 'template-unresponsive' : 'template-failed';
      return { kind: 'failed', error: { code, detail: error instanceof Error ? error.message : String(error) }, frame };
    } finally {
      this.host?.dispose();
      this.host = null;
    }
  }
}

export type CoverResult = { kind: 'overlay' } | { kind: 'checked'; cutFrame: number; minAlpha: number };

/**
 * 遮盖检查（5.8）：按输出分辨率、所选画质和快门角渲染剪辑点那一帧（直通 alpha），返回最小 alpha。
 * 不到 255 就在对话框里警告，但不阻止导出。叠加层模板没有剪辑点。
 */
export async function coverCheck(req: Pick<ExportRequest, 'template' | 'params' | 'output' | 'quality' | 'shutterAngle'>, signal: AbortSignal): Promise<CoverResult | null> {
  const assets = req.template.assets;
  const host = await EngineHost.create({ mode: 'export', resolveResource: createResolver(() => assets), strictDeterminism: import.meta.env.DEV });
  const abort = () => host.dispose();
  signal.addEventListener('abort', abort);
  try {
    if (signal.aborted) return null;
    const loaded = await host.load({ manifest: req.template.manifest, code: req.template.code, params: req.params, output: req.output, resourceStamp: loadStamp(assets) });
    if (loaded.cutTime === null) return { kind: 'overlay' };
    const cutFrame = Math.round(loaded.cutTime * req.output.fps);
    const pixels = await host.renderFrame(cutFrame, { subframes: QUALITY_SUBFRAMES[req.quality], shutterAngle: req.shutterAngle });
    return signal.aborted ? null : { kind: 'checked', cutFrame, minAlpha: minAlpha(pixels) };
  } catch {
    return null;
  } finally {
    signal.removeEventListener('abort', abort);
    host.dispose();
  }
}
