// H.264 编码器探测（docs/05-export.md 5.3）：`-encoders` 里列出来不代表能用（取决于显卡和驱动），
// 所以按顺序对每个候选做一次真实的试编码（256×144、8 帧、输出到空设备），第一个成功的胜出。不依赖 Electron。
import { execFile } from 'node:child_process';
import { H264_ENCODERS, type EncoderAttempt, type H264Probe } from '../../shared/export';
import { H264_METADATA_BSF, colorFilter, h264EncoderArgs } from './ffmpeg-args';

export interface ProbeH264Options {
  ffmpeg: string;
  /** ffmpeg -version 的第一行，和结果一起缓存 */
  version: string;
  /** -encoders 列出的编码器名 */
  listed: ReadonlySet<string>;
  /** 候选及顺序；默认 5.3 的表 */
  candidates?: readonly string[];
  /** 单个候选的时限（毫秒） */
  timeoutMs?: number;
}

/** 试编码的命令行：合成画面 → 与导出相同的色彩滤镜、编码器参数和比特流滤镜 → 空设备 */
export function trialArgs(encoder: string): string[] {
  const W = 256;
  const H = 144;
  const FPS = 30;
  return [
    '-hide_banner',
    '-loglevel',
    'error',
    '-f',
    'lavfi',
    '-i',
    `color=c=black:s=${W}x${H}:r=${FPS}`,
    '-frames:v',
    '8',
    '-vf',
    colorFilter('yuv420p'),
    '-c:v',
    encoder,
    ...h264EncoderArgs(encoder, W, H, FPS),
    '-bsf:v',
    H264_METADATA_BSF,
    '-f',
    'null',
    '-',
  ];
}

function trial(ffmpeg: string, encoder: string, timeoutMs: number): Promise<EncoderAttempt> {
  return new Promise((resolve) => {
    execFile(ffmpeg, trialArgs(encoder), { windowsHide: true, timeout: timeoutMs, maxBuffer: 1024 * 1024 }, (error, _stdout, stderr) => {
      if (!error) {
        resolve({ encoder, result: 'ok' });
        return;
      }
      const lines = String(stderr ?? '')
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter(Boolean);
      const last = lines.at(-1) ?? (error.killed ? 'timed out' : error.message);
      resolve({ encoder, result: 'failed', detail: last.slice(0, 500) });
    });
  });
}

/** 按顺序试，第一个成功的胜出；之后的候选不再试 */
export async function probeH264(opts: ProbeH264Options): Promise<H264Probe> {
  const attempts: EncoderAttempt[] = [];
  let winner: string | null = null;
  for (const encoder of opts.candidates ?? H264_ENCODERS) {
    if (!opts.listed.has(encoder)) {
      attempts.push({ encoder, result: 'unlisted' });
      continue;
    }
    const attempt = await trial(opts.ffmpeg, encoder, opts.timeoutMs ?? 20_000);
    attempts.push(attempt);
    if (attempt.result === 'ok') {
      winner = encoder;
      break;
    }
  }
  return { ffmpegVersion: opts.version, encoder: winner, attempts, probedAt: new Date().toISOString() };
}
