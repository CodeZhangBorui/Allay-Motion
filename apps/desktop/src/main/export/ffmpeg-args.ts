// FFmpeg 命令行（docs/05-export.md 5.3、5.4）。纯函数，不依赖 Electron，单元测试和 test:export 直接用。
import type { ExportPreset } from '../../shared/export';

/** 色彩滤镜链 {CS:<像素格式>}：显式 BT.709 矩阵、有限范围，色彩标记用 setparams 写（5.4 第 2、3 条） */
export function colorFilter(pixelFormat: string): string {
  return (
    `scale=out_color_matrix=bt709:out_range=limited,format=${pixelFormat},` +
    'setparams=color_primaries=bt709:color_trc=bt709:colorspace=bt709'
  );
}

export interface FfmpegJobSpec {
  preset: ExportPreset;
  width: number;
  height: number;
  fps: number;
  /** ProRes：输出文件（.partial）；PNG 序列：文件名模板，如 dir/name_%05d.png */
  output: string;
  cutFrame: number | null;
  /**
   * 混好的 48 kHz 立体声 16 位 WAV（5.5）；没有音频时为 null。
   * 只有封装成视频文件的预设把它作为第二个输入；PNG 序列的 WAV 由导出任务另存到同一目录（5.3 ②）。
   */
  audio?: string | null;
}

/** 所有预设共用的输入部分：原始 RGBA 帧从 stdin 进来 */
export function inputArgs(width: number, height: number, fps: number): string[] {
  return [
    '-hide_banner',
    '-loglevel',
    'error',
    '-y',
    '-f',
    'rawvideo',
    '-pixel_format',
    'rgba',
    '-video_size',
    `${width}x${height}`,
    '-framerate',
    String(fps),
    '-i',
    'pipe:0',
  ];
}

export function ffmpegArgs(spec: FfmpegJobSpec): string[] {
  const args = inputArgs(spec.width, spec.height, spec.fps);
  const meta = spec.cutFrame === null ? [] : ['-metadata', `comment=cut_frame=${spec.cutFrame}`];
  switch (spec.preset) {
    case 'prores4444': {
      // 有音频时：WAV 是第二个输入，显式映射视频和音频，音频存成 16 位 PCM（5.3 ①）
      const audioIn = spec.audio ? ['-i', spec.audio] : [];
      const audioOut = spec.audio ? ['-map', '0:v:0', '-map', '1:a:0', '-c:a', 'pcm_s16le'] : [];
      // 不设 -qscale:v（5.3）；输出先写到 .partial，扩展名推断不出容器，所以显式 -f mov
      return [...args, ...audioIn, ...audioOut, '-vf', colorFilter('yuva444p10le'), '-c:v', 'prores_ks', '-profile:v', '4444', '-alpha_bits', '16', '-vendor', 'apl0', ...meta, '-f', 'mov', spec.output];
    }
    case 'png-sequence':
      return [...args, '-c:v', 'png', '-start_number', '0', '-f', 'image2', spec.output];
  }
}

/** 每个预设需要的编码器（5.6） */
export const PRESET_ENCODERS: Record<ExportPreset, string[]> = {
  prores4444: ['prores_ks'],
  'png-sequence': ['png'],
};

export const PRESET_EXTENSION: Record<ExportPreset, string> = {
  prores4444: 'mov',
  'png-sequence': 'png',
};

/** 去掉文件系统不允许的字符（5.2） */
export function sanitizeFileName(name: string): string {
  const cleaned = name
    // eslint-disable-next-line no-control-regex -- 去掉控制字符
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_')
    .replace(/[. ]+$/g, '')
    .trim()
    .slice(0, 120);
  const reserved = /^(con|prn|aux|nul|com\d|lpt\d)$/i;
  if (!cleaned || reserved.test(cleaned)) return 'export';
  return cleaned;
}
