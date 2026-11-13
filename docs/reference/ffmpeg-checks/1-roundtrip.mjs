// Validate export command lines: alpha round trip + colour matrix. Run from its own directory.
import { spawnSync } from 'node:child_process';
import { writeFileSync, readFileSync, mkdirSync, existsSync, statSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = join(dirname(fileURLToPath(import.meta.url)), 'out');
mkdirSync(dir, { recursive: true });
const W = 256, H = 144, N = 10, FPS = 30;
const bars = [
  [255, 0, 0, 255], [0, 255, 0, 255], [0, 0, 255, 255], [255, 255, 255, 255],
  [128, 128, 128, 255], [255, 255, 255, 128], [0, 0, 0, 0], [82, 207, 243, 255],
];
const names = ['red', 'green', 'blue', 'white', 'gray128', 'white@50%', 'transparent', 'allay'];
const frame = Buffer.alloc(W * H * 4);
for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) frame.set(bars[Math.floor(x / 32)], (y * W + x) * 4);
const input = Buffer.concat(Array.from({ length: N }, () => frame));
const inPath = join(dir, 'in.rgba');
writeFileSync(inPath, input);

const ff = (args, label) => {
  const r = spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...args], { encoding: 'utf8' });
  if (r.status !== 0) console.log(`  [FAIL ${label}] ${(r.stderr || '').trim().split('\n').slice(-3).join(' | ')}`);
  return r.status === 0;
};
const IN = ['-f', 'rawvideo', '-pixel_format', 'rgba', '-video_size', `${W}x${H}`, '-framerate', String(FPS), '-i', inPath];
const sx = (k) => 16 + 32 * k, sy = 72;

function rgbaAt(buf, k) { const o = (sy * W + sx(k)) * 4; return [...buf.subarray(o, o + 4)]; }
function reportRgba(path, label, pre = []) {
  const raw = join(dir, label + '.back.rgba');
  if (!ff([...pre, '-i', path, '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgba', raw], label + ' decode')) return;
  const b = readFileSync(raw);
  let worst = 0;
  const cells = names.map((n, k) => { const got = rgbaAt(b, k); const exp = bars[k];
    const d = exp[3] === 0 ? Math.abs(got[3] - 0) : Math.max(...got.map((v, i) => Math.abs(v - exp[i]))); worst = Math.max(worst, d);
    return `${n}=${got.join(',')}`; });
  console.log(`  ${label} round trip, worst channel error ${worst}:`); console.log('    ' + cells.join('  '));
}
function yuva10At(path, label, fmt) {
  const raw = join(dir, label + '.yuv');
  if (!ff(['-i', path, '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', fmt, raw], label + ' rawyuv')) return;
  const b = readFileSync(raw); const plane = W * H * 2;
  const at = (p, k) => b.readUInt16LE(p * plane + (sy * W + sx(k)) * 2);
  console.log(`  ${label} stored planes (10-bit Y/Cb/Cr/A):`);
  console.log('    ' + names.map((n, k) => `${n}=${at(0, k)}/${at(1, k)}/${at(2, k)}/${at(3, k)}`).join('  '));
}

console.log('Expected for pure red, limited range 10-bit: BT.709 Y=250 Cb=409 Cr=960 | BT.601 Y=326 Cb=361 Cr=960');
console.log('Expected alpha for 50%: 128/255*1023 = 514\n');

console.log('A. ProRes 4444, NO matrix option (just pix_fmt):');
let p = join(dir, 'a.mov');
if (ff([...IN, '-c:v', 'prores_ks', '-profile:v', '4444', '-pix_fmt', 'yuva444p10le', p], 'A')) { yuva10At(p, 'a', 'yuva444p10le'); reportRgba(p, 'a'); }

console.log('\nB. ProRes 4444 with scale=out_color_matrix=bt709:out_range=limited + tags:');
p = join(dir, 'b.mov');
if (ff([...IN, '-vf', 'scale=out_color_matrix=bt709:out_range=limited,format=yuva444p10le', '-c:v', 'prores_ks', '-profile:v', '4444', '-alpha_bits', '16', '-vendor', 'apl0',
  '-color_primaries', 'bt709', '-color_trc', 'bt709', '-colorspace', 'bt709', '-color_range', 'tv', p], 'B')) {
  yuva10At(p, 'b', 'yuva444p10le'); reportRgba(p, 'b');
  const pr = spawnSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=codec_name,profile,pix_fmt,color_range,color_space,color_transfer,color_primaries,r_frame_rate,nb_frames,codec_tag_string', '-of', 'default=nw=1', p], { encoding: 'utf8' });
  console.log('  ffprobe: ' + pr.stdout.trim().replace(/\r?\n/g, '; '));
  console.log('  size bytes: ' + statSync(p).size);
}

console.log('\nC. WebM VP9 with alpha:');
p = join(dir, 'c.webm');
if (ff([...IN, '-vf', 'scale=out_color_matrix=bt709:out_range=limited,format=yuva420p', '-c:v', 'libvpx-vp9', '-b:v', '0', '-crf', '24', '-row-mt', '1', '-auto-alt-ref', '0',
  '-color_primaries', 'bt709', '-color_trc', 'bt709', '-colorspace', 'bt709', p], 'C')) {
  reportRgba(p, 'c-native-decoder');
  reportRgba(p, 'c-libvpx-decoder', ['-c:v', 'libvpx-vp9']);
  const pr = spawnSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=codec_name,pix_fmt,color_space:stream_tags=alpha_mode', '-of', 'default=nw=1', p], { encoding: 'utf8' });
  console.log('  ffprobe: ' + pr.stdout.trim().replace(/\r?\n/g, '; '));
}

console.log('\nD. PNG sequence:');
const pd = join(dir, 'png'); mkdirSync(pd, { recursive: true });
if (ff([...IN, '-c:v', 'png', '-start_number', '0', join(pd, 'f_%05d.png')], 'D')) {
  console.log('  files: ' + readdirSync(pd).length + ' first=' + readdirSync(pd)[0]);
  reportRgba(join(pd, 'f_00000.png'), 'd');
}

console.log('\nE. H.264 encoders (opaque, yuv420p), 1280x720 green-screen style input:');
const W2 = 1280, H2 = 720; const big = Buffer.alloc(W2 * H2 * 4, 0); for (let i = 0; i < W2 * H2; i++) big.set([0, 255, 0, 255], i * 4);
const bigPath = join(dir, 'big.rgba'); writeFileSync(bigPath, Buffer.concat(Array.from({ length: 15 }, () => big)));
const IN2 = ['-f', 'rawvideo', '-pixel_format', 'rgba', '-video_size', `${W2}x${H2}`, '-framerate', '30', '-i', bigPath];
for (const [enc, extra] of [['h264_nvenc', ['-rc', 'vbr', '-cq', '18', '-b:v', '0']], ['h264_qsv', ['-global_quality', '18']], ['h264_amf', ['-rc', 'cqp', '-qp_i', '18', '-qp_p', '18']], ['h264_mf', ['-b:v', '20M']], ['libopenh264', ['-b:v', '20M']], ['libx264', ['-crf', '16']]]) {
  const out = join(dir, `e_${enc}.mp4`);
  const ok = ff([...IN2, '-vf', 'scale=out_color_matrix=bt709:out_range=limited,format=yuv420p', '-c:v', enc, ...extra, '-color_primaries', 'bt709', '-color_trc', 'bt709', '-colorspace', 'bt709', '-movflags', '+faststart', out], enc);
  if (ok) {
    const raw = join(dir, `e_${enc}.rgba`);
    ff(['-i', out, '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgba', raw], enc + ' decode');
    const b = existsSync(raw) ? readFileSync(raw) : null;
    console.log(`  ${enc}: OK, decoded centre pixel = ${b ? [...b.subarray((360 * W2 + 640) * 4, (360 * W2 + 640) * 4 + 4)].join(',') : 'n/a'} (expected 0,255,0,255)`);
  }
}
