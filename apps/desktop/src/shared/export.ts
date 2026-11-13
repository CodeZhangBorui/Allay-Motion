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
});
export type ExportStartRequest = z.infer<typeof ExportStartSchema>;

export const ExportJobIdSchema = z.uuid();

/** 单帧最大字节数：4096 × 4096 × 4 */
export const MAX_FRAME_BYTES = 4096 * 4096 * 4;
export const FramePixelsSchema = z.instanceof(Uint8Array).refine((b) => b.byteLength > 0 && b.byteLength <= MAX_FRAME_BYTES, {
  message: 'frame size out of range',
});

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
