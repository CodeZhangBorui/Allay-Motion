// “复制诊断信息”（docs/05-export.md 5.7）：失败时把版本、设置、错误码和 FFmpeg stderr 的最后几行拼成一段文字，
// 由用户自己决定发给谁（9.10）。不含任何文件内容，路径只有用户自己选的输出位置。
import type { FfmpegInfo } from '../../../shared/export';
import type { ExportTaskSnapshot } from './exportTasks';

export function diagnosticsText(task: ExportTaskSnapshot, appVersion: string, info: FfmpegInfo | null, templateId: string | null): string {
  const s = task.settings;
  const lines = [
    `app: ${appVersion}`,
    `ffmpeg: ${info?.version ?? 'unknown'}`,
    `h264: ${info?.h264?.encoder ?? (info?.h264 ? 'none' : 'not probed')}`,
    `template: ${templateId ?? 'unknown'}`,
    `preset: ${task.preset}`,
    `output: ${s.width}x${s.height} @ ${s.fps} fps, quality ${s.quality}, shutter ${s.shutterAngle}°${task.preset === 'greenscreen-mp4' ? `, key ${s.key}` : ''}`,
    `frames: ${task.written} / ${task.total}`,
    `status: ${task.status}`,
  ];
  if (task.error) {
    lines.push(`error: ${task.error.code}${task.error.frame !== null ? ` at frame ${task.error.frame}` : ''}`);
    lines.push('detail:', task.error.detail.slice(-8000));
  }
  return lines.join('\n');
}
