// PNG 的完整解码（在渲染进程里用；inflate 由调用方提供：浏览器用 DecompressionStream，Node 用 zlib）。
// 自己解码而不用 canvas，是为了拿到准确的直通 alpha：2D canvas 内部是预乘的，半透明像素会丢精度。
import { readPngHeader } from './png';

export interface DecodedImage {
  width: number;
  height: number;
  /** RGBA8，直通 alpha，第一行是图像顶部 */
  data: Uint8Array;
}

export class PngDecodeError extends Error {
  override name = 'PngDecodeError';
}

/** 解码后的像素数上限（4096 × 4096） */
export const MAX_PNG_PIXELS = 4096 * 4096;

const CHANNELS: Readonly<Record<number, number>> = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 };

function paeth(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
}

/** 反过滤一个子图（Adam7 的一遍或整张图），返回去掉过滤字节后的各行 */
function unfilter(src: Uint8Array, offset: number, width: number, height: number, bpp: number, bitsPerPixel: number): { rows: Uint8Array; stride: number; used: number } {
  const stride = Math.ceil((width * bitsPerPixel) / 8);
  const rows = new Uint8Array(stride * height);
  let p = offset;
  for (let y = 0; y < height; y++) {
    if (p + 1 + stride > src.length) throw new PngDecodeError('PNG 数据不完整');
    const type = src[p++]!;
    const row = y * stride;
    const prev = row - stride;
    for (let x = 0; x < stride; x++) {
      const raw = src[p++]!;
      const a = x >= bpp ? rows[row + x - bpp]! : 0;
      const b = y > 0 ? rows[prev + x]! : 0;
      const c = y > 0 && x >= bpp ? rows[prev + x - bpp]! : 0;
      let v: number;
      switch (type) {
        case 0:
          v = raw;
          break;
        case 1:
          v = raw + a;
          break;
        case 2:
          v = raw + b;
          break;
        case 3:
          v = raw + ((a + b) >> 1);
          break;
        case 4:
          v = raw + paeth(a, b, c);
          break;
        default:
          throw new PngDecodeError(`未知的过滤类型 ${type}`);
      }
      rows[row + x] = v & 0xff;
    }
  }
  return { rows, stride, used: p - offset };
}

/** Adam7 的七遍：起点 x、起点 y、步长 x、步长 y */
const ADAM7 = [
  [0, 0, 8, 8],
  [4, 0, 8, 8],
  [0, 4, 4, 8],
  [2, 0, 4, 4],
  [0, 2, 2, 4],
  [1, 0, 2, 2],
  [0, 1, 1, 2],
] as const;

/**
 * 解码 PNG 为 RGBA8 直通 alpha。支持全部颜色类型和位深、tRNS、Adam7 隔行。忽略 gAMA、iCCP 等色彩信息
 * （资源包贴图约定是 sRGB）。不是 PNG、数据损坏、尺寸超限时抛 PngDecodeError。
 */
export async function decodePng(bytes: Uint8Array, inflate: (zlib: Uint8Array) => Promise<Uint8Array>): Promise<DecodedImage> {
  const header = readPngHeader(bytes);
  if (!header) throw new PngDecodeError('不是 PNG');
  const { width, height, bitDepth, colorType } = header;
  const channels = CHANNELS[colorType];
  if (channels === undefined || ![1, 2, 4, 8, 16].includes(bitDepth)) throw new PngDecodeError('不支持的颜色类型或位深');
  if (width * height > MAX_PNG_PIXELS) throw new PngDecodeError('图片太大');
  const interlace = bytes[28] ?? 0;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const idat: Uint8Array[] = [];
  let palette: Uint8Array | null = null;
  let trns: Uint8Array | null = null;
  let pos = 8;
  while (pos + 8 <= bytes.length) {
    const len = view.getUint32(pos);
    const type = String.fromCharCode(bytes[pos + 4]!, bytes[pos + 5]!, bytes[pos + 6]!, bytes[pos + 7]!);
    const start = pos + 8;
    if (start + len > bytes.length) throw new PngDecodeError('PNG 块越界');
    const body = bytes.subarray(start, start + len);
    if (type === 'IDAT') idat.push(body);
    else if (type === 'PLTE') palette = body;
    else if (type === 'tRNS') trns = body;
    else if (type === 'IEND') break;
    pos = start + len + 4;
  }
  if (idat.length === 0) throw new PngDecodeError('没有图像数据');
  const joined = new Uint8Array(idat.reduce((n, c) => n + c.length, 0));
  let o = 0;
  for (const c of idat) {
    joined.set(c, o);
    o += c.length;
  }
  const raw = await inflate(joined);
  if (colorType === 3 && !palette) throw new PngDecodeError('索引色图片缺少调色板');
  const pal = palette ?? new Uint8Array(0);

  const bitsPerPixel = channels * bitDepth;
  const bpp = Math.max(1, bitsPerPixel >> 3);
  const out = new Uint8Array(width * height * 4);
  const maxSample = (1 << bitDepth) - 1;

  const sampleAt = (rows: Uint8Array, rowStart: number, i: number): number => {
    if (bitDepth === 8) return rows[rowStart + i]!;
    if (bitDepth === 16) return (rows[rowStart + i * 2]! << 8) | rows[rowStart + i * 2 + 1]!;
    const bit = i * bitDepth;
    const byte = rows[rowStart + (bit >> 3)]!;
    return (byte >> (8 - bitDepth - (bit & 7))) & maxSample;
  };
  const to8 = (v: number): number => (bitDepth === 16 ? v >> 8 : bitDepth === 8 ? v : Math.round((v * 255) / maxSample));
  const trnsKey = (i: number): number => (trns && trns.length >= i * 2 + 2 ? (trns[i * 2]! << 8) | trns[i * 2 + 1]! : -1);

  const writePixel = (rows: Uint8Array, rowStart: number, x: number, dst: number): void => {
    const s = x * channels;
    switch (colorType) {
      case 0: {
        const v = sampleAt(rows, rowStart, s);
        const g = to8(v);
        out[dst] = g;
        out[dst + 1] = g;
        out[dst + 2] = g;
        out[dst + 3] = v === trnsKey(0) ? 0 : 255;
        break;
      }
      case 2: {
        const r = sampleAt(rows, rowStart, s);
        const g = sampleAt(rows, rowStart, s + 1);
        const b = sampleAt(rows, rowStart, s + 2);
        out[dst] = to8(r);
        out[dst + 1] = to8(g);
        out[dst + 2] = to8(b);
        out[dst + 3] = trns && r === trnsKey(0) && g === trnsKey(1) && b === trnsKey(2) ? 0 : 255;
        break;
      }
      case 3: {
        const idx = sampleAt(rows, rowStart, s);
        if (idx * 3 + 2 < pal.length) {
          out[dst] = pal[idx * 3]!;
          out[dst + 1] = pal[idx * 3 + 1]!;
          out[dst + 2] = pal[idx * 3 + 2]!;
        }
        out[dst + 3] = trns && idx < trns.length ? trns[idx]! : 255;
        break;
      }
      case 4: {
        const g = to8(sampleAt(rows, rowStart, s));
        out[dst] = g;
        out[dst + 1] = g;
        out[dst + 2] = g;
        out[dst + 3] = to8(sampleAt(rows, rowStart, s + 1));
        break;
      }
      case 6:
        out[dst] = to8(sampleAt(rows, rowStart, s));
        out[dst + 1] = to8(sampleAt(rows, rowStart, s + 1));
        out[dst + 2] = to8(sampleAt(rows, rowStart, s + 2));
        out[dst + 3] = to8(sampleAt(rows, rowStart, s + 3));
        break;
    }
  };

  if (interlace === 0) {
    const { rows, stride } = unfilter(raw, 0, width, height, bpp, bitsPerPixel);
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) writePixel(rows, y * stride, x, (y * width + x) * 4);
  } else {
    let offset = 0;
    for (const [x0, y0, dx, dy] of ADAM7) {
      const pw = Math.ceil((width - x0) / dx);
      const ph = Math.ceil((height - y0) / dy);
      if (pw <= 0 || ph <= 0) continue;
      const { rows, stride, used } = unfilter(raw, offset, pw, ph, bpp, bitsPerPixel);
      offset += used;
      for (let y = 0; y < ph; y++) for (let x = 0; x < pw; x++) writePixel(rows, y * stride, x, ((y0 + y * dy) * width + x0 + x * dx) * 4);
    }
  }
  return { width, height, data: out };
}
