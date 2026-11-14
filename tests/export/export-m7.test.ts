// M7 的导出验收测试（docs/05-export.md 5.10）：透明 WebM（③）和绿幕 MP4（④）的 T-EXP-1、T-EXP-3、T-EXP-5、T-EXP-6，
// T-EXP-8（自定义分辨率修正为偶数后 ④ 导出成功）、T-EXP-9（编码器探测跳过必然失败的候选），以及重名不覆盖；
// 合并 M6b 后加上 T-EXP-4 ③④（带音轨的封装、重名、取消与失败的清理）。
// 直接驱动主进程的导出任务和编码器探测，用 pnpm ffmpeg:fetch 取回的固定 LGPL 构建。
// ①② 的同名测试在 export.test.ts；T-EXP-7（端到端）和六个内置模板的导出在 tests/e2e/export.spec.ts。
import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { probeH264 } from '../../apps/desktop/src/main/export/encoder-probe';
import { ExportJob, ExportJobError, uniquePath, type ExportJobOptions } from '../../apps/desktop/src/main/export/export-job';
import { probeCaps, probeFfmpeg } from '../../apps/desktop/src/main/export/ffmpeg-locate';
import { H264_ENCODERS, evenDimension, type ExportErrorCode, type H264Probe } from '../../apps/desktop/src/shared/export';
import { frameCount } from '../../packages/engine/src/frames';
import { encodeWav } from '../../apps/desktop/src/renderer/audio/wav';
import { BARS, FFMPEG, FFPROBE, H, W, barsFrame, decodeFrame, processAlive, removeDir, tempDir } from './ffmpeg';

let dir: string;
beforeEach(() => {
  dir = tempDir();
});
afterEach(() => removeDir(dir));

/** 这台机器上真实试编码成功的 H.264 编码器（全部候选都试，不在第一个成功处停下），记进测试报告 */
let working: string[] = [];
let fullProbe: H264Probe;
let encoder: string;
beforeAll(async () => {
  const caps = await probeCaps(FFMPEG);
  const results = [];
  for (const e of H264_ENCODERS) {
    const r = await probeH264({ ffmpeg: FFMPEG, version: caps.version!, listed: caps.encoders, candidates: [e] });
    results.push(r.attempts[0]!);
  }
  fullProbe = { ffmpegVersion: caps.version!, encoder: null, attempts: results, probedAt: new Date().toISOString() };
  working = results.filter((a) => a.result === 'ok').map((a) => a.encoder);
  const chosen = await probeH264({ ffmpeg: FFMPEG, version: caps.version!, listed: caps.encoders });
  encoder = chosen.encoder!;
}, 120_000);

function job(over: Partial<ExportJobOptions>): ExportJob {
  return new ExportJob({ ffmpeg: FFMPEG, preset: 'webm-vp9', width: W, height: H, fps: 30, totalFrames: 10, cutFrame: null, target: join(dir, 'out.webm'), h264Encoder: encoder, ...over });
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

/** 任意尺寸的八色块画面（色块等宽） */
function bars(width: number, height: number): Uint8Array {
  const f = new Uint8Array(width * height * 4);
  const bw = width / BARS.length;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) f.set(BARS[Math.floor(x / bw)]!, (y * width + x) * 4);
  return f;
}

/** 色块内部（离边界 margin 像素以上，4:2:0 的色度在边界上会糊）的最大误差；opaqueOnly 时只看不透明的色块 */
function barErrors(decoded: Uint8Array, margin: number, opaqueOnly: boolean, width = W, height = H): { color: number; alpha: number } {
  let color = 0;
  let alpha = 0;
  const bw = width / BARS.length;
  for (let y = margin; y < height - margin; y++) {
    for (let x = 0; x < width; x++) {
      const k = Math.floor(x / bw);
      const inBar = x - k * bw;
      if (inBar < margin || inBar > bw - 1 - margin) continue;
      const exp = BARS[k]!;
      if (opaqueOnly && exp[3] !== 255) continue;
      const o = (y * width + x) * 4;
      if (!opaqueOnly) alpha = Math.max(alpha, Math.abs(decoded[o + 3]! - exp[3]));
      if (exp[3] === 0) continue;
      for (let c = 0; c < 3; c++) color = Math.max(color, Math.abs(decoded[o + c]! - exp[c]!));
    }
  }
  return { color, alpha };
}

/** ffprobe：视频流的属性和容器的标签（标签名不分大小写，Matroska 里是 COMMENT） */
function probe(path: string): Record<string, string> {
  const r = spawnSync(
    FFPROBE,
    ['-v', 'error', '-select_streams', 'v:0', '-count_frames', '-show_entries', 'stream=codec_name,pix_fmt,width,height,color_range,color_space,color_transfer,color_primaries,r_frame_rate,avg_frame_rate,nb_read_frames:stream_tags=alpha_mode:format_tags', '-of', 'default=nw=1', path],
    { encoding: 'utf8', windowsHide: true },
  );
  if (r.status !== 0) throw new Error(`ffprobe failed: ${r.stderr}`);
  const out: Record<string, string> = {};
  for (const line of r.stdout.split(/\r?\n/)) {
    const i = line.indexOf('=');
    if (i > 0) out[line.slice(0, i).replace(/^TAG:(.*)$/, (_m, k: string) => `TAG:${k.toLowerCase()}`)] = line.slice(i + 1);
  }
  return out;
}

describe('固定的 FFmpeg 构建（M7）', () => {
  it('四个预设都可用（绿幕 MP4 按“列表里有候选”算，真正能不能用看探测）', async () => {
    const info = await probeFfmpeg(FFMPEG);
    expect(info.presets).toEqual({ prores4444: true, 'png-sequence': true, 'webm-vp9': true, 'greenscreen-mp4': true });
  });

  // 系统编码器：Windows 的构建里要有 h264_mf，macOS 的构建里要有 h264_videotoolbox
  const systemEncoder = process.platform === 'darwin' ? 'h264_videotoolbox' : 'h264_mf';
  it(`H.264 编码器逐个实测（结果记进报告）：至少一个可用，${systemEncoder} 在列表里`, async ({ annotate }) => {
    await annotate(`H.264 trial: ${fullProbe.attempts.map((a) => `${a.encoder}=${a.result}`).join(', ')}`);
    expect(working.length).toBeGreaterThan(0);
    expect(fullProbe.attempts.find((a) => a.encoder === systemEncoder)?.result).not.toBe('unlisted');
    // 探测按 5.3 的顺序取第一个成功的
    expect(encoder).toBe(H264_ENCODERS.find((e) => working.includes(e)));
  });
});

describe('T-EXP-1 八色块编码再解码（③④）', () => {
  it('T-EXP-1 ③ WebM VP9：alpha 误差 ≤ 16、平坦区域颜色误差 ≤ 6（回读要用 libvpx-vp9 解码器）', async () => {
    const out = await encode({}, barsFrame());
    expect(out).toBe(join(dir, 'out.webm'));
    const err = barErrors(decodeFrame(out, 'rgba', 0, ['-c:v', 'libvpx-vp9']), 4, false);
    expect(err.alpha).toBeLessThanOrEqual(16);
    expect(err.color).toBeLessThanOrEqual(6);
  });

  it('T-EXP-1 ④ 绿幕 MP4：平坦区域颜色误差 ≤ 4（探测选中的编码器，以及本机其他实测可用的编码器）', async ({ annotate }) => {
    // 1080p30：码率按像素数 × 帧率缩放的编码器（h264_mf、libopenh264）在 256×144 这种小画面上只有 0.2 Mbps，测不出实际用的画质
    const width = 1920;
    const height = 1080;
    const frame = bars(width, height);
    const rows: string[] = [];
    for (const enc of [encoder, ...working.filter((e) => e !== encoder)]) {
      const out = await encode({ preset: 'greenscreen-mp4', width, height, target: join(dir, `${enc}.mp4`), h264Encoder: enc }, frame);
      const err = barErrors(decodeFrame(out, 'rgba'), 4, true, width, height);
      rows.push(`${enc}: ${err.color}`);
      expect(err.color, enc).toBeLessThanOrEqual(4);
    }
    await annotate(`④ max color error per encoder: ${rows.join(', ')}`);
  });
});

describe('T-EXP-3 ffprobe（③④）', () => {
  const duration = 0.5;
  const fps = 60;
  const total = frameCount(duration, fps);

  it('T-EXP-3 ③ 色彩标记 bt709/bt709/bt709、范围 tv、alpha_mode=1；帧数、帧率精确；剪辑点', async () => {
    const out = await encode({ fps, totalFrames: total, cutFrame: 15 }, barsFrame());
    expect(probe(out)).toMatchObject({
      codec_name: 'vp9',
      color_range: 'tv',
      color_space: 'bt709',
      color_transfer: 'bt709',
      color_primaries: 'bt709',
      r_frame_rate: '60/1',
      avg_frame_rate: '60/1',
      nb_read_frames: String(total),
      'TAG:alpha_mode': '1',
      'TAG:comment': 'cut_frame=15',
    });
  });

  it('T-EXP-3 ④ 色彩标记 bt709/bt709/bt709、范围 tv（h264_metadata 写的）；帧数、帧率精确；剪辑点', async () => {
    for (const enc of [encoder, ...working.filter((e) => e !== encoder)]) {
      const out = await encode({ preset: 'greenscreen-mp4', fps, totalFrames: total, cutFrame: 15, target: join(dir, `${enc}.mp4`), h264Encoder: enc }, barsFrame());
      expect(probe(out), enc).toMatchObject({
        codec_name: 'h264',
        pix_fmt: 'yuv420p',
        color_range: 'tv',
        color_space: 'bt709',
        color_transfer: 'bt709',
        color_primaries: 'bt709',
        r_frame_rate: '60/1',
        avg_frame_rate: '60/1',
        nb_read_frames: String(total),
        'TAG:comment': 'cut_frame=15',
      });
    }
  });
});

describe('T-EXP-5 取消（③④）', () => {
  for (const preset of ['webm-vp9', 'greenscreen-mp4'] as const) {
    it(`T-EXP-5 ${preset} 导出到一半取消：.partial 和临时文件都不存在，没有残留的 FFmpeg 进程`, async () => {
      const width = 1920;
      const height = 1080;
      const target = join(dir, preset === 'webm-vp9' ? 'half.webm' : 'half.mp4');
      const j = job({ preset, width, height, fps: 60, totalFrames: 120, target });
      await j.start();
      const pid = j.pid!;
      expect(processAlive(pid)).toBe(true);
      const frame = new Uint8Array(width * height * 4).fill(200);
      for (let i = 0; i < 30; i++) await j.writeFrame(frame);
      expect(existsSync(j.partial)).toBe(true);
      await j.cancel();
      expect(readdirSync(dir)).toEqual([]);
      expect(processAlive(pid)).toBe(false);
    });
  }
});

describe('T-EXP-6 FFmpeg 失败（③④）', () => {
  it('T-EXP-6 ③④ 不可写的路径：output-not-writable，没有残留文件', async () => {
    writeFileSync(join(dir, 'a-file'), 'x');
    await expectFailure(job({ target: join(dir, 'a-file', 'out.webm') }).start(), 'output-not-writable');
    await expectFailure(job({ preset: 'greenscreen-mp4', target: join(dir, 'a-file', 'out.mp4') }).start(), 'output-not-writable');
    expect(readdirSync(dir)).toEqual(['a-file']);
  });

  it('T-EXP-6 ④ 编码器打不开（探测之后驱动没了这类情况）：encoder-unavailable，没有残留文件和进程', async () => {
    // h264_vaapi 在 Windows 上一定打不开
    const j = job({ preset: 'greenscreen-mp4', target: join(dir, 'x.mp4'), h264Encoder: 'h264_vaapi' });
    await j.start();
    const pid = j.pid!;
    const frame = barsFrame();
    const p = (async () => {
      for (let i = 0; i < 10; i++) await j.writeFrame(frame);
      await j.finish();
    })();
    await expectFailure(p, 'encoder-unavailable');
    expect(readdirSync(dir)).toEqual([]);
    expect(processAlive(pid)).toBe(false);
  });
});

describe('T-EXP-8 自定义分辨率', () => {
  it('T-EXP-8 1001×563 被修正为 1000×562，④ 导出成功', async () => {
    const width = evenDimension(1001);
    const height = evenDimension(563);
    expect([width, height]).toEqual([1000, 562]);
    const frame = new Uint8Array(width * height * 4);
    for (let i = 0; i < frame.length; i += 4) frame.set([0, 255, 0, 255], i);
    const out = await encode({ preset: 'greenscreen-mp4', width, height, fps: 60, totalFrames: 10, target: join(dir, 'odd.mp4') }, frame);
    expect(probe(out)).toMatchObject({ codec_name: 'h264', width: '1000', height: '562', nb_read_frames: '10' });
    // 纯绿读回仍是纯绿（5.9：没有比特流滤镜时 h264_mf 会读成 (19,255,8)）
    const px = decodeFrame(out, 'rgba');
    const mid = (281 * 1000 + 500) * 4;
    expect(Math.abs(px[mid]! - 0)).toBeLessThanOrEqual(4);
    expect(Math.abs(px[mid + 1]! - 255)).toBeLessThanOrEqual(4);
    expect(Math.abs(px[mid + 2]! - 0)).toBeLessThanOrEqual(4);
  });
});

describe('T-EXP-9 编码器探测', () => {
  it('T-EXP-9 候选里混入必然失败的：跳过它，选中下一个可用的；不在列表里的不试', async () => {
    const caps = await probeCaps(FFMPEG);
    const next = working[0]!;
    // allay_bogus 不在 -encoders 里；h264_vaapi 在 Windows 的构建的列表里但一定失败（macOS 的构建里没有，同样放进伪造的列表）；
    // 伪造一个列表让 allay_forced 也被真的试一次
    const listed = new Set([...caps.encoders, 'allay_forced', 'h264_vaapi']);
    const result = await probeH264({ ffmpeg: FFMPEG, version: caps.version!, listed, candidates: ['allay_bogus', 'h264_vaapi', 'allay_forced', next, 'h264_mf'] });
    expect(result.encoder).toBe(next);
    expect(result.attempts.map((a) => [a.encoder, a.result])).toEqual([
      ['allay_bogus', 'unlisted'],
      ['h264_vaapi', 'failed'],
      ['allay_forced', 'failed'],
      [next, 'ok'],
    ]);
    expect(result.attempts[1]!.detail).toBeTruthy();
    expect(result.ffmpegVersion).toBe(caps.version);
  });

  it('T-EXP-9 全部失败：没有胜出的编码器', async () => {
    const caps = await probeCaps(FFMPEG);
    const result = await probeH264({ ffmpeg: FFMPEG, version: caps.version!, listed: caps.encoders, candidates: ['h264_vaapi', 'h264_vulkan_bogus'] });
    expect(result.encoder).toBeNull();
    expect(result.attempts.map((a) => a.result)).toEqual(['failed', 'unlisted']);
  });
});

describe('文件命名（5.2）', () => {
  it('重名不覆盖：加 “ (2)”、“ (3)”；PNG 目录同样；进行中的 .partial 也算占用', async () => {
    writeFileSync(join(dir, 'a.mov'), 'x');
    expect(await uniquePath(join(dir, 'a.mov'))).toBe(join(dir, 'a (2).mov'));
    writeFileSync(join(dir, 'a (2).mov.partial'), 'x');
    expect(await uniquePath(join(dir, 'a.mov'))).toBe(join(dir, 'a (3).mov'));
    mkdirSync(join(dir, 'seq_1.5x'));
    expect(await uniquePath(join(dir, 'seq_1.5x'))).toBe(join(dir, 'seq_1.5x (2)'));
    expect(await uniquePath(join(dir, 'new.webm'))).toBe(join(dir, 'new.webm'));
  });

  it('封装完成时目标已经被别人占了：改名到 “ (2)”，原文件不动', async () => {
    const j = job({ totalFrames: 2, target: join(dir, 'taken.webm') });
    await j.start();
    writeFileSync(join(dir, 'taken.webm'), 'someone else');
    await j.writeFrame(barsFrame());
    await j.writeFrame(barsFrame());
    expect(await j.finish()).toBe(join(dir, 'taken (2).webm'));
    expect(readdirSync(dir).sort()).toEqual(['taken (2).webm', 'taken.webm']);
  });
});

// ---- T-EXP-4 ③④ 音轨（M6b × M7，5.5）。WAV 是脚本生成的正弦波（测试数据），用和渲染进程同一个编码函数 ----

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

/** 所有流的类型、编码、采样率、声道、时长（容器里没有流时长时用格式时长） */
function audioStreams(path: string): { video: Record<string, string | number>; audio: Record<string, string | number>[]; format: number } {
  const r = spawnSync(FFPROBE, ['-v', 'error', '-show_entries', 'stream=codec_type,codec_name,sample_rate,channels,duration:format=duration', '-of', 'json', path], { encoding: 'utf8', windowsHide: true });
  if (r.status !== 0) throw new Error(`ffprobe failed: ${r.stderr}`);
  const j = JSON.parse(r.stdout) as { streams: Record<string, string | number>[]; format: { duration: string } };
  return { video: j.streams.find((s) => s.codec_type === 'video')!, audio: j.streams.filter((s) => s.codec_type === 'audio'), format: Number(j.format.duration) };
}

/** 一条流的时长：WebM 的流上没有 duration，用 -count_packets 也拿不到，退回逐包累加 */
function streamSeconds(path: string, select: 'v:0' | 'a:0'): number {
  const r = spawnSync(FFPROBE, ['-v', 'error', '-select_streams', select, '-show_entries', 'packet=pts_time,duration_time', '-of', 'csv=p=0', path], { encoding: 'utf8', windowsHide: true });
  if (r.status !== 0) throw new Error(`ffprobe failed: ${r.stderr}`);
  let end = 0;
  for (const line of r.stdout.split(/\r?\n/)) {
    const [pts, dur] = line.split(',').map(Number);
    if (Number.isFinite(pts) && Number.isFinite(dur)) end = Math.max(end, pts! + dur!);
  }
  return end;
}

describe('T-EXP-4 音轨（③ WebM、④ 绿幕 MP4）', () => {
  const FPS = 30;
  const FRAMES = 45;
  const cases = [
    { preset: 'webm-vp9', ext: 'webm', codec: 'opus' },
    { preset: 'greenscreen-mp4', ext: 'mp4', codec: 'aac' },
  ] as const;

  for (const c of cases) {
    it(`T-EXP-4 ${c.preset} 有 cue：存在 48 kHz 立体声 ${c.codec} 音轨，时长与视频相差不到 1 帧；没有 cue：没有音轨；临时 WAV 不留下`, async () => {
      const temp = join(dir, 'tmp');
      mkdirSync(temp);
      const j = job({ preset: c.preset, fps: FPS, totalFrames: FRAMES, audio: true, tempDir: temp, target: join(dir, `with.${c.ext}`) });
      await j.start();
      expect(j.pid).toBeUndefined();
      await j.writeAudio(sineWav(FRAMES, FPS));
      for (let i = 0; i < FRAMES; i++) await j.writeFrame(barsFrame());
      const out = await j.finish();
      const s = audioStreams(out);
      expect(s.audio).toHaveLength(1);
      expect(s.audio[0]).toMatchObject({ codec_name: c.codec, sample_rate: '48000', channels: 2 });
      const video = streamSeconds(out, 'v:0');
      const audio = streamSeconds(out, 'a:0');
      expect(video).toBeCloseTo(FRAMES / FPS, 2);
      expect(Math.abs(audio - video), `audio ${audio} vs video ${video}`).toBeLessThan(1 / FPS);
      expect(readdirSync(temp)).toEqual([]);

      const plain = await encode({ preset: c.preset, fps: FPS, totalFrames: FRAMES, target: join(dir, `without.${c.ext}`) }, barsFrame());
      expect(audioStreams(plain).audio).toEqual([]);
    });
  }

  it('T-EXP-4 带音轨时重名同样加 “ (2)”：视频文件和 PNG 序列目录（目录里的 WAV 跟着走）', async () => {
    const temp = join(dir, 'tmp');
    mkdirSync(temp);
    writeFileSync(join(dir, 'clip.webm'), 'taken');
    const target = await uniquePath(join(dir, 'clip.webm'));
    const j = job({ fps: FPS, totalFrames: 5, audio: true, tempDir: temp, target });
    await j.start();
    await j.writeAudio(sineWav(5, FPS));
    for (let i = 0; i < 5; i++) await j.writeFrame(barsFrame());
    expect(await j.finish()).toBe(join(dir, 'clip (2).webm'));
    expect(readdirSync(temp)).toEqual([]);

    mkdirSync(join(dir, 'seq'));
    const seqTarget = await uniquePath(join(dir, 'seq'));
    const p = job({ preset: 'png-sequence', fps: FPS, totalFrames: 5, audio: true, target: seqTarget });
    await p.start();
    await p.writeAudio(sineWav(5, FPS));
    for (let i = 0; i < 5; i++) await p.writeFrame(barsFrame());
    const final = await p.finish();
    expect(final).toBe(join(dir, 'seq (2)'));
    expect(readdirSync(final)).toContain('seq (2).wav');
    expect(readdirSync(join(dir, 'seq'))).toEqual([]);
  });

  it('T-EXP-4 带音轨时取消、失败：.partial 和临时 WAV 都不留下，没有残留的 FFmpeg 进程', async () => {
    const temp = join(dir, 'tmp');
    mkdirSync(temp);
    const j = job({ preset: 'greenscreen-mp4', fps: FPS, totalFrames: 60, audio: true, tempDir: temp, target: join(dir, 'half.mp4') });
    await j.start();
    await j.writeAudio(sineWav(60, FPS));
    const pid = j.pid!;
    expect(readdirSync(temp)).toHaveLength(1);
    for (let i = 0; i < 10; i++) await j.writeFrame(barsFrame());
    await j.cancel();
    expect(processAlive(pid)).toBe(false);
    expect(readdirSync(temp)).toEqual([]);
    expect(readdirSync(dir)).toEqual(['tmp']);

    // 帧数不足就封装：frame-mismatch，同样不留
    const k = job({ fps: FPS, totalFrames: 10, audio: true, tempDir: temp, target: join(dir, 'short.webm') });
    await k.start();
    await k.writeAudio(sineWav(10, FPS));
    await k.writeFrame(barsFrame());
    await expectFailure(k.finish(), 'frame-mismatch');
    expect(readdirSync(temp)).toEqual([]);
    expect(readdirSync(dir)).toEqual(['tmp']);
  });
});
