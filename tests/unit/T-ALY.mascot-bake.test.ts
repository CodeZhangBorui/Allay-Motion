// T-ALY-1（图集完整性、首尾无缝）与 T-ALY-7（仓库扫描，按用户决定改过的判定），以及烘焙的确定性。
//
// 不依赖本机装没装游戏、不联网：用测试时生成的假贴图（32×32，按模型各盒子的贴图区域填纯色色块，只是测试数据）
// 跑完整的 pnpm mascot:bake 管线（内部模板 → 不显示的 Electron 窗口里的引擎 → 拼图编码）。
// 同一张假贴图烘焙两次，比较全部产物逐字节相同。
import { execFileSync, spawn } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { ALLAY_PARTS } from '../../packages/mascot/model/allay.model';
import { CLIP_ORDER, CLIPS } from '../../packages/mascot/model/allay.motions';
import { ATLAS_COLUMNS, ATLAS_SIZES, COMMITTED_FILES, GENERATED_DIR, GENERATED_FILES, ICO_SIZES, type AtlasJson } from '../../packages/mascot/src/index';
import { decodePng, encodePng, type Rgba } from '../../scripts/mascot-bake/png';

const ROOT = resolve(import.meta.dirname, '../..');
const TSX_CLI = createRequire(import.meta.url).resolve('tsx/cli');

/** 假贴图：每个盒子的展开区域（上下面一行、侧面一行）各填一种纯色，其余透明 */
function fakeTexture(): Rgba {
  const img: Rgba = { width: 32, height: 32, data: new Uint8Array(32 * 32 * 4) };
  const palette: [number, number, number][] = [
    [220, 60, 60],
    [60, 200, 90],
    [70, 110, 230],
    [230, 200, 50],
    [200, 80, 210],
    [60, 210, 210],
    [240, 140, 40],
  ];
  let n = 0;
  for (const part of ALLAY_PARTS)
    for (const b of part.boxes) {
      const [u, v] = b.uv;
      const [w, h, d] = b.size;
      const color = palette[n++ % palette.length]!;
      const fill = (x0: number, y0: number, x1: number, y1: number, shade: number) => {
        for (let y = y0; y < y1; y++)
          for (let x = x0; x < x1; x++) {
            if (x < 0 || y < 0 || x >= 32 || y >= 32) continue;
            const o = (y * 32 + x) * 4;
            img.data.set([Math.round(color[0] * shade), Math.round(color[1] * shade), Math.round(color[2] * shade), 255], o);
          }
      };
      fill(u + d, v, u + d + 2 * w, v + d, 1);
      fill(u, v + d, u + 2 * d + 2 * w, v + d + h, 0.8);
    }
  return img;
}

function runBake(args: string[]): Promise<void> {
  return new Promise((ok, fail) => {
    const env = { ...process.env };
    delete env.ELECTRON_RUN_AS_NODE;
    const child = spawn(process.execPath, [TSX_CLI, join(ROOT, 'scripts/mascot-bake.ts'), '--quiet', ...args], { cwd: ROOT, env, windowsHide: true });
    let err = '';
    child.stderr.on('data', (d: Buffer) => (err += d.toString()));
    child.on('error', fail);
    child.on('exit', (code) => (code === 0 ? ok() : fail(new Error(`mascot:bake exited with ${code}: ${err}`))));
  });
}

let work: string;
let outA: string;
let outB: string;

beforeAll(async () => {
  work = mkdtempSync(join(tmpdir(), 'allay-aly-test-'));
  const texture = join(work, 'fake-allay.png');
  const { writeFileSync } = await import('node:fs');
  writeFileSync(texture, encodePng(fakeTexture()));
  outA = join(work, 'a');
  outB = join(work, 'b');
  await Promise.all([
    runBake(['--texture', texture, '--out', outA, '--review-out', join(work, 'review')]),
    runBake(['--texture', texture, '--out', outB, '--no-review']),
  ]);
}, 300_000);

afterAll(() => {
  if (work) rmSync(work, { recursive: true, force: true });
});

const readPng = (dir: string, name: string) => decodePng(readFileSync(join(dir, name)));

function frameAt(atlas: Rgba, size: number, index: number): Rgba {
  const fx = (index % ATLAS_COLUMNS) * size;
  const fy = Math.floor(index / ATLAS_COLUMNS) * size;
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) data.set(atlas.data.subarray(((fy + y) * atlas.width + fx) * 4, ((fy + y) * atlas.width + fx + size) * 4), y * size * 4);
  return { width: size, height: size, data };
}

/** 两帧在预乘域里的平均绝对差 */
function frameDiff(a: Rgba, b: Rgba): number {
  let sum = 0;
  for (let i = 0; i < a.data.length; i += 4) {
    const aa = a.data[i + 3]!;
    const ba = b.data[i + 3]!;
    for (let c = 0; c < 3; c++) sum += Math.abs((a.data[i + c]! * aa) / 255 - (b.data[i + c]! * ba) / 255);
    sum += Math.abs(aa - ba);
  }
  return sum / a.data.length;
}

function median(xs: number[]): number {
  const s = [...xs].sort((p, q) => p - q);
  const m = s.length >> 1;
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
}

describe('T-ALY-1 图集完整性', () => {
  test('帧数、尺寸与 atlas.json 一致，锚点每帧一项', () => {
    const atlas = JSON.parse(readFileSync(join(outA, 'allay.atlas.json'), 'utf8')) as AtlasJson;
    const total = CLIP_ORDER.reduce((n, c) => n + CLIPS[c].frames, 0);
    expect(total).toBe(159);
    expect(atlas.frames).toBe(total);
    expect(atlas.fps).toBe(30);
    expect(atlas.columns).toBe(13);
    expect(atlas.handAnchor).toHaveLength(total);
    let start = 0;
    for (const clip of CLIP_ORDER) {
      expect(atlas.clips[clip]).toEqual({ start, count: CLIPS[clip].frames });
      start += CLIPS[clip].frames;
    }
    for (const [x, y, deg] of atlas.handAnchor) {
      expect(x).toBeGreaterThan(0);
      expect(x).toBeLessThan(1);
      expect(y).toBeGreaterThan(0);
      expect(y).toBeLessThan(1);
      expect(Math.abs(deg)).toBeLessThanOrEqual(180);
    }
    for (const size of ATLAS_SIZES) {
      const img = readPng(outA, `allay-${size}.png`);
      expect([img.width, img.height]).toEqual([13 * size, Math.ceil(total / 13) * size]);
      // 每一帧都画出了东西，且四边不贴边（没有被画面裁掉）；图集末尾的空格全透明
      for (let i = 0; i < 13 * Math.ceil(total / 13); i++) {
        const f = frameAt(img, size, i);
        let opaque = 0;
        let edge = 0;
        for (let y = 0; y < size; y++)
          for (let x = 0; x < size; x++) {
            const a = f.data[(y * size + x) * 4 + 3]!;
            if (a > 0) {
              opaque++;
              if (x === 0 || y === 0 || x === size - 1 || y === size - 1) edge++;
            }
          }
        if (i < total) {
          expect(opaque, `frame ${i} @ ${size}`).toBeGreaterThan(size * size * 0.03);
          expect(edge, `frame ${i} @ ${size} touches the edge`).toBe(0);
        } else expect(opaque).toBe(0);
      }
    }
  });

  test('每个动作“末帧到首帧”的差不超过相邻帧差中位数的 1.5 倍（首尾无缝）', () => {
    const atlas = JSON.parse(readFileSync(join(outA, 'allay.atlas.json'), 'utf8')) as AtlasJson;
    for (const size of ATLAS_SIZES) {
      const img = readPng(outA, `allay-${size}.png`);
      for (const clip of CLIP_ORDER) {
        const { start, count } = atlas.clips[clip];
        const frames = Array.from({ length: count }, (_, i) => frameAt(img, size, start + i));
        const adjacent = frames.slice(1).map((f, i) => frameDiff(frames[i]!, f));
        const wrap = frameDiff(frames[count - 1]!, frames[0]!);
        const med = median(adjacent);
        expect(med, `${clip} @ ${size} moves`).toBeGreaterThan(0);
        expect(wrap, `${clip} @ ${size}: wrap ${wrap.toFixed(3)} vs median ${med.toFixed(3)}`).toBeLessThanOrEqual(1.5 * med);
      }
    }
  });
});

describe('烘焙的确定性', () => {
  test('同一张贴图烘焙两次，全部产物逐字节相同', () => {
    const a = readdirSync(outA).sort();
    expect(a).toEqual([...GENERATED_FILES].sort());
    expect(readdirSync(outB).sort()).toEqual(a);
    for (const name of a) expect(readFileSync(join(outB, name)).equals(readFileSync(join(outA, name))), name).toBe(true);
  });

  test('icon.ico 含 16–256 各尺寸的 PNG', () => {
    const ico = readFileSync(join(outA, 'icon.ico'));
    expect(ico.readUInt16LE(2)).toBe(1);
    expect(ico.readUInt16LE(4)).toBe(ICO_SIZES.length);
    ICO_SIZES.forEach((size, i) => {
      const e = 6 + 16 * i;
      const png = ico.subarray(ico.readUInt32LE(e + 12), ico.readUInt32LE(e + 12) + ico.readUInt32LE(e + 8));
      const img = decodePng(png);
      expect([img.width, img.height]).toEqual([size, size]);
    });
  });

  test('评审材料：联络图和四段动作的 APNG', () => {
    expect(readdirSync(join(work, 'review')).sort()).toEqual(['allay-dance.apng', 'allay-fly.apng', 'allay-hover.apng', 'allay-sad.apng', 'mascot-contact-sheet.png']);
  });
});

describe('T-ALY-7 仓库扫描', () => {
  const git = (...args: string[]) => execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', windowsHide: true });

  // 判定按用户 2026-11-13 的决定再改一次（docs/decisions.md M8）：运行时和打包用到的烘焙产物提交进仓库，
  // 除此之外 packages/mascot 里没有任何图片；应用图标的各尺寸 PNG 和评审材料仍被忽略
  test('packages/mascot 里提交的图片只有 generated/ 下约定的那几个烘焙产物', () => {
    const tracked = git('ls-files', '-z', '--', 'packages/mascot').split('\0').filter(Boolean);
    const images = tracked.filter((f) => /\.(png|apng|jpe?g|gif|webp|bmp|tga|ico|icns|svg|avif)$/i.test(f)).sort();
    const allowed = COMMITTED_FILES.filter((f) => !f.endsWith('.json')).map((f) => `packages/mascot/${GENERATED_DIR}/${f}`).sort();
    expect(images.filter((f) => !allowed.includes(f))).toEqual([]);
  });

  test('应用图标的各尺寸 PNG 和评审材料被 git 忽略', () => {
    for (const p of [`packages/mascot/${GENERATED_DIR}/icon-256.png`, 'docs/review/M5a/out/mascot-contact-sheet.png']) {
      expect(git('check-ignore', '--no-index', p).trim()).toBe(p);
    }
  });

  test('全部产物都能由 pnpm mascot:bake 重新生成（上面的烘焙产出的文件集合与约定一致）', () => {
    expect(readdirSync(outA).sort()).toEqual([...GENERATED_FILES].sort());
  });
});
