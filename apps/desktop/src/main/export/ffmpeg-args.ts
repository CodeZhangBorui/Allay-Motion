// FFmpeg 命令行（docs/05-export.md 5.3、5.4）。纯函数，不依赖 Electron，单元测试和 test:export 直接用。
import type { ExportPreset } from '../../shared/export';

export { PRESET_EXTENSION, sanitizeFileName } from '../../shared/export';

/** 色彩滤镜链 {CS:<像素格式>}：显式 BT.709 矩阵、有限范围，色彩标记用 setparams 写（5.4 第 2、3 条） */
export function colorFilter(pixelFormat: string): string {
  return (
    `scale=out_color_matrix=bt709:out_range=limited,format=${pixelFormat},` +
    'setparams=color_primaries=bt709:color_trc=bt709:colorspace=bt709'
  );
}

/** H.264 一律加的比特流滤镜：无论哪个编码器都写上 BT.709 色彩标记（5.4 第 4 条） */
export const H264_METADATA_BSF = 'h264_metadata=colour_primaries=1:transfer_characteristics=1:matrix_coefficients=1:video_full_range_flag=0';

/** 1080p60 时 h264_mf、libopenh264 用的码率；其他尺寸按像素数 × 帧率等比缩放（5.3） */
export function h264Bitrate(width: number, height: number, fps: number): number {
  return Math.round((20_000_000 * width * height * fps) / (1920 * 1080 * 60));
}

/** 每个 H.264 编码器的参数（5.3 的表）；不认识的编码器不带参数 */
export function h264EncoderArgs(encoder: string, width: number, height: number, fps: number): string[] {
  switch (encoder) {
    case 'h264_nvenc':
      return ['-rc', 'vbr', '-cq', '18', '-b:v', '0'];
    case 'h264_qsv':
      return ['-global_quality', '18'];
    case 'h264_amf':
      return ['-rc', 'cqp', '-qp_i', '18', '-qp_p', '18'];
    case 'h264_mf':
    case 'libopenh264':
      return ['-b:v', String(h264Bitrate(width, height, fps))];
    case 'libx264':
      return ['-crf', '16', '-preset', 'medium'];
    default:
      return [];
  }
}

export interface FfmpegJobSpec {
  preset: ExportPreset;
  width: number;
  height: number;
  fps: number;
  /** 输出文件（.partial）；PNG 序列是文件名模板，如 dir/name_%05d.png */
  output: string;
  cutFrame: number | null;
  /**
   * 离线混好的音频（临时 WAV）；没有音轨时为 null。M6b 填这个参数，M7 只留好位置。
   * PNG 序列不经 FFmpeg 封装音频（WAV 另存到同一目录，5.3 ②），这里忽略。
   */
  audio?: string | null;
  /** 绿幕 MP4 用的 H.264 编码器（探测结果） */
  h264Encoder?: string | null;
}

/** 所有预设共用的输入部分：原始 RGBA 帧从 stdin 进来，有音频时再加一个输入 */
export function inputArgs(width: number, height: number, fps: number, audio: string | null = null): string[] {
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
    ...(audio ? ['-i', audio] : []),
  ];
}

/** 每个预设的音频编码参数（5.3 的 [-c:a …]） */
export const PRESET_AUDIO_ARGS: Record<ExportPreset, string[]> = {
  prores4444: ['-c:a', 'pcm_s16le'],
  'png-sequence': [],
  'webm-vp9': ['-c:a', 'libopus', '-b:a', '160k'],
  'greenscreen-mp4': ['-c:a', 'aac', '-b:a', '192k'],
};

/** 每个预设的音频编码器（5.6）；PNG 序列的音频是另存的 WAV，不经 FFmpeg 编码 */
export const PRESET_AUDIO_ENCODER: Record<ExportPreset, string | null> = {
  prores4444: 'pcm_s16le',
  'png-sequence': null,
  'webm-vp9': 'libopus',
  'greenscreen-mp4': 'aac',
};

export function ffmpegArgs(spec: FfmpegJobSpec): string[] {
  const audio = spec.preset === 'png-sequence' ? null : (spec.audio ?? null);
  const args = inputArgs(spec.width, spec.height, spec.fps, audio);
  const meta = spec.cutFrame === null ? [] : ['-metadata', `comment=cut_frame=${spec.cutFrame}`];
  const a = audio ? PRESET_AUDIO_ARGS[spec.preset] : [];
  // 输出先写到 .partial，扩展名推断不出容器，所以都显式 -f
  switch (spec.preset) {
    case 'prores4444':
      // 不设 -qscale:v（5.3）
      return [...args, '-vf', colorFilter('yuva444p10le'), '-c:v', 'prores_ks', '-profile:v', '4444', '-alpha_bits', '16', '-vendor', 'apl0', ...a, ...meta, '-f', 'mov', spec.output];
    case 'png-sequence':
      return [...args, '-c:v', 'png', '-start_number', '0', '-f', 'image2', spec.output];
    case 'webm-vp9':
      return [...args, '-vf', colorFilter('yuva420p'), '-c:v', 'libvpx-vp9', '-b:v', '0', '-crf', '24', '-row-mt', '1', '-auto-alt-ref', '0', ...a, ...meta, '-f', 'webm', spec.output];
    case 'greenscreen-mp4': {
      const encoder = spec.h264Encoder;
      if (!encoder) throw new Error('greenscreen-mp4 needs an H.264 encoder');
      return [
        ...args,
        '-vf',
        colorFilter('yuv420p'),
        '-c:v',
        encoder,
        ...h264EncoderArgs(encoder, spec.width, spec.height, spec.fps),
        '-bsf:v',
        H264_METADATA_BSF,
        '-movflags',
        '+faststart',
        ...a,
        ...meta,
        '-f',
        'mp4',
        spec.output,
      ];
    }
  }
}

/**
 * 每个预设需要的编码器（5.6）。绿幕 MP4 的 H.264 编码器另外探测（encoder-probe.ts），这里只列固定的；
 * 音频编码器（PRESET_AUDIO_ENCODER）缺了只影响带音轨的导出：导出服务在有音轨时另外检查。
 */
export const PRESET_ENCODERS: Record<ExportPreset, string[]> = {
  prores4444: ['prores_ks'],
  'png-sequence': ['png'],
  'webm-vp9': ['libvpx-vp9'],
  'greenscreen-mp4': [],
};
