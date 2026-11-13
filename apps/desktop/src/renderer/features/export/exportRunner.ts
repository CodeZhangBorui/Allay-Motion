// 导出流程的渲染进程部分（docs/05-export.md 5.1）：新建导出 Worker 并 load，
// 然后逐帧握手：renderFrame(i) → window.allay.export.writeFrame(jobId, pixels)。
// 取消就终止导出 Worker 并让主进程杀掉 FFmpeg、删除 .partial。
import { frameCount } from '@allay/engine/frames';
import type { FrameQuality, OutputSettings, ParamValues } from '@allay/template-sdk';
import type { ExportFailure, ExportPreset } from '../../../shared/export';
import { EngineHost, EngineUnresponsiveError } from '../../engine-host/EngineHost';
import { STUB_RESOURCE_STAMP, stubResolveResource } from '../../engine-host/stub-resources';
import type { TemplateSource } from '../../templates/builtin';

/** 画质档位（02-engine.md 2.7） */
export const QUALITY_SUBFRAMES = { draft: 1, standard: 8, high: 16, ultra: 32 } as const;
export type QualityLevel = keyof typeof QUALITY_SUBFRAMES;

export interface ExportRequest {
  template: TemplateSource;
  params: ParamValues;
  output: OutputSettings;
  preset: ExportPreset;
  quality: QualityLevel;
  shutterAngle: number;
  suggestedName: string;
}

export interface ExportProgress {
  written: number;
  total: number;
}

export type ExportOutcome =
  | { kind: 'done'; path: string; frames: number; cutFrame: number | null; seconds: number }
  | { kind: 'canceled' }
  | { kind: 'failed'; error: ExportFailure; frame: number | null };

export class ExportRun {
  private canceled = false;
  private host: EngineHost | null = null;
  private jobId: string | null = null;

  constructor(
    private readonly req: ExportRequest,
    private readonly onProgress: (p: ExportProgress) => void,
  ) {}

  /** 用户点了“取消”：终止导出 Worker，主进程杀掉 FFmpeg 并删掉临时文件 */
  async cancel(): Promise<void> {
    this.canceled = true;
    this.host?.dispose();
    if (this.jobId) await window.allay.export.cancel(this.jobId);
  }

  async run(): Promise<ExportOutcome> {
    const started = performance.now();
    const { req } = this;
    const quality: FrameQuality = { subframes: QUALITY_SUBFRAMES[req.quality], shutterAngle: req.shutterAngle };
    let frame: number | null = null;
    try {
      // 1. 导出 Worker：每次导出新建，用输出分辨率的离屏画布
      const host = await EngineHost.create({ mode: 'export', resolveResource: stubResolveResource, strictDeterminism: import.meta.env.DEV });
      this.host = host;
      if (this.canceled) return { kind: 'canceled' };
      const loaded = await host.load({ manifest: req.template.manifest, code: req.template.code, params: req.params, output: req.output, resourceStamp: STUB_RESOURCE_STAMP });
      const total = frameCount(loaded.duration, req.output.fps);
      const cutFrame = loaded.cutTime === null ? null : Math.round(loaded.cutTime * req.output.fps);

      // 2. 主进程：选位置、校验可写、启动 FFmpeg
      if (this.canceled) return { kind: 'canceled' };
      const start = await window.allay.export.start({
        preset: req.preset,
        width: req.output.width,
        height: req.output.height,
        fps: req.output.fps as 24 | 25 | 30 | 50 | 60,
        totalFrames: total,
        cutFrame,
        suggestedName: req.suggestedName,
      });
      if (!start.ok) return 'canceled' in start ? { kind: 'canceled' } : { kind: 'failed', error: start.error, frame: null };
      this.jobId = start.job.jobId;
      if (this.canceled) {
        await window.allay.export.cancel(start.job.jobId);
        return { kind: 'canceled' };
      }

      // 3. 逐帧握手
      this.onProgress({ written: 0, total });
      for (let i = 0; i < total; i++) {
        frame = i;
        const pixels = await host.renderFrame(i, quality);
        if (this.canceled) return { kind: 'canceled' };
        const step = await window.allay.export.writeFrame(start.job.jobId, pixels);
        if (!step.ok) return { kind: 'failed', error: step.error, frame: i };
        this.onProgress({ written: i + 1, total });
      }
      frame = null;

      // 4. 封装
      const done = await window.allay.export.finish(start.job.jobId);
      this.jobId = null;
      if (!done.ok) return { kind: 'failed', error: done.error, frame: null };
      return { kind: 'done', path: done.path, frames: done.frames, cutFrame, seconds: (performance.now() - started) / 1000 };
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
