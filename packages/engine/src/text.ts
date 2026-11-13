// 文字（docs/02-engine.md 2.8、03-assets.md 3.9）：位图字，像素对齐，不做平滑。
// 字形来源：资源栈的 minecraft:default（bitmap、space 提供器），找不到的字形回退到兜底的 BDF 像素字体。
// 一段文字栅格化成一张贴图（每个字形的像素原样拷贝），配一个四边形；阴影是同一张贴图偏移 1 个字体像素、颜色 × 0.25。
import { findBdfGlyph, glyphInkWidth, GLYPH_SPACING, SPACE_ADVANCE } from '@allay/assets';
import type { BitmapFontPayload, FontPayload, FontProviderPayload, TextObject, TextOptions } from '@allay/template-sdk';
import * as THREE from 'three';
import { makeDataTexture, type LoadedFonts, type Warn } from './resources';

type BitmapProvider = Extract<FontProviderPayload, { type: 'bitmap' }>;

/** 一个字形的栅格：在字体像素坐标里的位置（相对基线，y 向下）和前进宽度 */
interface Glyph {
  advance: number;
  /** 画到 (penX + dx, baseline + dy) 处，宽 w 高 h；alpha(x, y) 取像素 */
  dx: number;
  dy: number;
  w: number;
  h: number;
  alpha(x: number, y: number): number;
  /** 这一字形在基线以上、以下占的像素（排行高用） */
  above: number;
  below: number;
}

/** 字形查找表：每个字体建一次 */
export class GlyphSource {
  private readonly bitmapIndex = new Map<number, { p: BitmapProvider; row: number; col: number; cols: number }>();
  private readonly spaces = new Map<number, number>();
  private readonly cache = new Map<number, Glyph | null>();
  readonly hasAny: boolean;

  constructor(
    private readonly vanilla: FontPayload | null,
    private readonly fallback: BitmapFontPayload | null,
  ) {
    if (vanilla) {
      for (const p of vanilla.providers) {
        if (p.type === 'space') {
          for (const [cp, adv] of p.advances) if (!this.spaces.has(cp) && !this.bitmapIndex.has(cp)) this.spaces.set(cp, adv);
          continue;
        }
        const cols = Math.max(1, ...p.rows.map((r) => r.length));
        p.rows.forEach((r, row) =>
          r.forEach((cp, col) => {
            if (cp !== 0 && !this.bitmapIndex.has(cp) && !this.spaces.has(cp)) this.bitmapIndex.set(cp, { p, row, col, cols });
          }),
        );
      }
    }
    this.hasAny = this.bitmapIndex.size > 0 || (fallback?.codepoints.length ?? 0) > 0;
  }

  /** 缺失时返回 null */
  glyph(cp: number): Glyph | null {
    let g = this.cache.get(cp);
    if (g === undefined) {
      g = this.build(cp);
      this.cache.set(cp, g);
    }
    return g;
  }

  private build(cp: number): Glyph | null {
    const space = this.spaces.get(cp);
    if (space !== undefined) return { advance: space, dx: 0, dy: 0, w: 0, h: 0, alpha: () => 0, above: 0, below: 0 };
    const hit = this.bitmapIndex.get(cp);
    if (hit) {
      const { p, row, col, cols } = hit;
      const cw = Math.floor(p.image.width / cols);
      const ch = Math.floor(p.image.height / p.rows.length);
      if (cw > 0 && ch > 0) {
        const x0 = col * cw;
        const y0 = row * ch;
        const src = (x: number, y: number) => p.image.data[((y0 + y) * p.image.width + x0 + x) * 4 + 3] ?? 0;
        // 提供器的 height 是显示高度：格子按 height / 格子高 缩放（游戏里的规则），按最近邻取样
        const scale = p.height / ch;
        const ink = glyphInkWidth(cw, ch, src);
        const w = Math.max(0, Math.round(ink * scale));
        const h = p.height;
        const advance = cp === 0x20 ? SPACE_ADVANCE : Math.floor(0.5 + ink * scale) + GLYPH_SPACING;
        return {
          advance,
          dx: 0,
          dy: -p.ascent,
          w,
          h,
          alpha: (x, y) => src(Math.min(cw - 1, Math.floor(x / scale)), Math.min(ch - 1, Math.floor(y / scale))),
          above: p.ascent,
          below: Math.max(0, h - p.ascent),
        };
      }
    }
    const f = this.fallback;
    if (f) {
      const k = findBdfGlyph(f.codepoints, cp);
      if (k >= 0) {
        const [dwidth, w, h, xoff, yoff] = [f.metrics[k * 5]!, f.metrics[k * 5 + 1]!, f.metrics[k * 5 + 2]!, f.metrics[k * 5 + 3]!, f.metrics[k * 5 + 4]!];
        const rowBytes = Math.ceil(w / 8);
        const off = f.offsets[k]!;
        return {
          advance: cp === 0x20 && w === 0 ? Math.max(dwidth, 1) : dwidth,
          dx: xoff,
          dy: -(yoff + h),
          w,
          h,
          alpha: (x, y) => ((f.bits[off + y * rowBytes + (x >> 3)]! >> (7 - (x & 7))) & 1 ? 255 : 0),
          above: f.ascent,
          below: f.descent,
        };
      }
    }
    return null;
  }
}

export function createGlyphSource(fonts: LoadedFonts): GlyphSource {
  return new GlyphSource(fonts.vanilla, fonts.fallback);
}

function isCjk(cp: number): boolean {
  return (cp >= 0x2e80 && cp <= 0x9fff) || (cp >= 0xac00 && cp <= 0xd7af) || (cp >= 0xf900 && cp <= 0xfaff) || (cp >= 0xff00 && cp <= 0xffef) || (cp >= 0x20000 && cp <= 0x3134f);
}

interface Line {
  glyphs: Glyph[];
  width: number;
}

/** 断行：显式换行；超过 maxWidth（字体像素）时在空格处断，中日韩字符可以逐字断 */
function layoutLines(text: string, source: GlyphSource, maxWidth: number, onMissing: (cp: number) => void): Line[] {
  const lines: Line[] = [];
  for (const para of text.split('\n')) {
    const cps = Array.from(para, (ch) => ch.codePointAt(0) ?? 0);
    let cur: { cp: number; g: Glyph }[] = [];
    let width = 0;
    let breakAt = -1;
    const flush = (items: { cp: number; g: Glyph }[]) => {
      // 行尾的空格不算宽度
      let end = items.length;
      while (end > 0 && items[end - 1]!.cp === 0x20) end--;
      const glyphs = items.slice(0, end).map((i) => i.g);
      lines.push({ glyphs, width: glyphs.reduce((n, g) => n + g.advance, 0) });
    };
    for (const cp of cps) {
      const g = source.glyph(cp);
      if (!g) {
        onMissing(cp);
        continue;
      }
      if (maxWidth > 0 && width + g.advance > maxWidth && cur.length > 0 && cp !== 0x20) {
        if (isCjk(cp) || breakAt < 0) {
          flush(cur);
          cur = [];
          width = 0;
          breakAt = -1;
        } else {
          const head = cur.slice(0, breakAt);
          const tail = cur.slice(breakAt + 1);
          flush(head);
          cur = tail;
          width = tail.reduce((n, i) => n + i.g.advance, 0);
          breakAt = -1;
        }
      }
      if (cp === 0x20) breakAt = cur.length;
      else if (isCjk(cp)) breakAt = -1;
      cur.push({ cp, g });
      width += g.advance;
    }
    flush(cur);
  }
  return lines;
}

/** 栅格化后的一段文字（字体像素） */
export interface RasterText {
  width: number;
  height: number;
  /** RGBA8，白色 + alpha，第一行是顶部 */
  pixels: Uint8Array;
}

export function rasterizeText(text: string, source: GlyphSource, maxWidthPx: number, align: 'left' | 'center' | 'right', onMissing: (cp: number) => void): RasterText {
  const lines = layoutLines(text, source, maxWidthPx, onMissing);
  const metrics = lines.map((l) => {
    let above = 0;
    let below = 0;
    for (const g of l.glyphs) {
      above = Math.max(above, g.above);
      below = Math.max(below, g.below);
    }
    // 空行按兜底字体或原版的常见高度（7 + 1）
    if (above === 0 && below === 0) above = 7;
    return { above, below };
  });
  const width = Math.max(1, ...lines.map((l) => l.width));
  // 行距：每行高度加 1 像素间隔（游戏的行高 9 = 8 + 1）
  const height = Math.max(1, metrics.reduce((n, m) => n + m.above + m.below, 0) + Math.max(0, lines.length - 1));
  const pixels = new Uint8Array(width * height * 4);
  let top = 0;
  lines.forEach((line, i) => {
    const m = metrics[i]!;
    const baseline = top + m.above;
    let pen = align === 'left' ? 0 : align === 'center' ? Math.floor((width - line.width) / 2) : width - line.width;
    for (const g of line.glyphs) {
      for (let y = 0; y < g.h; y++) {
        const py = baseline + g.dy + y;
        if (py < 0 || py >= height) continue;
        for (let x = 0; x < g.w; x++) {
          const px = pen + g.dx + x;
          if (px < 0 || px >= width) continue;
          const a = g.alpha(x, y);
          if (a === 0) continue;
          const o = (py * width + px) * 4;
          pixels[o] = 255;
          pixels[o + 1] = 255;
          pixels[o + 2] = 255;
          pixels[o + 3] = Math.max(pixels[o + 3]!, a);
        }
      }
      pen += g.advance;
    }
    top += m.above + m.below + 1;
  });
  return { width, height, pixels };
}

/** ctx.text.create(opts)（04-templates.md 4.5）。owned 收集这段文字自己的贴图，模板实例销毁时一起释放 */
export function createText(opts: TextOptions, source: GlyphSource, warn: Warn, owned: THREE.Texture[]): TextObject {
  if (typeof opts !== 'object' || opts === null) throw new TypeError('text options must be an object');
  const text = String(opts.text ?? '').slice(0, 10_000);
  const size = Number(opts.size);
  if (!Number.isFinite(size) || size <= 0) throw new RangeError('text size must be a positive number');
  const align = opts.align === 'center' || opts.align === 'right' ? opts.align : 'left';
  const maxWidthPx = opts.maxWidth !== undefined && Number.isFinite(opts.maxWidth) && opts.maxWidth > 0 ? Math.floor(opts.maxWidth / size) : 0;
  const color = new THREE.Color().setStyle(typeof opts.color === 'string' ? opts.color : '#ffffff', THREE.SRGBColorSpace);

  if (!source.hasAny) warn('no font is available (no vanilla layer, resource pack font or fallback font); text is not drawn');
  const missing = new Set<number>();
  const raster = rasterizeText(text, source, maxWidthPx, align, (cp) => missing.add(cp));
  if (missing.size > 0 && source.hasAny) {
    const list = [...missing].slice(0, 8).map((cp) => `U+${cp.toString(16).toUpperCase().padStart(4, '0')}`).join(', ');
    warn(`text: ${missing.size} character(s) have no glyph in any font (${list})`);
  }

  const tex = makeDataTexture(raster.width, raster.height, raster.pixels);
  // 文字一律最近邻，缩小也不平滑（2.8“像素对齐，不做平滑”）
  tex.minFilter = THREE.NearestFilter;
  tex.generateMipmaps = false;
  owned.push(tex);

  const w = raster.width * size;
  const h = raster.height * size;
  const x0 = align === 'left' ? 0 : align === 'center' ? -w / 2 : -w;
  const geometry = new THREE.PlaneGeometry(w, h);
  geometry.translate(x0 + w / 2, 0, 0);
  const group = new THREE.Group();
  const main = new THREE.MeshBasicMaterial({ map: tex, color, transparent: true, depthWrite: false });
  const body = new THREE.Mesh(geometry, main);
  let shadowMat: THREE.MeshBasicMaterial | null = null;
  if (opts.shadow) {
    // 阴影颜色：正文颜色各通道 × 0.25（sRGB 空间，和游戏一样）
    const srgb = { r: 0, g: 0, b: 0 };
    color.getRGB(srgb, THREE.SRGBColorSpace);
    const shadowColor = new THREE.Color().setRGB(srgb.r * 0.25, srgb.g * 0.25, srgb.b * 0.25, THREE.SRGBColorSpace);
    shadowMat = new THREE.MeshBasicMaterial({ map: tex, color: shadowColor, transparent: true, depthWrite: false });
    const shadow = new THREE.Mesh(geometry.clone(), shadowMat);
    shadow.position.set(size, -size, -0.001);
    group.add(shadow);
  }
  group.add(body);
  return {
    object: group,
    width: w,
    height: h,
    setOpacity(a) {
      const v = Math.min(1, Math.max(0, Number.isFinite(a) ? a : 0));
      main.opacity = v;
      if (shadowMat) shadowMat.opacity = v;
    },
  };
}
