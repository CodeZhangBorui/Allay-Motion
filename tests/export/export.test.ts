// 导出的验收测试（docs/05-export.md 5.10）：M1 范围是 T-EXP-1（①②）、T-EXP-2、T-EXP-3（①）、T-EXP-5、T-EXP-6；M6b 加上 T-EXP-4（①②）。
// 直接驱动主进程的导出任务（apps/desktop/src/main/export/export-job.ts），用 pnpm ffmpeg:fetch 取回的固定 LGPL 构建。
// T-EXP-7（端到端）在 tests/e2e/export.spec.ts。
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import en from '../../apps/desktop/src/renderer/i18n/locales/en.json';
import zhCN from '../../apps/desktop/src/renderer/i18n/locales/zh-CN.json';
import { ExportJob, ExportJobError, classifyFfmpegError, type ExportJobOptions } from '../../apps/desktop/src/main/export/export-job';
import { parseEncoders, probeFfmpeg } from '../../apps/desktop/src/main/export/ffmpeg-locate';
import { EXPORT_ERROR_CODES, readWavInfo, type ExportErrorCode } from '../../apps/desktop/src/shared/export';
import { encodeWav } from '../../apps/desktop/src/renderer/audio/wav';
import { frameCount } from '../../packages/engine/src/frames';
import { BARS, BAR_W, FFMPEG, FFPROBE, H, W, barsFrame, decodeAllRgba, decodeFrame, probe, processAlive, removeDir, tempDir } from './ffmpeg';

let dir: string;
beforeEach(() => {
  dir = tempDir();
});
afterEach(() => removeDir(dir));

function job(over: Partial<ExportJobOptions>): ExportJob {
  return new ExportJob({ ffmpeg: FFMPEG, preset: 'prores4444', width: W, height: H, fps: 30, totalFrames: 10, cutFrame: null, target: join(dir, 'out.mov'), ...over });
}

async function encode(over: Partial<ExportJobOptions>, frame: Uint8Array): Promise<string> {
  const j = job(over);
  await j.start();
  const total = over.totalFrames ?? 10;
  for (let i = 0; i < total; i++) await j.writeFrame(frame);
  return j.finish();
}

async function expectFailure(p: Promise<unknown>, code: ExportErrorCode): Promise<void> {
  const error = await p.then(
    () => null,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(ExportJobError);
  expect((error as ExportJobError).failure.code).toBe(code);
}

/** 每个色块内部（离边界 2 像素以上）的最大通道误差；alpha 为 0 的色块只比 alpha */
function barErrors(decoded: Uint8Array): { color: number; alpha: number } {
  let color = 0;
  let alpha = 0;
  for (let y = 2; y < H - 2; y++) {
    for (let x = 0; x < W; x++) {
      const k = Math.floor(x / BAR_W);
      const inBar = x % BAR_W;
      if (inBar < 2 || inBar > BAR_W - 3) continue;
      const exp = BARS[k]!;
      const o = (y * W + x) * 4;
      alpha = Math.max(alpha, Math.abs(decoded[o + 3]! - exp[3]));
      if (exp[3] === 0) continue;
      for (let c = 0; c < 3; c++) color = Math.max(color, Math.abs(decoded[o + c]! - exp[c]!));
    }
  }
  return { color, alpha };
}

describe('固定的 FFmpeg 构建', () => {
  it('有 M1 两个预设需要的编码器，以及之后要用的编码器（5.6）', async () => {
    const info = await probeFfmpeg(FFMPEG);
    expect(info.available).toBe(true);
    expect(info.version).toMatch(/^ffmpeg version n9\.0/);
    expect(info.presets).toEqual({ prores4444: true, 'png-sequence': true, 'webm-vp9': true, 'greenscreen-mp4': true });
  });
  it('parseEncoders 认得 -encoders 的输出', () => {
    const text = ' Encoders:\n V..... = Video\n ------\n VFS... prores_ks            Apple ProRes\n VF...D png                  PNG\n A....D aac                  AAC\n';
    expect([...parseEncoders(text)]).toEqual(['prores_ks', 'png', 'aac']);
  });
});

describe('T-EXP-1 八色块编码再解码', () => {
  it('T-EXP-1 ① ProRes 4444：颜色误差 ≤ 4、alpha 误差 ≤ 1', async () => {
    const out = await encode({}, barsFrame());
    const err = barErrors(decodeFrame(out, 'rgba'));
    expect(err.color).toBeLessThanOrEqual(4);
    expect(err.alpha).toBeLessThanOrEqual(1);
  });

  it('T-EXP-1 ② PNG 序列：完全无损（误差 0），帧从 0 开始编号', async () => {
    const frame = barsFrame();
    const out = await encode({ preset: 'png-sequence', target: join(dir, 'seq') }, frame);
    expect(out).toBe(join(dir, 'seq'));
    const files = readdirSync(out).sort();
    expect(files).toHaveLength(10);
    expect(files[0]).toBe('seq_00000.png');
    expect(files[9]).toBe('seq_00009.png');
    const decoded = decodeFrame(join(out, files[0]!), 'rgba');
    expect(Buffer.compare(decoded, Buffer.from(frame))).toBe(0);
  });

  it('PNG 序列的目录重名时加 “ (2)”', async () => {
    mkdirSync(join(dir, 'seq'));
    const out = await encode({ preset: 'png-sequence', target: join(dir, 'seq'), totalFrames: 1 }, barsFrame());
    expect(out).toBe(join(dir, 'seq (2)'));
  });
});

describe('T-EXP-2 BT.709 矩阵', () => {
  it('T-EXP-2 ① 的输出解成 yuva444p10le，纯红色块的 Y 为 250 ± 2（BT.601 会是 326）', async () => {
    const out = await encode({}, barsFrame());
    const raw = decodeFrame(out, 'yuva444p10le');
    const plane = W * H * 2;
    expect(raw.length).toBe(plane * 4);
    const at = (p: number, x: number, y: number) => raw.readUInt16LE(p * plane + (y * W + x) * 2);
    const y = at(0, 16, 72);
    expect(Math.abs(y - 250)).toBeLessThanOrEqual(2);
    // Cb/Cr 也与 BT.709 有限范围的理论值一致（409/960），50% alpha 存成 514/1023 左右
    expect(Math.abs(at(1, 16, 72) - 409)).toBeLessThanOrEqual(2);
    expect(Math.abs(at(2, 16, 72) - 960)).toBeLessThanOrEqual(2);
    expect(Math.abs(at(3, 5 * BAR_W + 16, 72) - 514)).toBeLessThanOrEqual(2);
  });
});

describe('T-EXP-3 ffprobe', () => {
  it('T-EXP-3 ① 色彩标记 bt709/bt709/bt709、范围 tv；帧数等于 frameCount(duration, fps)；帧率精确', async () => {
    const duration = 0.5;
    const fps = 60;
    const total = frameCount(duration, fps);
    expect(total).toBe(31);
    const out = await encode({ fps, totalFrames: total, cutFrame: 15 }, barsFrame());
    const info = probe(out, 'stream=codec_name,profile,pix_fmt,color_range,color_space,color_transfer,color_primaries,r_frame_rate,avg_frame_rate,nb_read_frames:format_tags=comment');
    expect(info).toMatchObject({
      codec_name: 'prores',
      pix_fmt: 'yuva444p12le',
      color_range: 'tv',
      color_space: 'bt709',
      color_transfer: 'bt709',
      color_primaries: 'bt709',
      r_frame_rate: '60/1',
      avg_frame_rate: '60/1',
      nb_read_frames: String(total),
      'TAG:comment': 'cut_frame=15',
    });
    expect(info.profile).toMatch(/4444/);
  });

  it('frameCount：首帧在 0、末帧在 duration，两端都渲染', () => {
    expect(frameCount(1.1, 60)).toBe(67);
    expect(frameCount(1, 60)).toBe(61);
    expect(frameCount(0.1, 24)).toBe(4);
  });
});

describe('T-EXP-5 取消', () => {
  for (const preset of ['prores4444', 'png-sequence'] as const) {
    it(`T-EXP-5 ${preset} 导出到一半取消：.partial 和临时文件都不存在，没有残留的 FFmpeg 进程`, async () => {
      const width = 1920;
      const height = 1080;
      const target = preset === 'prores4444' ? join(dir, 'half.mov') : join(dir, 'half');
      const j = job({ preset, width, height, fps: 60, totalFrames: 120, target });
      await j.start();
      const pid = j.pid!;
      expect(processAlive(pid)).toBe(true);
      const frame = new Uint8Array(width * height * 4).fill(200);
      for (let i = 0; i < 60; i++) await j.writeFrame(frame);
      expect(existsSync(j.partial)).toBe(true);
      await j.cancel();
      expect(existsSync(j.partial)).toBe(false);
      expect(existsSync(target)).toBe(false);
      expect(readdirSync(dir)).toEqual([]);
      expect(processAlive(pid)).toBe(false);
      // 取消之后再写会被拒绝，重复取消没有副作用
      await expect(j.writeFrame(frame)).rejects.toThrow();
      await j.cancel();
    });
  }
});

describe('T-EXP-6 FFmpeg 失败', () => {
  it('T-EXP-6 不可写的路径：output-not-writable，没有残留文件', async () => {
    writeFileSync(join(dir, 'a-file'), 'x');
    const target = join(dir, 'a-file', 'out.mov');
    const j = job({ target });
    await expectFailure(j.start(), 'output-not-writable');
    expect(readdirSync(dir)).toEqual(['a-file']);
  });

  it('T-EXP-6 伪造的坏二进制：ffmpeg-missing，没有残留文件', async () => {
    const fake = join(dir, 'bin');
    mkdirSync(fake);
    const bad = join(fake, process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg');
    writeFileSync(bad, Buffer.from('this is not an executable\n'.repeat(100)));
    const out = join(dir, 'out');
    mkdirSync(out);
    const j = job({ ffmpeg: bad, target: join(out, 'out.mov') });
    await expectFailure(j.start(), 'ffmpeg-missing');
    expect(readdirSync(out)).toEqual([]);
  });

  it('T-EXP-6 不存在的二进制：ffmpeg-missing，没有残留文件', async () => {
    const j = job({ ffmpeg: join(dir, 'nope', 'ffmpeg.exe') });
    await expectFailure(j.start(), 'ffmpeg-missing');
    expect(readdirSync(dir)).toEqual([]);
  });

  it('T-EXP-6 FFmpeg 在导出中途出错退出：给出错误码，没有残留文件、没有残留进程', async () => {
    // 声明 64×64，却按 W×H 写：第一帧就被判为与设置不符
    const j = job({ width: 64, height: 64 });
    await j.start();
    const pid = j.pid!;
    await expectFailure(j.writeFrame(barsFrame()), 'frame-mismatch');
    expect(readdirSync(dir)).toEqual([]);
    expect(processAlive(pid)).toBe(false);
  });

  it('T-EXP-6 帧数不足就封装：frame-mismatch，没有残留文件', async () => {
    const j = job({ totalFrames: 5 });
    await j.start();
    await j.writeFrame(barsFrame());
    await expectFailure(j.finish(), 'frame-mismatch');
    expect(readdirSync(dir)).toEqual([]);
  });

  it('stderr 的分类（5.7）', () => {
    expect(classifyFfmpegError('Error writing trailer: No space left on device')).toBe('disk-full');
    expect(classifyFfmpegError('Unknown encoder \'prores_ks\'')).toBe('encoder-unavailable');
    expect(classifyFfmpegError('C:/x/out.mov.partial: Permission denied')).toBe('output-not-writable');
    expect(classifyFfmpegError('something else')).toBe('ffmpeg-failed');
  });

  it('T-EXP-6 每个错误码在两种语言里都有对应文案', () => {
    const keyOf: Record<ExportErrorCode, string> = {
      'ffmpeg-missing': 'ffmpegMissing',
      'output-not-writable': 'outputNotWritable',
      'disk-full': 'diskFull',
      'encoder-unavailable': 'encoderUnavailable',
      'ffmpeg-failed': 'ffmpegFailed',
      'frame-mismatch': 'frameMismatch',
      'template-failed': 'templateFailed',
      'template-unresponsive': 'templateUnresponsive',
    };
    for (const code of EXPORT_ERROR_CODES) {
      const k = keyOf[code] as keyof typeof en.export.errors;
      expect(en.export.errors[k], code).toBeTruthy();
      expect(zhCN.export.errors[k], code).toBeTruthy();
    }
  });
});

describe('写入时的背压', () => {
  it('1080p 写 120 帧：每帧都在数据进了 stdin 之后才返回，输出恰为 120 帧', async () => {
    const width = 1920;
    const height = 1080;
    const target = join(dir, 'pipe.mov');
    const j = job({ width, height, fps: 60, totalFrames: 120, target });
    await j.start();
    const frame = new Uint8Array(width * height * 4);
    for (let i = 0; i < 120; i++) {
      frame.fill(i * 2, 0, width * 4 * 10);
      await j.writeFrame(frame);
    }
    await j.finish();
    let n = 0;
    await decodeAllRgba(target, width * height * 4, () => n++);
    expect(n).toBe(120);
  });
});

// ---- T-EXP-4 音轨（M6b，5.5）。WAV 是脚本生成的正弦波（测试数据），用和渲染进程同一个编码函数 ----

/** 与渲染进程 mixFrames 同一规则：样本数 = 帧数 / 帧率 × 48000 */
function sineWav(frames: number, fps: number): Uint8Array {
  const n = Math.round((frames / fps) * 48_000);
  const l = new Float32Array(n);
  const r = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    l[i] = 0.25 * Math.sin((2 * Math.PI * 440 * i) / 48_000);
    r[i] = 0.25 * Math.sin((2 * Math.PI * 660 * i) / 48_000);
  }
  return encodeWav([l, r], 48_000);
}

/** 所有流的 codec_type / codec_name / sample_rate / channels / duration */
function streams(path: string): Record<string, string>[] {
  const r = spawnSync(FFPROBE, ['-v', 'error', '-show_entries', 'stream=codec_type,codec_name,sample_rate,channels,duration', '-of', 'json', path], { encoding: 'utf8', windowsHide: true });
  if (r.status !== 0) throw new Error(`ffprobe failed: ${r.stderr}`);
  return (JSON.parse(r.stdout) as { streams: Record<string, string>[] }).streams;
}

describe('T-EXP-4 音轨', () => {
  const FPS = 30;
  const FRAMES = 45;

  it('T-EXP-4 ① 有 cue：存在 48 kHz 立体声音轨（pcm_s16le），时长与视频相差不到 1 帧；临时 WAV 不留下', async () => {
    const temp = join(dir, 'tmp');
    mkdirSync(temp);
    const j = job({ fps: FPS, totalFrames: FRAMES, audio: true, tempDir: temp, target: join(dir, 'with.mov') });
    await j.start();
    // FFmpeg 等音频交来后才启动
    expect(j.pid).toBeUndefined();
    await expect(j.writeFrame(barsFrame())).rejects.toThrow();
    await j.writeAudio(sineWav(FRAMES, FPS));
    expect(j.pid).toBeDefined();
    expect(readdirSync(temp)).toHaveLength(1);
    for (let i = 0; i < FRAMES; i++) await j.writeFrame(barsFrame());
    const out = await j.finish();
    const s = streams(out);
    const video = s.find((x) => x.codec_type === 'video')!;
    const audio = s.filter((x) => x.codec_type === 'audio');
    expect(audio).toHaveLength(1);
    expect(audio[0]).toMatchObject({ codec_name: 'pcm_s16le', sample_rate: '48000', channels: 2 });
    expect(Math.abs(Number(audio[0]!.duration) - Number(video.duration))).toBeLessThan(1 / FPS);
    expect(Number(video.duration)).toBeCloseTo(FRAMES / FPS, 3);
    expect(readdirSync(temp)).toEqual([]);
    expect(readdirSync(dir).sort()).toEqual(['tmp', 'with.mov']);
  });

  it('T-EXP-4 ① 没有 cue：没有音轨', async () => {
    const out = await encode({ fps: FPS, totalFrames: FRAMES, target: join(dir, 'without.mov') }, barsFrame());
    const s = streams(out);
    expect(s.filter((x) => x.codec_type === 'audio')).toEqual([]);
    expect(s.filter((x) => x.codec_type === 'video')).toHaveLength(1);
  });

  it('T-EXP-4 ② PNG 序列有 cue：同一目录另存 name.wav（48 kHz 立体声，时长等于视频）；没有 cue 时没有 WAV', async () => {
    const j = job({ preset: 'png-sequence', fps: FPS, totalFrames: FRAMES, audio: true, target: join(dir, 'seq') });
    await j.start();
    await j.writeAudio(sineWav(FRAMES, FPS));
    for (let i = 0; i < FRAMES; i++) await j.writeFrame(barsFrame());
    const out = await j.finish();
    const wav = new Uint8Array(readFileSync(join(out, 'seq.wav')));
    const info = readWavInfo(wav)!;
    expect(info).toMatchObject({ channels: 2, sampleRate: 48_000, bitsPerSample: 16 });
    expect(Math.abs(info.dataBytes / 4 / 48_000 - FRAMES / FPS)).toBeLessThan(1 / FPS);
    expect(readdirSync(out).filter((f) => f.endsWith('.png'))).toHaveLength(FRAMES);

    const plain = await encode({ preset: 'png-sequence', fps: FPS, totalFrames: FRAMES, target: join(dir, 'plain') }, barsFrame());
    expect(readdirSync(plain).filter((f) => !f.endsWith('.png'))).toEqual([]);
  });

  it('T-EXP-4 不合格式的音频：任务失败，不留下任何文件；取消等音频中的任务也不留文件', async () => {
    const temp = join(dir, 'tmp');
    mkdirSync(temp);
    const bad = job({ fps: FPS, totalFrames: FRAMES, audio: true, tempDir: temp, target: join(dir, 'bad.mov') });
    await bad.start();
    const mono = encodeWav([new Float32Array(48_000)], 48_000);
    await expectFailure(bad.writeAudio(mono), 'ffmpeg-failed');
    const waiting = job({ fps: FPS, totalFrames: FRAMES, audio: true, tempDir: temp, target: join(dir, 'wait.mov') });
    await waiting.start();
    await waiting.cancel();
    // 没声明音轨的任务不接受音频
    const noAudio = job({ fps: FPS, totalFrames: FRAMES, target: join(dir, 'x.mov') });
    await noAudio.start();
    await expect(noAudio.writeAudio(sineWav(FRAMES, FPS))).rejects.toThrow();
    await noAudio.cancel();
    expect(readdirSync(temp)).toEqual([]);
    expect(readdirSync(dir)).toEqual(['tmp']);
  });
});
