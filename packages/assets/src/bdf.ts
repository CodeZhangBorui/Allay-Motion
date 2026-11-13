// BDF 位图字体的解析（docs/03-assets.md 3.9 的兜底字体，见 decisions.md M2b）。
// 解析结果是紧凑的定长表，供引擎在 Worker 里按需栅格化。这里不画任何字形，字形全部来自字体文件本身。

export interface BitmapFontTables {
  /** 字体的上升和下降（像素） */
  ascent: number;
  descent: number;
  /** 按码位升序 */
  codepoints: Uint32Array;
  /** 每个字形 5 个值：前进宽度、位图宽、位图高、x 偏移、y 偏移（BDF 的 BBX，y 向上为正，相对基线） */
  metrics: Int16Array;
  /** 每个字形的位图在 bits 里的起点；位图按行存，每行 ceil(宽 / 8) 字节，最高位在左 */
  offsets: Uint32Array;
  bits: Uint8Array;
}

export class BdfParseError extends Error {
  override name = 'BdfParseError';
}

/** 单个字形的位图边长上限 */
const MAX_GLYPH_SIDE = 64;

/** 解析 BDF 文本。只收 ENCODING 非负的字形；DWIDTH 缺失时取 BBX 宽 */
export function parseBdf(text: string): BitmapFontTables {
  const lines = text.split(/\r?\n/);
  if (!lines[0]?.startsWith('STARTFONT')) throw new BdfParseError('不是 BDF 字体');
  let ascent = 0;
  let descent = 0;
  const glyphs: { cp: number; m: [number, number, number, number, number]; bits: number[] }[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (line.startsWith('FONT_ASCENT ')) ascent = Number.parseInt(line.slice(12), 10) || 0;
    else if (line.startsWith('FONT_DESCENT ')) descent = Number.parseInt(line.slice(13), 10) || 0;
    else if (line.startsWith('STARTCHAR')) {
      let cp = -1;
      let dwidth: number | null = null;
      let bbx: [number, number, number, number] | null = null;
      const bits: number[] = [];
      for (i++; i < lines.length && !lines[i]!.startsWith('ENDCHAR'); i++) {
        const l = lines[i]!;
        if (l.startsWith('ENCODING ')) cp = Number.parseInt(l.slice(9), 10);
        else if (l.startsWith('DWIDTH ')) dwidth = Number.parseInt(l.slice(7), 10);
        else if (l.startsWith('BBX ')) {
          const v = l.slice(4).trim().split(/\s+/).map((s) => Number.parseInt(s, 10));
          if (v.length === 4 && v.every(Number.isFinite)) bbx = [v[0]!, v[1]!, v[2]!, v[3]!];
        } else if (l === 'BITMAP' && bbx) {
          const rowBytes = Math.ceil(bbx[0] / 8);
          for (let r = 0; r < bbx[1]; r++) {
            const hex = (lines[++i] ?? '').trim();
            for (let b = 0; b < rowBytes; b++) bits.push(Number.parseInt(hex.slice(b * 2, b * 2 + 2), 16) || 0);
          }
        }
      }
      if (cp >= 0 && cp <= 0x10ffff && bbx && bbx[0] >= 0 && bbx[1] >= 0 && bbx[0] <= MAX_GLYPH_SIDE && bbx[1] <= MAX_GLYPH_SIDE) {
        glyphs.push({ cp, m: [dwidth ?? bbx[0], bbx[0], bbx[1], bbx[2], bbx[3]], bits });
      }
    }
  }
  if (glyphs.length === 0) throw new BdfParseError('字体里没有字形');
  glyphs.sort((a, b) => a.cp - b.cp);
  const codepoints = new Uint32Array(glyphs.length);
  const metrics = new Int16Array(glyphs.length * 5);
  const offsets = new Uint32Array(glyphs.length);
  const bits = new Uint8Array(glyphs.reduce((n, g) => n + g.bits.length, 0));
  let o = 0;
  glyphs.forEach((g, k) => {
    codepoints[k] = g.cp;
    metrics.set(g.m, k * 5);
    offsets[k] = o;
    bits.set(g.bits, o);
    o += g.bits.length;
  });
  return { ascent, descent, codepoints, metrics, offsets, bits };
}

/** 二分查找码位；没有时返回 -1 */
export function findBdfGlyph(codepoints: Uint32Array, codepoint: number): number {
  let lo = 0;
  let hi = codepoints.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const v = codepoints[mid]!;
    if (v === codepoint) return mid;
    if (v < codepoint) lo = mid + 1;
    else hi = mid - 1;
  }
  return -1;
}
