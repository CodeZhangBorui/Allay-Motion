import { spawnSync } from 'node:child_process';
import { writeFileSync, readFileSync, mkdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = join(dirname(fileURLToPath(import.meta.url)), 'out3');
mkdirSync(dir, { recursive: true });
const W = 1920, H = 1080, FR = 30, cell = 160, cols = 12, rows = 7;
let s = 12345; const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
// 16x16 "textures": 4 shades of a base colour per block type
const types = [[70, 200, 235], [120, 120, 120], [150, 105, 60], [90, 170, 70]].map((b) => Array.from({ length: 256 }, () => { const k = 0.75 + 0.25 * Math.floor(rnd() * 4) / 3; return b.map((v) => Math.round(v * k)); }));
const cellType = Array.from({ length: cols * rows }, () => Math.floor(rnd() * types.length));
const cellDelay = Array.from({ length: cols * rows }, () => rnd() * 0.6);
const frames = [];
for (let f = 0; f < FR; f++) {
  const buf = Buffer.alloc(W * H * 4); const p = f / (FR - 1);
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    const i = r * cols + c; const sc = Math.min(1, Math.max(0, (p - cellDelay[i]) / 0.4)); if (sc <= 0) continue;
    const size = Math.round(cell * sc), x0 = c * cell + ((cell - size) >> 1), y0 = r * cell - 20 + ((cell - size) >> 1); const tex = types[cellType[i]];
    for (let y = Math.max(0, y0); y < Math.min(H, y0 + size); y++) for (let x = x0; x < x0 + size; x++) {
      const tx = Math.min(15, Math.floor(((x - x0) / size) * 16)), ty = Math.min(15, Math.floor(((y - y0) / size) * 16)); const col = tex[ty * 16 + tx]; const o = (y * W + x) * 4;
      buf[o] = col[0]; buf[o + 1] = col[1]; buf[o + 2] = col[2]; buf[o + 3] = 255;
    }
  }
  frames.push(buf);
}
const inP = join(dir, 'real.rgba'); writeFileSync(inP, Buffer.concat(frames));
const IN = ['-f', 'rawvideo', '-pixel_format', 'rgba', '-video_size', `${W}x${H}`, '-framerate', '60', '-i', inP];
const VF = 'scale=out_color_matrix=bt709:out_range=limited,format=yuva444p10le,setparams=color_primaries=bt709:color_trc=bt709:colorspace=bt709';
const run = (label, args, out, dec = []) => {
  const t0 = performance.now();
  const r = spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...IN, ...args, out], { encoding: 'utf8' });
  const sec = (performance.now() - t0) / 1000;
  if (r.status !== 0) { console.log(label, 'FAIL', (r.stderr || '').trim().split('\n').slice(-1)[0]); return; }
  const raw = join(dir, 'back.rgba'); spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...dec, '-i', out, '-f', 'rawvideo', '-pix_fmt', 'rgba', raw]);
  const b = readFileSync(raw), a = readFileSync(inP); let maxc = 0, maxa = 0, sum = 0, n = 0;
  for (let i = 0; i < a.length; i += 4 * 7) { const al = a[i + 3]; maxa = Math.max(maxa, Math.abs(b[i + 3] - al)); if (al === 255) for (let k = 0; k < 3; k++) { const d = Math.abs(b[i + k] - a[i + k]); maxc = Math.max(maxc, d); sum += d; n++; } }
  const mb = statSync(out).size / 1e6;
  console.log(`${label.padEnd(34)} ${mb.toFixed(1).padStart(7)} MB/30f  => ${(mb * 4).toFixed(0).padStart(4)} MB per 2s@60  enc ${(FR / sec).toFixed(1)} fps  colour err max ${maxc} mean ${(sum / n).toFixed(2)}  alpha err max ${maxa}`);
};
run('prores 4444 default', ['-vf', VF, '-c:v', 'prores_ks', '-profile:v', '4444', '-alpha_bits', '16', '-vendor', 'apl0'], join(dir, 'd.mov'));
for (const q of [5, 9, 11, 13, 16]) run(`prores 4444 qscale ${q}`, ['-vf', VF, '-c:v', 'prores_ks', '-profile:v', '4444', '-alpha_bits', '16', '-vendor', 'apl0', '-qscale:v', String(q)], join(dir, `q${q}.mov`));
run('prores 4444 alpha_bits 8 q11', ['-vf', VF, '-c:v', 'prores_ks', '-profile:v', '4444', '-alpha_bits', '8', '-vendor', 'apl0', '-qscale:v', '11'], join(dir, 'a8.mov'));
run('qtrle (QuickTime Animation) argb', ['-c:v', 'qtrle', '-pix_fmt', 'argb'], join(dir, 'qtrle.mov'));
run('png in mov', ['-c:v', 'png', '-pix_fmt', 'rgba'], join(dir, 'png.mov'));
run('vp9 alpha crf 24', ['-vf', 'scale=out_color_matrix=bt709:out_range=limited,format=yuva420p,setparams=color_primaries=bt709:color_trc=bt709:colorspace=bt709', '-c:v', 'libvpx-vp9', '-b:v', '0', '-crf', '24', '-row-mt', '1', '-auto-alt-ref', '0'], join(dir, 'v.webm'), ['-c:v', 'libvpx-vp9']);
run('vp9 alpha crf 24 cpu-used 4', ['-vf', 'scale=out_color_matrix=bt709:out_range=limited,format=yuva420p,setparams=color_primaries=bt709:color_trc=bt709:colorspace=bt709', '-c:v', 'libvpx-vp9', '-b:v', '0', '-crf', '24', '-row-mt', '1', '-auto-alt-ref', '0', '-deadline', 'good', '-cpu-used', '4'], join(dir, 'v4.webm'), ['-c:v', 'libvpx-vp9']);
