// 一个导出任务（docs/05-export.md 5.1、5.7）：FFmpeg 子进程从 stdin 接收原始 RGBA 帧。
// 不依赖 Electron；对话框、IPC、休眠阻止在 export-service.ts。
//
// - 输出先写到 <目标>.partial（PNG 序列是 <目录>/<名字>.partial/），成功后改名。
// - writeFrame 在数据写进 stdin、且（缓冲满时）等到 drain 之后才返回，内存里最多一两帧。
// - 取消、失败：杀掉 FFmpeg，等它退出，删除 .partial。任何结局都不留下临时文件。
import { spawn, type ChildProcessByStdio } from 'node:child_process';
import { once } from 'node:events';
import { mkdir, open, rename, rm, stat } from 'node:fs/promises';
import { basename, dirname, extname, join } from 'node:path';
import type { Readable, Writable } from 'node:stream';
import type { ExportErrorCode, ExportFailure, ExportPreset } from '../../shared/export';
import { ffmpegArgs } from './ffmpeg-args';

export interface ExportJobOptions {
  ffmpeg: string;
  preset: ExportPreset;
  width: number;
  height: number;
  fps: number;
  totalFrames: number;
  cutFrame: number | null;
  /**
   * 最终位置。ProRes：文件路径（…/name.mov）；PNG 序列：目录路径（…/name），帧写成 name_00000.png。
   */
  target: string;
}

export class ExportJobError extends Error {
  constructor(readonly failure: ExportFailure) {
    super(`${failure.code}: ${failure.detail}`);
    this.name = 'ExportJobError';
  }
}

type State = 'idle' | 'running' | 'finishing' | 'done' | 'failed' | 'canceled';

const STDERR_LINES = 20;

/** 根据 FFmpeg 的 stderr 判断失败的种类（5.7） */
export function classifyFfmpegError(stderr: string): ExportErrorCode {
  const s = stderr.toLowerCase();
  if (/no space left|disk full|not enough space|there is not enough space/.test(s)) return 'disk-full';
  if (/unknown encoder|encoder not found|error while opening encoder|could not open encoder|encoder .* not found/.test(s)) return 'encoder-unavailable';
  if (/permission denied|read-only file system|access is denied|no such file or directory|could not open file|invalid argument.*\.partial/.test(s)) {
    return 'output-not-writable';
  }
  return 'ffmpeg-failed';
}

function isNotWritable(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException | null)?.code;
  return code === 'ENOENT' || code === 'ENOTDIR' || code === 'EACCES' || code === 'EPERM' || code === 'EROFS' || code === 'EISDIR' || code === 'EEXIST' || code === 'EINVAL';
}

function errnoDetail(error: unknown): string {
  const e = error as NodeJS.ErrnoException;
  return `${e.code ?? 'error'}: ${e.message ?? String(error)}`;
}

export class ExportJob {
  readonly partial: string;
  private proc: ChildProcessByStdio<Writable, null, Readable> | null = null;
  private exited: Promise<number | null> | null = null;
  private stderrLines: string[] = [];
  private state: State = 'idle';
  private written = 0;
  private spawnError: NodeJS.ErrnoException | null = null;
  private stdinError: Error | null = null;
  private readonly frameBytes: number;

  constructor(private readonly opts: ExportJobOptions) {
    this.partial = `${opts.target}.partial`;
    this.frameBytes = opts.width * opts.height * 4;
  }

  get framesWritten(): number {
    return this.written;
  }

  get pid(): number | undefined {
    return this.proc?.pid;
  }

  get status(): State {
    return this.state;
  }

  /** 校验输出位置可写，启动 FFmpeg */
  async start(): Promise<void> {
    if (this.state !== 'idle') throw new Error('job already started');
    this.state = 'running';
    const { preset, target } = this.opts;
    let output: string;
    try {
      if (preset === 'png-sequence') {
        await rm(this.partial, { recursive: true, force: true });
        await mkdir(this.partial);
        output = join(this.partial, `${basename(target)}_%05d.png`);
      } else {
        // 先自己建一次 .partial：路径不可写在这里就能发现，不必等 FFmpeg 报错
        const fh = await open(this.partial, 'w');
        await fh.close();
        output = this.partial;
      }
    } catch (error) {
      await this.cleanup();
      this.state = 'failed';
      throw new ExportJobError({ code: isNotWritable(error) ? 'output-not-writable' : 'ffmpeg-failed', detail: errnoDetail(error) });
    }

    const args = ffmpegArgs({ preset, width: this.opts.width, height: this.opts.height, fps: this.opts.fps, output, cutFrame: this.opts.cutFrame });
    let proc: ChildProcessByStdio<Writable, null, Readable>;
    try {
      proc = spawn(this.opts.ffmpeg, args, { stdio: ['pipe', 'ignore', 'pipe'], windowsHide: true });
    } catch (error) {
      await this.cleanup();
      this.state = 'failed';
      throw new ExportJobError({ code: 'ffmpeg-missing', detail: errnoDetail(error) });
    }
    this.proc = proc;
    proc.stderr.setEncoding('utf8');
    proc.stderr.on('data', (chunk: string) => {
      this.stderrLines.push(...chunk.split(/\r?\n/).filter(Boolean));
      if (this.stderrLines.length > 200) this.stderrLines = this.stderrLines.slice(-STDERR_LINES);
    });
    proc.stdin.on('error', (error) => {
      this.stdinError = error;
    });
    this.exited = new Promise((resolve) => {
      proc.once('error', (error: NodeJS.ErrnoException) => {
        this.spawnError = error;
        resolve(null);
      });
      proc.once('close', (code) => resolve(code));
    });
    // 坏的二进制、找不到文件：spawn 的 error 事件在下一轮事件循环里才来，等它一下
    await new Promise<void>((resolve) => {
      proc.once('spawn', () => resolve());
      proc.once('error', () => resolve());
    });
    if (this.spawnError) {
      const detail = errnoDetail(this.spawnError);
      await this.abort();
      this.state = 'failed';
      throw new ExportJobError({ code: 'ffmpeg-missing', detail });
    }
  }

  /** 写一帧；FFmpeg 已经退出或写失败时，杀进程、清理并抛出 ExportJobError */
  async writeFrame(pixels: Uint8Array): Promise<void> {
    if (this.state !== 'running' || !this.proc) throw new Error(`cannot write a frame while ${this.state}`);
    if (pixels.byteLength !== this.frameBytes) {
      await this.fail({ code: 'frame-mismatch', detail: `expected ${this.frameBytes} bytes, got ${pixels.byteLength}` });
    }
    if (this.written >= this.opts.totalFrames) {
      await this.fail({ code: 'frame-mismatch', detail: `more than ${this.opts.totalFrames} frames` });
    }
    const stdin = this.proc.stdin;
    const buf = Buffer.from(pixels.buffer, pixels.byteOffset, pixels.byteLength);
    const exitedEarly = this.exited!.then(() => 'exited' as const);
    const ok = stdin.write(buf);
    if (!ok) {
      const result = await Promise.race([once(stdin, 'drain').then(() => 'drain' as const, () => 'error' as const), exitedEarly]);
      if (result !== 'drain') await this.failFromProcess();
    }
    if (this.stdinError || this.proc.exitCode !== null || this.spawnError) await this.failFromProcess();
    this.written++;
  }

  /** 关闭 stdin，等 FFmpeg 以 0 退出，把 .partial 改名为最终位置。返回最终路径 */
  async finish(): Promise<string> {
    if (this.state !== 'running' || !this.proc) throw new Error(`cannot finish while ${this.state}`);
    if (this.written !== this.opts.totalFrames) {
      await this.fail({ code: 'frame-mismatch', detail: `wrote ${this.written} of ${this.opts.totalFrames} frames` });
    }
    this.state = 'finishing';
    this.proc.stdin.end();
    const code = await this.exited!;
    if (code !== 0 || this.spawnError) {
      this.state = 'running';
      await this.failFromProcess();
    }
    try {
      const final = await this.place();
      this.state = 'done';
      return final;
    } catch (error) {
      await this.cleanup();
      this.state = 'failed';
      throw new ExportJobError({ code: isNotWritable(error) ? 'output-not-writable' : 'ffmpeg-failed', detail: errnoDetail(error) });
    }
  }

  /** 取消：杀掉 FFmpeg，删除 .partial。可以重复调用 */
  async cancel(): Promise<void> {
    if (this.state === 'done' || this.state === 'canceled' || this.state === 'failed') return;
    this.state = 'canceled';
    await this.abort();
  }

  /** 最后 20 行 stderr */
  stderrTail(): string {
    return this.stderrLines.slice(-STDERR_LINES).join('\n');
  }

  // ---- 内部 ----

  private async failFromProcess(): Promise<never> {
    // 先等进程真的退出，stderr 才完整
    await this.killAndWait();
    const tail = this.stderrTail();
    if (this.spawnError) return this.fail({ code: 'ffmpeg-missing', detail: errnoDetail(this.spawnError) });
    return this.fail({ code: classifyFfmpegError(tail), detail: tail || (this.stdinError ? String(this.stdinError) : `ffmpeg exited with code ${String(this.proc?.exitCode)}`) });
  }

  private async fail(failure: ExportFailure): Promise<never> {
    await this.abort();
    this.state = 'failed';
    throw new ExportJobError(failure);
  }

  private async killAndWait(): Promise<void> {
    const proc = this.proc;
    if (!proc || !this.exited) return;
    if (proc.exitCode === null && proc.signalCode === null && !this.spawnError) {
      proc.stdin.destroy();
      proc.kill('SIGKILL');
    }
    await this.exited;
  }

  private async abort(): Promise<void> {
    await this.killAndWait();
    await this.cleanup();
  }

  private async cleanup(): Promise<void> {
    // Windows 上进程刚退出时文件句柄可能还没完全释放，重试几次
    await rm(this.partial, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }

  /** 把 .partial 改名到最终位置。ProRes 的目标由保存对话框确认过覆盖；PNG 目录重名时加 “ (2)” */
  private async place(): Promise<string> {
    const { target, preset } = this.opts;
    if (preset === 'prores4444') {
      await rm(target, { force: true });
      await rename(this.partial, target);
      return target;
    }
    let final = target;
    for (let n = 2; await exists(final); n++) {
      final = join(dirname(target), `${basename(target, extname(target))} (${n})`);
    }
    await rename(this.partial, final);
    return final;
  }
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}
