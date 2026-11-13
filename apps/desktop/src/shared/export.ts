// 导出的共享定义（docs/05-export.md）：预设 ID、请求与结果的 schema、错误码。
// 主进程和渲染进程共用；进程边界用这里的 schema 校验。
import { z } from 'zod';

/** M1 实现的两个预设；webm-vp9 和 greenscreen-mp4 在 M7 加入（5.3） */
export const EXPORT_PRESETS = ['prores4444', 'png-sequence'] as const;
export const ExportPresetSchema = z.enum(EXPORT_PRESETS);
export type ExportPreset = z.infer<typeof ExportPresetSchema>;

export const EXPORT_FPS = [24, 25, 30, 50, 60] as const;

/** 宽高各限制在 64–4096，取偶数（5.2） */
const Dimension = z
  .int()
  .min(64)
  .max(4096)
  .refine((v) => v % 2 === 0, { message: 'must be even' });

/** 30 秒 × 60 fps，再加首尾两帧的余量 */
export const MAX_EXPORT_FRAMES = 30 * 60 + 2;

export const ExportStartSchema = z.strictObject({
  preset: ExportPresetSchema,
  width: Dimension,
  height: Dimension,
  fps: z.union(EXPORT_FPS.map((f) => z.literal(f)) as [z.ZodLiteral<24>, z.ZodLiteral<25>, z.ZodLiteral<30>, z.ZodLiteral<50>, z.ZodLiteral<60>]),
  totalFrames: z.int().min(1).max(MAX_EXPORT_FRAMES),
  /** 剪辑点所在的帧；叠加层模板没有 */
  cutFrame: z.int().min(0).max(MAX_EXPORT_FRAMES).nullable(),
  /** 建议的文件名（不含扩展名）；主进程会再清洗一次 */
  suggestedName: z.string().min(1).max(120),
  /** 有音轨（5.5）：为真时主进程等 writeAudio 交来混音后才启动 FFmpeg。缺省为没有 */
  audio: z.boolean().optional(),
});
export type ExportStartRequest = z.infer<typeof ExportStartSchema>;

export const ExportJobIdSchema = z.uuid();

/** 单帧最大字节数：4096 × 4096 × 4 */
export const MAX_FRAME_BYTES = 4096 * 4096 * 4;
export const FramePixelsSchema = z.instanceof(Uint8Array).refine((b) => b.byteLength > 0 && b.byteLength <= MAX_FRAME_BYTES, {
  message: 'frame size out of range',
});

/** 混音的格式（5.5）：48 kHz、立体声、16 位 PCM 的 WAV */
export const AUDIO_SAMPLE_RATE = 48_000;
export const AUDIO_CHANNELS = 2;
/** WAV 最大字节数：31 秒（30 秒加余量）的 48 kHz 立体声 16 位，再加头部 */
export const MAX_AUDIO_BYTES = 31 * AUDIO_SAMPLE_RATE * AUDIO_CHANNELS * 2 + 1024;
export const AudioWavSchema = z.instanceof(Uint8Array).refine((b) => b.byteLength > 44 && b.byteLength <= MAX_AUDIO_BYTES, {
  message: 'audio size out of range',
});

export interface WavInfo {
  channels: number;
  sampleRate: number;
  bitsPerSample: number;
  /** data 块的字节数 */
  dataBytes: number;
}

/** 读 WAV 头（RIFF/WAVE，fmt 为 PCM）。不是这种格式时返回 null */
export function readWavInfo(bytes: Uint8Array): WavInfo | null {
  if (bytes.byteLength < 44) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const tag = (o: number) => String.fromCharCode(bytes[o]!, bytes[o + 1]!, bytes[o + 2]!, bytes[o + 3]!);
  if (tag(0) !== 'RIFF' || tag(8) !== 'WAVE') return null;
  let fmt: Omit<WavInfo, 'dataBytes'> | null = null;
  for (let o = 12; o + 8 <= bytes.byteLength; ) {
    const id = tag(o);
    const size = view.getUint32(o + 4, true);
    const body = o + 8;
    if (id === 'fmt ' && size >= 16 && body + 16 <= bytes.byteLength) {
      if (view.getUint16(body, true) !== 1) return null;
      fmt = { channels: view.getUint16(body + 2, true), sampleRate: view.getUint32(body + 4, true), bitsPerSample: view.getUint16(body + 14, true) };
    } else if (id === 'data') {
      if (!fmt || body + size > bytes.byteLength) return null;
      return { ...fmt, dataBytes: size };
    }
    o = body + size + (size % 2);
  }
  return null;
}

/** 失败的种类；界面按它给出一句人话（5.7） */
export const EXPORT_ERROR_CODES = [
  'ffmpeg-missing',
  'output-not-writable',
  'disk-full',
  'encoder-unavailable',
  'ffmpeg-failed',
  'frame-mismatch',
  'template-failed',
  'template-unresponsive',
] as const;
export type ExportErrorCode = (typeof EXPORT_ERROR_CODES)[number];

export interface ExportFailure {
  code: ExportErrorCode;
  /** 诊断信息（FFmpeg stderr 的最后几行等），只用于日志和“复制诊断信息” */
  detail: string;
}

export interface ExportStarted {
  jobId: string;
  /** 用户选的输出位置（显示用） */
  target: string;
}

export type ExportStepResult = { ok: true } | { ok: false; error: ExportFailure };
export type ExportFinishResult = { ok: true; path: string; frames: number } | { ok: false; error: ExportFailure };
export type ExportStartResult = { ok: true; job: ExportStarted } | { ok: false; error: ExportFailure } | { ok: false; canceled: true };

export interface FfmpegInfo {
  available: boolean;
  version: string | null;
  /** 每个预设是否可用（所需编码器都在） */
  presets: Record<ExportPreset, boolean>;
}
