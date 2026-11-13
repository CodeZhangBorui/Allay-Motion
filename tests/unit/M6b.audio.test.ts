// M6b 音频里不依赖 Web Audio 的部分：WAV 编码与校验、FFmpeg 的音频参数、cue 的数值规则、音效事件表的覆盖。
// 调度、离线混音的确定性在 test:engine（真实的 OfflineAudioContext）；T-EXP-4 在 test:export 和 e2e。
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { PRESET_AUDIO_ARGS, PRESET_AUDIO_ENCODER } from '../../apps/desktop/src/main/export/ffmpeg-args';
import { voiceParams } from '../../apps/desktop/src/renderer/audio/schedule';
import { encodeWav } from '../../apps/desktop/src/renderer/audio/wav';
import { AudioWavSchema, EXPORT_PRESETS, MAX_AUDIO_BYTES, readWavInfo } from '../../apps/desktop/src/shared/export';
import { SOUND_EVENTS } from '../../packages/assets/src/index';

describe('M6b WAV', () => {
  it('encodeWav：48 kHz 立体声 16 位 PCM，样本交错、钳制、四舍五入；readWavInfo 读回格式', () => {
    const left = new Float32Array([0, 1, -1, 0.5, 2]);
    const right = new Float32Array([0, -0.5, 0.25, -2, 1e-6]);
    const wav = encodeWav([left, right], 48_000);
    expect(readWavInfo(wav)).toEqual({ channels: 2, sampleRate: 48_000, bitsPerSample: 16, dataBytes: 5 * 2 * 2 });
    const view = new DataView(wav.buffer, 44);
    const samples = Array.from({ length: 10 }, (_, i) => view.getInt16(i * 2, true));
    expect(samples).toEqual([0, 0, 32767, -16383, -32767, 8192, 16384, -32767, 32767, 0]);
    expect(AudioWavSchema.safeParse(wav).success).toBe(true);
  });

  it('readWavInfo 拒绝不是 PCM WAV 的数据；AudioWavSchema 限制大小', () => {
    expect(readWavInfo(new Uint8Array(100))).toBeNull();
    const wav = encodeWav([new Float32Array(4), new Float32Array(4)], 48_000);
    const floatFmt = wav.slice();
    new DataView(floatFmt.buffer).setUint16(20, 3, true);
    expect(readWavInfo(floatFmt)).toBeNull();
    const truncated = wav.slice(0, 46);
    expect(readWavInfo(truncated)).toBeNull();
    expect(AudioWavSchema.safeParse(new Uint8Array(MAX_AUDIO_BYTES + 1)).success).toBe(false);
  });
});

describe('M6b FFmpeg 的音频编码器（5.6）', () => {
  // 命令行本身由 M7 的 ffmpegArgs 构造（export-m7.test.ts 核对各预设有无音频）；这里核对导出服务检查的编码器表与命令行一致
  it('PRESET_AUDIO_ENCODER 与每个预设命令行里的 -c:a 一致；PNG 序列不经 FFmpeg 编码音频', () => {
    for (const preset of EXPORT_PRESETS) {
      const a = PRESET_AUDIO_ARGS[preset];
      expect(PRESET_AUDIO_ENCODER[preset], preset).toBe(a.length > 0 ? a[a.indexOf('-c:a') + 1] : null);
    }
    expect(PRESET_AUDIO_ENCODER['png-sequence']).toBeNull();
  });
});

describe('M6b cue 的数值规则', () => {
  it('变体的 volume、pitch 乘到模板给的 gain、rate 上，并钳制到 Web Audio 接受的范围', () => {
    const cue = { sound: 'x:y', at: 0, gain: 0.5, rate: 2, pan: 3, variant: { file: 'x:a', volume: 0.8, pitch: 1.5 } };
    expect(voiceParams(cue)).toEqual({ gain: 0.4, rate: 3, pan: 1 });
    expect(voiceParams({ ...cue, gain: -1, rate: 100, pan: -5, variant: null })).toEqual({ gain: 0, rate: 16, pan: -1 });
    expect(voiceParams({ ...cue, rate: 0, variant: null }).rate).toBe(1 / 16);
  });
});

describe('M6b 音效事件表', () => {
  it('内置模板 sound 参数的默认值都在事件表里（下载原版资源时一并取回的就是这张表）', () => {
    const dir = join(import.meta.dirname, '../../packages/templates');
    const defaults: string[] = [];
    for (const name of readdirSync(dir, { withFileTypes: true })) {
      if (!name.isDirectory()) continue;
      const manifest = JSON.parse(readFileSync(join(dir, name.name, 'manifest.json'), 'utf8')) as { params?: { type: string; default: unknown }[] };
      for (const p of manifest.params ?? []) if (p.type === 'sound' && typeof p.default === 'string') defaults.push(p.default);
    }
    expect(defaults.length).toBeGreaterThan(0);
    for (const d of defaults) expect(SOUND_EVENTS as readonly string[]).toContain(d);
  });
});
