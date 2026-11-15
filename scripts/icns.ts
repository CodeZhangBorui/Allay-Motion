// macOS 的应用图标 icon.icns（docs/decisions.md“macOS 构建”）：从提交进仓库的烘焙产物 packages/mascot/generated/icon.ico
// 生成，不引入新的图像。ICO 里每个尺寸都是一张 PNG（16–256，scripts/mascot-bake/png.ts 的 encodeIco）：
// 16–256 原样放进 icns；macOS 还要 512 和 1024（Retina 下的 256@2x、512@2x），由 256 那张按最近邻整数倍放大
// （像素画，放大不插值，不产生新的像素内容）。
import { encodePng, decodePng, type Rgba } from './mascot-bake/png';

/** 解析 ICO（只认每项都是 PNG 的那种），返回 尺寸 → PNG 字节 */
export function readIcoPngs(ico: Uint8Array): Map<number, Buffer> {
  const buf = Buffer.from(ico.buffer, ico.byteOffset, ico.byteLength);
  if (buf.length < 6 || buf.readUInt16LE(0) !== 0 || buf.readUInt16LE(2) !== 1) throw new Error('不是 ICO 文件');
  const count = buf.readUInt16LE(4);
  const out = new Map<number, Buffer>();
  for (let i = 0; i < count; i++) {
    const e = 6 + 16 * i;
    if (e + 16 > buf.length) throw new Error('ICO 目录不完整');
    const size = buf[e] === 0 ? 256 : buf[e]!;
    const length = buf.readUInt32LE(e + 8);
    const offset = buf.readUInt32LE(e + 12);
    const png = buf.subarray(offset, offset + length);
    if (png.length !== length || png.readUInt32BE(0) !== 0x89504e47) throw new Error(`ICO 里 ${size}px 那一项不是 PNG`);
    out.set(size, Buffer.from(png));
  }
  return out;
}

/** 最近邻整数倍放大 */
export function upscale(src: Rgba, k: number): Rgba {
  const w = src.width * k;
  const h = src.height * k;
  const data = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) {
    const sy = Math.floor(y / k);
    for (let x = 0; x < w; x++) {
      const s = (sy * src.width + Math.floor(x / k)) * 4;
      data.set(src.data.subarray(s, s + 4), (y * w + x) * 4);
    }
  }
  return { width: w, height: h, data };
}

/** icns 的类型码 → 像素尺寸（都用 PNG 数据，macOS 10.7 起支持） */
export const ICNS_TYPES: readonly (readonly [string, number])[] = [
  ['icp4', 16],
  ['icp5', 32],
  ['icp6', 64],
  ['ic07', 128],
  ['ic08', 256],
  ['ic09', 512],
  ['ic10', 1024],
  ['ic11', 32],
  ['ic12', 64],
  ['ic13', 256],
  ['ic14', 512],
];

export function encodeIcns(pngBySize: ReadonlyMap<number, Buffer>): Buffer {
  const chunks: Buffer[] = [];
  for (const [type, size] of ICNS_TYPES) {
    const png = pngBySize.get(size);
    if (!png) throw new Error(`缺少 ${size}px 的图像`);
    const head = Buffer.alloc(8);
    head.write(type, 0, 'ascii');
    head.writeUInt32BE(png.length + 8, 4);
    chunks.push(head, png);
  }
  const body = Buffer.concat(chunks);
  const head = Buffer.alloc(8);
  head.write('icns', 0, 'ascii');
  head.writeUInt32BE(body.length + 8, 4);
  return Buffer.concat([head, body]);
}

/** icon.ico → icon.icns 的字节 */
export function icnsFromIco(ico: Uint8Array): Buffer {
  const pngs = readIcoPngs(ico);
  const base = pngs.get(256);
  if (!base) throw new Error('ICO 里没有 256px 的图像');
  const img = decodePng(base);
  if (img.width !== 256 || img.height !== 256) throw new Error(`ICO 的 256px 项实际是 ${img.width}×${img.height}`);
  const all = new Map(pngs);
  all.set(512, encodePng(upscale(img, 2)));
  all.set(1024, encodePng(upscale(img, 4)));
  return encodeIcns(all);
}
