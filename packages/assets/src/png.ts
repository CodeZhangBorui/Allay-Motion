// 只读 PNG 的头部，不解码像素（像素在渲染进程解码，见 docs/03-assets.md 开头）。

const SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

export interface PngHeader {
  width: number;
  height: number;
  bitDepth: number;
  colorType: number;
}

/** 读 IHDR。不是 PNG 或头部损坏时返回 null */
export function readPngHeader(bytes: Uint8Array): PngHeader | null {
  if (bytes.length < 33) return null;
  for (let i = 0; i < SIGNATURE.length; i++) if (bytes[i] !== SIGNATURE[i]) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint32(8) !== 13) return null;
  if (String.fromCharCode(bytes[12] ?? 0, bytes[13] ?? 0, bytes[14] ?? 0, bytes[15] ?? 0) !== 'IHDR') return null;
  const width = view.getUint32(16);
  const height = view.getUint32(20);
  if (width === 0 || height === 0) return null;
  return { width, height, bitDepth: bytes[24] ?? 0, colorType: bytes[25] ?? 0 };
}
