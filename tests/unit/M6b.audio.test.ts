// M6b 音频里不依赖 Web Audio 的部分：WAV 编码与校验、FFmpeg 的音频参数、cue 的数值规则、音效事件表的覆盖。
// 调度、离线混音的确定性在 test:engine（真实的 OfflineAudioContext）；T-EXP-4 在 test:export 和 e2e。
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { PRESET_AUDIO_ARGS, PRESET_AUDIO_ENCODER } from '../../apps/desktop/src/main/export/ffmpeg-args';
import { voiceParams } from '../../apps/desktop/src/renderer/audio/schedule';
import { encodeWav } from '../../apps/desktop/src/renderer/audio/wav';
import { AudioWavSchema, EXPORT_PRESETS, MAX_AUDIO_BYTES, readWavInfo } from '../../apps/desktop/src/shared/export';
import { SOUND_EVENTS } from '../../packages/assets/src/index';
import { isSoundEventId, manifestSoundEvents, MAX_PREFETCH_EVENTS, prefetchSoundEvents } from '../../apps/desktop/src/shared/template-sounds';
import { templateDirs } from '../../scripts/build-templates';

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
  type Manifest = { id: string; params?: { key: string; type: string; default: unknown }[]; presets?: { key: string; name: string; params: Record<string, unknown> }[] };
  // 有 manifest 的目录才是模板：共用的 _lib 和还没实现的骨架目录不算
  const manifests = templateDirs().map((dir) => JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8')) as Manifest);
  /** 最初的六个模板：它们的默认音效就是基础表（03-assets.md 3.8）的来历 */
  const ORIGINAL = ['block-wipe', 'block-fall', 'item-stinger', 'loading-screen', 'pixel-dissolve', 'advancement-toast'].map((n) => `allay.builtin.${n}`);

  it('最初六个内置模板 sound 参数的默认值都在基础表里', () => {
    const defaults = manifests.filter((m) => ORIGINAL.includes(m.id)).flatMap((m) => (m.params ?? []).filter((p) => p.type === 'sound' && typeof p.default === 'string').map((p) => p.default as string));
    expect(defaults.length).toBeGreaterThan(0);
    for (const d of defaults) expect(SOUND_EVENTS as readonly string[]).toContain(d);
  });

  it('每个内置模板的默认音效和预设里的音效都是带命名空间的合法事件 ID，并且都在“下载时一并取回”的清单里', () => {
    const prefetch = prefetchSoundEvents(manifests as never);
    // 基础表总在清单里，排在最前面
    expect(prefetch.slice(0, SOUND_EVENTS.length)).toEqual([...SOUND_EVENTS]);
    expect(new Set(prefetch).size).toBe(prefetch.length);
    for (const m of manifests) {
      const soundKeys = new Set((m.params ?? []).filter((p) => p.type === 'sound').map((p) => p.key));
      const values = [
        ...(m.params ?? []).filter((p) => p.type === 'sound').map((p) => ({ where: `${m.id} ${p.key}`, value: p.default })),
        ...(m.presets ?? []).flatMap((preset) => Object.entries(preset.params).filter(([k]) => soundKeys.has(k)).map(([k, value]) => ({ where: `${m.id} preset ${preset.key} ${k}`, value }))),
      ];
      for (const { where, value } of values) {
        if (value === null) continue; // “无”
        expect(isSoundEventId(value), `${where}: ${String(value)}`).toBe(true);
        expect(prefetch, where).toContain(value);
      }
    }
  });

  it('从 manifest 里取音效：默认值和预设里的值，跳过“无”和不合法的，去重；用不着的参数不算', () => {
    const m = {
      params: [
        { key: 'openSound', type: 'sound', label: 'a', default: 'minecraft:block.chest.open' },
        { key: 'closeSound', type: 'sound', label: 'b', default: null },
        { key: 'title', type: 'text', label: 'c', default: 'minecraft:not.a.sound' },
      ],
      presets: [
        { key: 'ender', name: 'Ender', params: { openSound: 'minecraft:block.ender_chest.open', closeSound: 'minecraft:block.ender_chest.close', title: 'minecraft:ignored' } },
        { key: 'same', name: 'Same', params: { openSound: 'minecraft:block.chest.open', closeSound: null } },
        { key: 'bad', name: 'Bad', params: { openSound: 'No Namespace', closeSound: 42 } },
      ],
    };
    expect(manifestSoundEvents(m as never)).toEqual(['minecraft:block.chest.open', 'minecraft:block.ender_chest.open', 'minecraft:block.ender_chest.close']);
    expect(prefetchSoundEvents([m as never, m as never])).toEqual([...SOUND_EVENTS, 'minecraft:block.chest.open', 'minecraft:block.ender_chest.open', 'minecraft:block.ender_chest.close']);
    expect(prefetchSoundEvents([])).toEqual([...SOUND_EVENTS]);
  });

  it('事件 ID 的格式', () => {
    for (const ok of ['minecraft:block.stone.place', 'allay:whoosh', 'my_pack:music/boss-1']) expect(isSoundEventId(ok), ok).toBe(true);
    for (const bad of ['block.stone.place', 'Minecraft:Block.Stone', 'minecraft:', ':x', 'minecraft:a b', '', null, 7, `minecraft:${'x'.repeat(300)}`]) expect(isSoundEventId(bad), String(bad)).toBe(false);
  });

  it('一份坏掉的 manifest 不能让下载去取上千个事件', () => {
    const many = { params: Array.from({ length: MAX_PREFETCH_EVENTS + 50 }, (_, i) => ({ key: `s${i}`, type: 'sound', label: 'x', default: `minecraft:fake.${i}` })) };
    expect(prefetchSoundEvents([many as never])).toHaveLength(SOUND_EVENTS.length + MAX_PREFETCH_EVENTS);
  });
});
