// 导出界面的几个文案映射与格式化（对话框各页共用）。
import type { ExportErrorCode } from '../../../shared/export';

/** 每个错误码对应的文案键 */
export const EXPORT_ERROR_KEYS: Record<ExportErrorCode, string> = {
  'ffmpeg-missing': 'export.errors.ffmpegMissing',
  'output-not-writable': 'export.errors.outputNotWritable',
  'disk-full': 'export.errors.diskFull',
  'encoder-unavailable': 'export.errors.encoderUnavailable',
  'ffmpeg-failed': 'export.errors.ffmpegFailed',
  'frame-mismatch': 'export.errors.frameMismatch',
  'template-failed': 'export.errors.templateFailed',
  'template-unresponsive': 'export.errors.templateUnresponsive',
};

/** 字节数的显示：MB 一位小数，超过 1 GB 用 GB */
export function formatBytes(bytes: number): string {
  if (bytes >= 1e9) return `${(bytes / 1e9).toFixed(1)} GB`;
  if (bytes >= 1e6) return `${(bytes / 1e6).toFixed(1)} MB`;
  return `${Math.max(0.1, bytes / 1e6).toFixed(1)} MB`;
}
