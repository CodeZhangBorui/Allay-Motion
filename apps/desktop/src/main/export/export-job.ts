// 一个导出任务（docs/05-export.md 5.1、5.7）：FFmpeg 子进程从 stdin 接收原始 RGBA 帧。
// 不依赖 Electron；对话框、IPC、休眠阻止在 export-service.ts。
//
// - 输出先写到 <目标>.partial（PNG 序列是 <目录>/<名字>.partial/），成功后改名。
// - writeFrame 在数据写进 stdin、且（缓冲满时）等到 drain 之后才返回，内存里最多一两帧。
// - 取消、失败：杀掉 FFmpeg，等它退出，删除 .partial。任何结局都不留下临时文件（包括有音轨时的临时 WAV）。
import { spawn, type ChildProcessByStdio } from 'node:child_process';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import { mkdir, open, rename, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, extname, join } from 'node:path';
import type { Readable, Writable } from 'node:stream';
import { AUDIO_CHANNELS, AUDIO_SAMPLE_RATE, readWavInfo, type ExportErrorCode, type ExportFailure, type ExportPreset } from '../../shared/export';
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
   * 最终位置。视频：文件路径（…/name.mov 等）；PNG 序列：目录路径（…/name），帧写成 name_00000.png。
   * 已经存在时不覆盖，改名时加 “ (2)”（5.2）。
   */
  target: string;
  /** 绿幕 MP4 的 H.264 编码器（探测结果） */
  h264Encoder?: string | null;
  /**
   * 有音轨（5.5，M6b）：start() 只做路径检查，等 writeAudio() 交来 WAV 后才启动 FFmpeg（WAV 是 FFmpeg 的输入，要先落盘）。
   * 视频预设把 WAV 写到临时目录作为第二个输入；PNG 序列把它另存为同一目录里的 name.wav（5.3 ②）。
   */
  audio?: boolean;
  /** 临时 WAV 放在哪个目录（缺省为系统临时目录） */
  tempDir?: string;
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
  /** FFmpeg 的输出参数（start() 里定下来；有音轨时等 writeAudio() 之后才用它启动） */
  private output: string | null = null;
  /** 有音轨且还没收到 WAV */
  private awaitingAudio: boolean;
  /** 视频预设的临时 WAV；任何结局都删除 */
  private tempWav: string | null = null;

  constructor(private readonly opts: ExportJobOptions) {
    this.partial = `${opts.target}.partial`;
    this.frameBytes = opts.width * opts.height * 4;
    this.awaitingAudio = opts.audio === true;
  }

  /** 临时 WAV 的路径（测试用）；没有时为 null */
  get tempAudioPath(): string | null {
    return this.tempWav;
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

  /** 校验输出位置可写，启动 FFmpeg（有音轨时等 writeAudio） */
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
    this.output = output;
    if (!this.awaitingAudio) await this.launch(null);
  }

  /**
   * 交来混好的 WAV（48 kHz 立体声 16 位 PCM，5.5），然后启动 FFmpeg。只能在 start() 之后、第一帧之前调用一次，
   * 而且只对声明了 audio 的任务。WAV 不合格式时任务失败（清理，不留文件）。
   */
  async writeAudio(wav: Uint8Array): Promise<void> {
    if (this.state !== 'running' || !this.awaitingAudio || this.proc) throw new Error('this job does not expect audio now');
    const info = readWavInfo(wav);
    if (!info || info.channels !== AUDIO_CHANNELS || info.sampleRate !== AUDIO_SAMPLE_RATE || info.bitsPerSample !== 16) {
      await this.fail({ code: 'ffmpeg-failed', detail: 'audio is not a 48 kHz stereo 16-bit PCM WAV' });
    }
    this.awaitingAudio = false;
    try {
      if (this.opts.preset === 'png-sequence') {
        // PNG 序列：WAV 另存到同一目录（5.3 ②），随目录一起改名到最终位置
        await writeFile(join(this.partial, `${basename(this.opts.target)}.wav`), wav);
        await this.launch(null);
        return;
      }
      this.tempWav = join(this.opts.tempDir ?? tmpdir(), `allay-mix-${randomUUID()}.wav`);
      await writeFile(this.tempWav, wav, { flag: 'wx' });
    } catch (error) {
      await this.cleanup();
      this.state = 'failed';
      throw new ExportJobError({ code: isNotWritable(error) ? 'output-not-writable' : 'ffmpeg-failed', detail: errnoDetail(error) });
    }
    await this.launch(this.tempWav);
  }

  private async launch(audio: string | null): Promise<void> {
    const output = this.output!;
    const args = ffmpegArgs({
      preset: this.opts.preset,
      width: this.opts.width,
      height: this.opts.height,
      fps: this.opts.fps,
      output,
      cutFrame: this.opts.cutFrame,
      audio,
      h264Encoder: this.opts.h264Encoder ?? null,
    });
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
      await this.removeTempAudio();
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
    await this.removeTempAudio();
  }

  private async removeTempAudio(): Promise<void> {
    if (this.tempWav) await rm(this.tempWav, { force: true, maxRetries: 10, retryDelay: 100 });
  }

  /** 把 .partial 改名到最终位置；目标已经存在时不覆盖，加 “ (2)”、“ (3)”…（5.2） */
  private async place(): Promise<string> {
    const final = await uniquePath(this.opts.target, false);
    await rename(this.partial, final);
    return final;
  }
}

/** 不与已有文件或目录重名的路径：name.ext → name (2).ext → name (3).ext …（目录没有扩展名） */
export async function uniquePath(target: string, avoidPartial = true): Promise<string> {
  const ext = extname(target);
  // PNG 序列的目录名里可能有点号（如 1.5x），只有真正的视频扩展名才当扩展名
  const isVideo = /^\.(mov|webm|mp4)$/i.test(ext);
  const stem = isVideo ? basename(target, ext) : basename(target);
  const suffix = isVideo ? ext : '';
  let final = target;
  for (let n = 2; (await exists(final)) || (avoidPartial && (await exists(`${final}.partial`))); n++) {
    final = join(dirname(target), `${stem} (${n})${suffix}`);
  }
  return final;
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}
