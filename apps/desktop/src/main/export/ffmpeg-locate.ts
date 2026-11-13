// FFmpeg 的位置与能力（docs/05-export.md 5.6）。不依赖 Electron。
import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { delimiter, join } from 'node:path';
import { promisify } from 'node:util';
import { EXPORT_PRESETS, type ExportPreset, type FfmpegInfo } from '../../shared/export';
import { PRESET_ENCODERS } from './ffmpeg-args';

const run = promisify(execFile);

/** resources/ffmpeg/<平台>/ 下的目录名 */
export function platformDir(): string {
  return `${process.platform}-${process.arch}`;
}

export function exeName(tool: 'ffmpeg' | 'ffprobe'): string {
  return process.platform === 'win32' ? `${tool}.exe` : tool;
}

export interface LocateOptions {
  /** 未打包时可用：ALLAY_FFMPEG 指定的可执行文件 */
  override: string | null;
  /** resources/ffmpeg 目录（开发时是仓库根目录下的，打包后是 process.resourcesPath 下的） */
  resourcesDir: string;
  /** 未打包时可以退到 PATH */
  searchPath: boolean;
  env?: NodeJS.ProcessEnv;
}

/** 查找顺序：ALLAY_FFMPEG（仅开发）、resources/ffmpeg/、PATH（仅开发）。找不到返回 null */
export function locateFfmpeg(opts: LocateOptions): string | null {
  if (opts.override) return opts.override;
  const bundled = join(opts.resourcesDir, platformDir(), exeName('ffmpeg'));
  if (existsSync(bundled)) return bundled;
  if (!opts.searchPath) return null;
  const pathVar = (opts.env ?? process.env).PATH ?? (opts.env ?? process.env).Path ?? '';
  for (const dir of pathVar.split(delimiter)) {
    if (!dir) continue;
    const candidate = join(dir, exeName('ffmpeg'));
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

const NO_WINDOW = { windowsHide: true, timeout: 15_000, maxBuffer: 8 * 1024 * 1024 } as const;

/** 跑一次 ffmpeg -version 和 -encoders，得出版本和每个预设能不能用 */
export async function probeFfmpeg(ffmpeg: string | null): Promise<FfmpegInfo> {
  const none = Object.fromEntries(EXPORT_PRESETS.map((p) => [p, false])) as Record<ExportPreset, boolean>;
  if (!ffmpeg) return { available: false, version: null, presets: none };
  try {
    const version = (await run(ffmpeg, ['-hide_banner', '-version'], NO_WINDOW)).stdout.split(/\r?\n/)[0]?.trim() ?? null;
    const encodersOut = (await run(ffmpeg, ['-hide_banner', '-encoders'], NO_WINDOW)).stdout;
    const encoders = parseEncoders(encodersOut);
    const presets = Object.fromEntries(EXPORT_PRESETS.map((p) => [p, PRESET_ENCODERS[p].every((e) => encoders.has(e))])) as Record<ExportPreset, boolean>;
    return { available: true, version, presets };
  } catch {
    return { available: false, version: null, presets: none };
  }
}

/** 解析 ffmpeg -encoders 的输出，取编码器名 */
export function parseEncoders(text: string): Set<string> {
  const names = new Set<string>();
  let started = false;
  for (const line of text.split(/\r?\n/)) {
    if (!started) {
      if (/^\s*-{6}/.test(line)) started = true;
      continue;
    }
    const m = /^\s*[VAS.][F.][S.][X.][B.][D.]\s+(\S+)/.exec(line);
    if (m?.[1]) names.add(m[1]);
  }
  return names;
}
