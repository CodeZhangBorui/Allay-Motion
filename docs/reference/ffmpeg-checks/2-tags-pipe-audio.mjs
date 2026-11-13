import { spawn, spawnSync } from 'node:child_process';
import { writeFileSync, readFileSync, mkdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { once } from 'node:events';

const dir = join(dirname(fileURLToPath(import.meta.url)), 'out2');
mkdirSync(dir, { recursive: true });
const probe = (p, entries) => spawnSync('ffprobe', ['-v', 'error', '-show_entries', entries, '-of', 'default=nw=1', p], { encoding: 'utf8' }).stdout.trim().replace(/\r?\n/g, '; ');
const ff = (args, label) => { const r = spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...args], { encoding: 'utf8' }); if (r.status !== 0) console.log(`  [FAIL ${label}] ${(r.stderr || '').trim().split('\n').slice(-2).join(' | ')}`); return r.status === 0; };

// 1. colour tags on ProRes via setparams
{
  const W = 256, H = 144; const f = Buffer.alloc(W * H * 4, 255); const inP = join(dir, 's.rgba'); writeFileSync(inP, Buffer.concat([f, f, f]));
  const IN = ['-f', 'rawvideo', '-pixel_format', 'rgba', '-video_size', `${W}x${H}`, '-framerate', '60', '-i', inP];
  const out = join(dir, 'tags.mov');
  ff([...IN, '-vf', 'scale=out_color_matrix=bt709:out_range=limited,format=yuva444p10le,setparams=color_primaries=bt709:color_trc=bt709:colorspace=bt709',
    '-c:v', 'prores_ks', '-profile:v', '4444', '-alpha_bits', '16', '-vendor', 'apl0', out], 'tags');
  console.log('1. ProRes tags with setparams: ' + probe(out, 'stream=color_range,color_space,color_transfer,color_primaries'));
}

// 2. h264_mf / nvenc with h264_metadata bsf
{
  const W = 1280, H = 720; const big = Buffer.alloc(W * H * 4); for (let i = 0; i < W * H; i++) big.set([0, 255, 0, 255], i * 4);
  const inP = join(dir, 'g.rgba'); writeFileSync(inP, Buffer.concat(Array.from({ length: 15 }, () => big)));
  const IN = ['-f', 'rawvideo', '-pixel_format', 'rgba', '-video_size', `${W}x${H}`, '-framerate', '30', '-i', inP];
  for (const [enc, extra] of [['h264_mf', ['-b:v', '20M']], ['h264_nvenc', ['-rc', 'vbr', '-cq', '18', '-b:v', '0']], ['h264_qsv', ['-global_quality', '18']]]) {
    const out = join(dir, `m_${enc}.mp4`);
    const ok = ff([...IN, '-vf', 'scale=out_color_matrix=bt709:out_range=limited,format=yuv420p,setparams=color_primaries=bt709:color_trc=bt709:colorspace=bt709',
      '-c:v', enc, ...extra, '-bsf:v', 'h264_metadata=colour_primaries=1:transfer_characteristics=1:matrix_coefficients=1:video_full_range_flag=0', '-movflags', '+faststart', out], enc);
    if (!ok) continue;
    const raw = join(dir, `m_${enc}.rgba`); ff(['-i', out, '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgba', raw], 'dec');
    const b = readFileSync(raw); const o = (360 * W + 640) * 4;
    console.log(`2. ${enc} + h264_metadata: centre=${[...b.subarray(o, o + 4)].join(',')}  ${probe(out, 'stream=color_range,color_space,color_transfer,color_primaries')}`);
  }
}

// 3 & 5. piped stdin with backpressure, 1080p and 4K, ProRes 4444
async function pipeTest(W, H, frames, fps, label) {
  const out = join(dir, `${label}.mov`);
  const base = Buffer.alloc(W * H * 4);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {       // blocky pattern with partial alpha, cheap to compress like our content
    const bx = Math.floor(x / 120), by = Math.floor(y / 120); const o = (y * W + x) * 4; const on = (bx + by) % 3 !== 0;
    base[o] = on ? (40 + ((x * 7 + y * 3) & 63)) : 0; base[o + 1] = on ? (150 + ((x ^ y) & 63)) : 0; base[o + 2] = on ? 230 : 0; base[o + 3] = on ? 255 : 0;
  }
  const p = spawn('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'rawvideo', '-pixel_format', 'rgba', '-video_size', `${W}x${H}`, '-framerate', String(fps), '-i', 'pipe:0',
    '-vf', 'scale=out_color_matrix=bt709:out_range=limited,format=yuva444p10le,setparams=color_primaries=bt709:color_trc=bt709:colorspace=bt709',
    '-c:v', 'prores_ks', '-profile:v', '4444', '-alpha_bits', '16', '-vendor', 'apl0', out], { stdio: ['pipe', 'inherit', 'inherit'] });
  const t0 = performance.now(); let drains = 0;
  for (let i = 0; i < frames; i++) {
    const f = Buffer.from(base); const off = ((i * 16) % (W - 200)); for (let y = 100; y < 300; y++) f.fill(255, (y * W + off) * 4, (y * W + off + 200) * 4);
    if (!p.stdin.write(f)) { drains++; await once(p.stdin, 'drain'); }
  }
  p.stdin.end(); const [code] = await once(p, 'close'); const sec = (performance.now() - t0) / 1000;
  console.log(`3. pipe ${label} ${W}x${H}: exit=${code} ${frames} frames in ${sec.toFixed(2)}s = ${(frames / sec).toFixed(1)} fps, drains=${drains}, size=${(statSync(out).size / 1e6).toFixed(1)} MB; ${probe(out, 'stream=nb_frames,duration,r_frame_rate')}`);
  return out;
}
const mov = await pipeTest(1920, 1080, 120, 60, 'p1080');
await pipeTest(3840, 2160, 30, 60, 'p2160');

// 4. audio mux: 2 s stereo 48k s16 WAV
{
  const sr = 48000, n = sr * 2; const pcm = Buffer.alloc(n * 4);
  for (let i = 0; i < n; i++) { const v = Math.round(Math.sin(2 * Math.PI * 440 * i / sr) * 8000 * Math.exp(-i / sr * 3)); pcm.writeInt16LE(v, i * 4); pcm.writeInt16LE(v, i * 4 + 2); }
  const h = Buffer.alloc(44); h.write('RIFF', 0); h.writeUInt32LE(36 + pcm.length, 4); h.write('WAVEfmt ', 8); h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(2, 22);
  h.writeUInt32LE(sr, 24); h.writeUInt32LE(sr * 4, 28); h.writeUInt16LE(4, 32); h.writeUInt16LE(16, 34); h.write('data', 36); h.writeUInt32LE(pcm.length, 40);
  const wav = join(dir, 'mix.wav'); writeFileSync(wav, Buffer.concat([h, pcm]));
  const out = join(dir, 'with_audio.mov');
  ff(['-i', mov, '-i', wav, '-map', '0:v:0', '-map', '1:a:0', '-c:v', 'copy', '-c:a', 'pcm_s16le', out], 'audio mux');
  console.log('4. audio mux: ' + probe(out, 'stream=codec_type,codec_name,duration,sample_rate,channels'));
}
