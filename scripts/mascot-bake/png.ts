// 烘焙用的 PNG / APNG / ICO 编解码。只用 Node 的 zlib，不引入依赖。
// 编码是确定性的：同样的像素、同样的 zlib，输出逐字节相同（不写时间戳、不写任何可变的块）。
import { deflateSync, inflateSync } from 'node:zlib';

/** 直通 alpha 的 RGBA8，第一行是顶部 */
export interface Rgba {
  width: number;
  height: number;
  data: Uint8Array;
}

const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(bufs: Uint8Array[]): number {
  let c = 0xffffffff;
  for (const b of bufs) for (let i = 0; i < b.length; i++) c = CRC_TABLE[(c ^ b[i]!) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Uint8Array): Buffer {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(data.length, 0);
  head.write(type, 4, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32([head.subarray(4), data]), 0);
  return Buffer.concat([head, data, crc]);
}

function ihdr(width: number, height: number): Buffer {
  const b = Buffer.alloc(13);
  b.writeUInt32BE(width, 0);
  b.writeUInt32BE(height, 4);
  b[8] = 8; // 位深
  b[9] = 6; // RGBA
  return b;
}

function paeth(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
}

/** 每行按“绝对值和最小”在五种滤波里选一种（确定性的启发式），再整体 deflate */
function filteredScanlines(img: Rgba): Buffer {
  const { width, height, data } = img;
  const stride = width * 4;
  const out = Buffer.alloc((stride + 1) * height);
  const cand = Array.from({ length: 5 }, () => Buffer.alloc(stride));
  for (let y = 0; y < height; y++) {
    const row = data.subarray(y * stride, (y + 1) * stride);
    const prev = y > 0 ? data.subarray((y - 1) * stride, y * stride) : null;
    let best = 0;
    let bestSum = Infinity;
    for (let f = 0; f < 5; f++) {
      const c = cand[f]!;
      let sum = 0;
      for (let i = 0; i < stride; i++) {
        const a = i >= 4 ? row[i - 4]! : 0;
        const b = prev ? prev[i]! : 0;
        const cc = prev && i >= 4 ? prev[i - 4]! : 0;
        const x = row[i]!;
        const v = f === 0 ? x : f === 1 ? x - a : f === 2 ? x - b : f === 3 ? x - ((a + b) >> 1) : x - paeth(a, b, cc);
        c[i] = v & 0xff;
        sum += (v & 0xff) < 128 ? v & 0xff : 256 - (v & 0xff);
      }
      if (sum < bestSum) {
        bestSum = sum;
        best = f;
      }
    }
    out[y * (stride + 1)] = best;
    cand[best]!.copy(out, y * (stride + 1) + 1);
  }
  return out;
}

export function encodePng(img: Rgba): Buffer {
  const idat = deflateSync(filteredScanlines(img), { level: 9 });
  return Buffer.concat([SIGNATURE, chunk('IHDR', ihdr(img.width, img.height)), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0))]);
}

/** APNG：所有帧同尺寸，整帧替换（dispose none、blend source），无限循环 */
export function encodeApng(frames: Rgba[], fps: number): Buffer {
  const first = frames[0];
  if (!first) throw new Error('APNG needs at least one frame');
  const parts: Buffer[] = [SIGNATURE, chunk('IHDR', ihdr(first.width, first.height))];
  const actl = Buffer.alloc(8);
  actl.writeUInt32BE(frames.length, 0);
  actl.writeUInt32BE(0, 4);
  parts.push(chunk('acTL', actl));
  let seq = 0;
  frames.forEach((f, i) => {
    if (f.width !== first.width || f.height !== first.height) throw new Error('APNG frames must share one size');
    const fctl = Buffer.alloc(26);
    fctl.writeUInt32BE(seq++, 0);
    fctl.writeUInt32BE(f.width, 4);
    fctl.writeUInt32BE(f.height, 8);
    fctl.writeUInt16BE(1, 20); // delay = 1 / fps
    fctl.writeUInt16BE(fps, 22);
    parts.push(chunk('fcTL', fctl));
    const z = deflateSync(filteredScanlines(f), { level: 9 });
    if (i === 0) parts.push(chunk('IDAT', z));
    else {
      const seqBuf = Buffer.alloc(4);
      seqBuf.writeUInt32BE(seq++, 0);
      parts.push(chunk('fdAT', Buffer.concat([seqBuf, z])));
    }
  });
  parts.push(chunk('IEND', Buffer.alloc(0)));
  return Buffer.concat(parts);
}

/** ICO：每个尺寸放一张 PNG（Windows Vista 起支持）。尺寸 ≤ 256 */
export function encodeIco(images: Rgba[]): Buffer {
  const pngs = images.map((img) => {
    if (img.width > 256 || img.height > 256) throw new Error('ICO entries must be at most 256 px');
    return encodePng(img);
  });
  const header = Buffer.alloc(6 + 16 * images.length);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(images.length, 4);
  let offset = header.length;
  images.forEach((img, i) => {
    const e = 6 + 16 * i;
    header[e] = img.width === 256 ? 0 : img.width;
    header[e + 1] = img.height === 256 ? 0 : img.height;
    header.writeUInt16LE(1, e + 4); // 色彩平面
    header.writeUInt16LE(32, e + 6); // 位深
    header.writeUInt32LE(pngs[i]!.length, e + 8);
    header.writeUInt32LE(offset, e + 12);
    offset += pngs[i]!.length;
  });
  return Buffer.concat([header, ...pngs]);
}

/** 解码 PNG（非隔行；位深 8 的灰度、RGB、调色板、灰度 + alpha、RGBA，以及位深 1/2/4 的调色板）→ RGBA8 */
export function decodePng(bytes: Uint8Array): Rgba {
  const buf = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (buf.length < 8 || !buf.subarray(0, 8).equals(SIGNATURE)) throw new Error('not a PNG file');
  let pos = 8;
  let width = 0;
  let height = 0;
  let depth = 0;
  let type = 0;
  let interlace = 0;
  let palette: Buffer | null = null;
  let trns: Buffer | null = null;
  const idat: Buffer[] = [];
  while (pos + 8 <= buf.length) {
    const len = buf.readUInt32BE(pos);
    const kind = buf.toString('ascii', pos + 4, pos + 8);
    const data = buf.subarray(pos + 8, pos + 8 + len);
    if (data.length !== len) throw new Error('truncated PNG chunk');
    if (kind === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      depth = data[8]!;
      type = data[9]!;
      interlace = data[12]!;
    } else if (kind === 'PLTE') palette = data;
    else if (kind === 'tRNS') trns = data;
    else if (kind === 'IDAT') idat.push(data);
    else if (kind === 'IEND') break;
    pos += 12 + len;
  }
  if (width < 1 || height < 1 || width > 4096 || height > 4096) throw new Error(`unsupported PNG size ${width}×${height}`);
  if (interlace !== 0) throw new Error('interlaced PNG is not supported');
  const channels = ({ 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 } as Record<number, number>)[type];
  if (!channels) throw new Error(`unsupported PNG color type ${type}`);
  if (!(depth === 8 || (type === 3 && (depth === 1 || depth === 2 || depth === 4)))) throw new Error(`unsupported PNG bit depth ${depth}`);
  const raw = inflateSync(Buffer.concat(idat));
  const bpp = Math.max(1, (channels * depth) >> 3);
  const stride = Math.ceil((width * channels * depth) / 8);
  if (raw.length < (stride + 1) * height) throw new Error('PNG data too short');
  const lines = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y++) {
    const f = raw[y * (stride + 1)]!;
    const src = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    const cur = lines.subarray(y * stride, (y + 1) * stride);
    const prev = y > 0 ? lines.subarray((y - 1) * stride, y * stride) : null;
    for (let i = 0; i < stride; i++) {
      const a = i >= bpp ? cur[i - bpp]! : 0;
      const b = prev ? prev[i]! : 0;
      const c = prev && i >= bpp ? prev[i - bpp]! : 0;
      const x = src[i]!;
      cur[i] = (f === 0 ? x : f === 1 ? x + a : f === 2 ? x + b : f === 3 ? x + ((a + b) >> 1) : f === 4 ? x + paeth(a, b, c) : NaN) & 0xff;
      if (f > 4) throw new Error(`bad PNG filter ${f}`);
    }
  }
  const out = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) {
    const row = lines.subarray(y * stride, (y + 1) * stride);
    for (let x = 0; x < width; x++) {
      const o = (y * width + x) * 4;
      if (type === 3) {
        const idx = depth === 8 ? row[x]! : (row[(x * depth) >> 3]! >> (8 - depth - ((x * depth) & 7))) & ((1 << depth) - 1);
        if (!palette || idx * 3 + 2 >= palette.length) throw new Error('PNG palette index out of range');
        out[o] = palette[idx * 3]!;
        out[o + 1] = palette[idx * 3 + 1]!;
        out[o + 2] = palette[idx * 3 + 2]!;
        out[o + 3] = trns && idx < trns.length ? trns[idx]! : 255;
      } else if (type === 6) {
        out.set(row.subarray(x * 4, x * 4 + 4), o);
      } else if (type === 2) {
        out.set(row.subarray(x * 3, x * 3 + 3), o);
        out[o + 3] = 255;
      } else if (type === 4) {
        out.fill(row[x * 2]!, o, o + 3);
        out[o + 3] = row[x * 2 + 1]!;
      } else {
        out.fill(row[x]!, o, o + 3);
        out[o + 3] = 255;
      }
    }
  }
  return { width, height, data: out };
}
