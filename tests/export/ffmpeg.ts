import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

export const ROOT = resolve(import.meta.dirname, '../..');
export const FFMPEG_DIR = join(ROOT, 'resources', 'ffmpeg', `${process.platform}-${process.arch}`);
const exe = (n: string) => join(FFMPEG_DIR, process.platform === 'win32' ? `${n}.exe` : n);
export const FFMPEG = exe('ffmpeg');
export const FFPROBE = exe('ffprobe');

/** 固定的 FFmpeg 不在就明确失败，不悄悄跳过、也不退到 PATH */
export function assertFfmpegFetched(): void {
  const missing = [FFMPEG, FFPROBE].filter((p) => !existsSync(p));
  if (missing.length) {
    throw new Error(`找不到固定版本的 FFmpeg（${missing.join('、')}）。先运行 pnpm ffmpeg:fetch。`);
  }
}

export function tempDir(): string {
  return mkdtempSync(join(tmpdir(), 'allay-export-'));
}

export function removeDir(dir: string): void {
  rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
}

/** 解码第 index 帧为某种原始像素格式 */
export function decodeFrame(path: string, pixFmt: string, index = 0, pre: string[] = []): Buffer {
  const args = ['-hide_banner', '-loglevel', 'error', ...pre, '-i', path, '-vf', `select='eq(n,${index})'`, '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', pixFmt, 'pipe:1'];
  const r = spawnSync(FFMPEG, args, { maxBuffer: 512 * 1024 * 1024, windowsHide: true });
  if (r.status !== 0) throw new Error(`decode failed: ${r.stderr.toString()}`);
  return r.stdout;
}

/** 解码全部帧为 RGBA，逐帧回调；pre 是输入前的参数（VP9 带 alpha 要用 -c:v libvpx-vp9） */
export async function decodeAllRgba(path: string, frameBytes: number, onFrame: (frame: Buffer, index: number) => void, pre: string[] = []): Promise<number> {
  const p = spawn(FFMPEG, ['-hide_banner', '-loglevel', 'error', ...pre, '-i', path, '-f', 'rawvideo', '-pix_fmt', 'rgba', 'pipe:1'], { windowsHide: true });
  let pending: Buffer = Buffer.alloc(0);
  let n = 0;
  p.stdout.on('data', (chunk: Buffer) => {
    pending = pending.length ? Buffer.concat([pending, chunk]) : chunk;
    while (pending.length >= frameBytes) {
      onFrame(pending.subarray(0, frameBytes), n++);
      pending = pending.subarray(frameBytes);
    }
  });
  const code = await new Promise<number | null>((r) => p.on('close', r));
  if (code !== 0) throw new Error(`decode failed with ${code}`);
  return n;
}

export function probe(path: string, entries: string): Record<string, string> {
  const r = spawnSync(FFPROBE, ['-v', 'error', '-select_streams', 'v:0', '-count_frames', '-show_entries', entries, '-of', 'default=nw=1', path], {
    encoding: 'utf8',
    windowsHide: true,
  });
  if (r.status !== 0) throw new Error(`ffprobe failed: ${r.stderr}`);
  const out: Record<string, string> = {};
  for (const line of r.stdout.split(/\r?\n/)) {
    const i = line.indexOf('=');
    if (i > 0) out[line.slice(0, i)] = line.slice(i + 1);
  }
  return out;
}

/** 进程是否还在（Windows 上用 tasklist 再确认一次） */
export function processAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
  } catch {
    return false;
  }
  if (process.platform === 'win32') {
    const r = spawnSync('tasklist', ['/FI', `PID eq ${pid}`, '/NH'], { encoding: 'utf8', windowsHide: true });
    return r.stdout.includes(String(pid));
  }
  return true;
}

/** 八色块测试画面（docs/reference/ffmpeg-checks/1-roundtrip.mjs） */
export const BARS: [number, number, number, number][] = [
  [255, 0, 0, 255],
  [0, 255, 0, 255],
  [0, 0, 255, 255],
  [255, 255, 255, 255],
  [128, 128, 128, 255],
  [255, 255, 255, 128],
  [0, 0, 0, 0],
  [82, 207, 243, 255],
];
export const BAR_W = 32;
export const W = BAR_W * BARS.length;
export const H = 144;

export function barsFrame(): Uint8Array {
  const f = new Uint8Array(W * H * 4);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) f.set(BARS[Math.floor(x / BAR_W)]!, (y * W + x) * 4);
  return f;
}
