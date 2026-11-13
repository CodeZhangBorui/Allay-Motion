// 导出任务的主进程实现（docs/05-export.md 5.1、1.8 的 export 命名空间）。
// 路径只来自主进程自己的保存对话框（1.6 第 6 条）；测试开关 ALLAY_E2E_EXPORT_TARGET 只在未打包时生效。
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { app, dialog, powerSaveBlocker, type BrowserWindow } from 'electron';
import type {
  ExportFinishResult,
  ExportStartRequest,
  ExportStartResult,
  ExportStepResult,
  FfmpegInfo,
} from '../../shared/export';
import type { Logger } from '../logger';
import { PRESET_EXTENSION, sanitizeFileName } from './ffmpeg-args';
import { locateFfmpeg, probeFfmpeg } from './ffmpeg-locate';
import { ExportJob, ExportJobError } from './export-job';

export interface ExportServiceOptions {
  log: Logger;
  getMainWindow(): BrowserWindow | null;
  /** 未打包时 ALLAY_FFMPEG 指定的 FFmpeg */
  ffmpegOverride: string | null;
  /** 未打包时测试用的输出位置（跳过保存对话框） */
  testTarget: string | null;
}

interface Running {
  job: ExportJob;
  blocker: number;
}

export class ExportService {
  private readonly jobs = new Map<string, Running>();
  private info: Promise<FfmpegInfo> | null = null;

  constructor(private readonly opts: ExportServiceOptions) {}

  /** resources/ffmpeg：打包后在安装目录的 resources 下，开发时在仓库根目录 */
  private resourcesDir(): string {
    return app.isPackaged ? join(process.resourcesPath, 'ffmpeg') : join(app.getAppPath(), '../../resources/ffmpeg');
  }

  ffmpegPath(): string | null {
    return locateFfmpeg({ override: this.opts.ffmpegOverride, resourcesDir: this.resourcesDir(), searchPath: !app.isPackaged });
  }

  /** 启动时跑一次 ffmpeg -version 并记进日志（5.6） */
  ffmpegInfo(): Promise<FfmpegInfo> {
    if (!this.info) {
      const path = this.ffmpegPath();
      this.info = probeFfmpeg(path).then((info) => {
        this.opts.log.info('export', 'ffmpeg probed', { path, version: info.version, presets: info.presets });
        return info;
      });
    }
    return this.info;
  }

  async start(req: ExportStartRequest): Promise<ExportStartResult> {
    const ffmpeg = this.ffmpegPath();
    if (!ffmpeg) return { ok: false, error: { code: 'ffmpeg-missing', detail: 'ffmpeg executable not found' } };

    const target = await this.chooseTarget(req);
    if (!target) return { ok: false, canceled: true };

    const job = new ExportJob({ ffmpeg, preset: req.preset, width: req.width, height: req.height, fps: req.fps, totalFrames: req.totalFrames, cutFrame: req.cutFrame, target });
    try {
      await job.start();
    } catch (error) {
      return { ok: false, error: this.failure(error, 'start') };
    }
    const jobId = randomUUID();
    const blocker = powerSaveBlocker.start('prevent-app-suspension');
    this.jobs.set(jobId, { job, blocker });
    this.opts.log.info('export', 'job started', { jobId, preset: req.preset, width: req.width, height: req.height, fps: req.fps, frames: req.totalFrames });
    return { ok: true, job: { jobId, target } };
  }

  async writeFrame(jobId: string, pixels: Uint8Array): Promise<ExportStepResult> {
    const running = this.require(jobId);
    try {
      await running.job.writeFrame(pixels);
      return { ok: true };
    } catch (error) {
      this.end(jobId);
      return { ok: false, error: this.failure(error, 'write') };
    }
  }

  async finish(jobId: string): Promise<ExportFinishResult> {
    const running = this.require(jobId);
    try {
      const path = await running.job.finish();
      this.opts.log.info('export', 'job finished', { jobId, frames: running.job.framesWritten });
      return { ok: true, path, frames: running.job.framesWritten };
    } catch (error) {
      return { ok: false, error: this.failure(error, 'finish') };
    } finally {
      this.end(jobId);
    }
  }

  async cancel(jobId: string): Promise<void> {
    const running = this.jobs.get(jobId);
    if (!running) return;
    this.end(jobId);
    await running.job.cancel();
    this.opts.log.info('export', 'job canceled', { jobId });
  }

  /** 退出应用时：取消全部任务，不留临时文件 */
  async cancelAll(): Promise<void> {
    await Promise.all([...this.jobs.keys()].map((id) => this.cancel(id)));
  }

  private require(jobId: string): Running {
    const running = this.jobs.get(jobId);
    if (!running) throw new UnknownJobError();
    return running;
  }

  private end(jobId: string): void {
    const running = this.jobs.get(jobId);
    if (!running) return;
    this.jobs.delete(jobId);
    if (powerSaveBlocker.isStarted(running.blocker)) powerSaveBlocker.stop(running.blocker);
  }

  private failure(error: unknown, stage: string) {
    const failure =
      error instanceof ExportJobError ? error.failure : { code: 'ffmpeg-failed' as const, detail: error instanceof Error ? error.message : String(error) };
    this.opts.log.warn('export', 'job failed', { stage, code: failure.code, detail: failure.detail.slice(-1000) });
    return failure;
  }

  private async chooseTarget(req: ExportStartRequest): Promise<string | null> {
    const name = `${sanitizeFileName(req.suggestedName)}`;
    if (this.opts.testTarget) {
      return req.preset === 'png-sequence' ? join(this.opts.testTarget, name) : join(this.opts.testTarget, `${name}.${PRESET_EXTENSION[req.preset]}`);
    }
    const win = this.opts.getMainWindow();
    if (!win || win.isDestroyed()) return null;
    if (req.preset === 'png-sequence') {
      const result = await dialog.showOpenDialog(win, { properties: ['openDirectory', 'createDirectory'] });
      const dir = result.filePaths[0];
      return result.canceled || !dir ? null : join(dir, name);
    }
    const result = await dialog.showSaveDialog(win, {
      defaultPath: `${name}.${PRESET_EXTENSION[req.preset]}`,
      filters: [{ name: 'QuickTime', extensions: [PRESET_EXTENSION[req.preset]] }],
    });
    return result.canceled || !result.filePath ? null : result.filePath;
  }
}

export class UnknownJobError extends Error {
  constructor() {
    super('unknown export job');
    this.name = 'UnknownJobError';
  }
}
