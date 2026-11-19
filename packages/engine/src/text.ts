// 文字（docs/02-engine.md 2.8、03-assets.md 3.9）：位图字，像素对齐，不做平滑。
// 字形来源按字体族（font 参数，4.4）：资源栈里的字体（bitmap、space、unihex 提供器）、用户导入的 BDF；
// 找不到的字形依次退回 minecraft:default 和系统字体（SystemGlyphs）。整段用系统字体、用户导入的矢量字体另走 vector-text.ts。
//
// 一段文字栅格化成一张贴图、按行配四边形。为了表示游戏里的半像素（Unifont 画成一半大小、它的阴影和粗体只偏 0.5 像素），
// 栅格在“子像素”上做：一个字体像素 = SUB × SUB 个子像素。阴影、描边、粗体、下划线、删除线都直接画进贴图（颜色也烘进去），
// 和游戏一样逐字形按各自的偏移量画；斜体是把每一行的四边形错切，和游戏错切字形四边形的做法相同。
import { findBdfGlyph, glyphInkWidth, GLYPH_SPACING, SPACE_ADVANCE } from '@allay/assets';
import type { BitmapFontPayload, FontPayload, FontProviderPayload, FontStyle, TextObject, TextOptions } from '@allay/template-sdk';
import * as THREE from 'three';
import { makeDataTexture, type Warn } from './resources';

/** 一个字体像素的子像素数 */
export const SUB = 2;

type BitmapProvider = Extract<FontProviderPayload, { type: 'bitmap' }>;
type TableProvider = Pick<BitmapFontPayload, 'ascent' | 'descent' | 'oversample' | 'codepoints' | 'metrics' | 'offsets' | 'bits'>;

/** 一个字形，单位都是子像素：画在 (笔位 + dx, 基线 + dy) 处，宽 w 高 h；y 向下 */
export interface Glyph {
  advance: number;
  dx: number;
  dy: number;
  w: number;
  h: number;
  alpha(x: number, y: number): number;
  /** 基线以上、以下占的子像素（排行高用） */
  above: number;
  below: number;
  /** 阴影、粗体、描边的偏移（子像素）：位图字 1 个字体像素，Unifont 半个 */
  offset: number;
}

/** 一种字形来源：资源栈字体的一个提供器、一张 BDF / Unifont 字形表 */
interface Provider {
  glyph(cp: number): Glyph | null | undefined;
  readonly size: number;
}

class SpaceProvider implements Provider {
  constructor(private readonly advances: Map<number, number>) {}
  get size() {
    return this.advances.size;
  }
  glyph(cp: number): Glyph | undefined {
    const adv = this.advances.get(cp);
    if (adv === undefined) return undefined;
    return { advance: Math.round(adv * SUB), dx: 0, dy: 0, w: 0, h: 0, alpha: () => 0, above: 0, below: 0, offset: SUB };
  }
}

class BitmapSheet implements Provider {
  private readonly index = new Map<number, { row: number; col: number }>();
  private readonly cols: number;
  constructor(private readonly p: BitmapProvider) {
    this.cols = Math.max(1, ...p.rows.map((r) => r.length));
    p.rows.forEach((r, row) =>
      r.forEach((cp, col) => {
        if (cp !== 0 && !this.index.has(cp)) this.index.set(cp, { row, col });
      }),
    );
  }
  get size() {
    return this.index.size;
  }
  glyph(cp: number): Glyph | undefined {
    const hit = this.index.get(cp);
    if (!hit) return undefined;
    const p = this.p;
    const cw = Math.floor(p.image.width / this.cols);
    const ch = Math.floor(p.image.height / p.rows.length);
    if (cw <= 0 || ch <= 0) return undefined;
    const x0 = hit.col * cw;
    const y0 = hit.row * ch;
    const src = (x: number, y: number) => p.image.data[((y0 + y) * p.image.width + x0 + x) * 4 + 3] ?? 0;
    // 提供器的 height 是显示高度：格子按 height / 格子高 缩放（游戏里的规则），按最近邻取样
    const scale = p.height / ch;
    const ink = glyphInkWidth(cw, ch, src);
    const w = Math.max(0, Math.round(ink * scale));
    const advance = cp === 0x20 ? SPACE_ADVANCE : Math.floor(0.5 + ink * scale) + GLYPH_SPACING;
    const k = scale * SUB;
    return {
      advance: advance * SUB,
      dx: 0,
      dy: -p.ascent * SUB,
      w: w * SUB,
      h: p.height * SUB,
      alpha: (x, y) => src(Math.min(cw - 1, Math.floor(x / k)), Math.min(ch - 1, Math.floor(y / k))),
      above: p.ascent * SUB,
      below: Math.max(0, p.height - p.ascent) * SUB,
      offset: SUB,
    };
  }
}

/** BDF 和 Unifont 的定长字形表。oversample 个表像素 = 1 个字体像素 */
class GlyphTable implements Provider {
  constructor(private readonly f: TableProvider) {}
  get size() {
    return this.f.codepoints.length;
  }
  glyph(cp: number): Glyph | undefined {
    const f = this.f;
    const k = findBdfGlyph(f.codepoints, cp);
    if (k < 0) return undefined;
    const os = f.oversample ?? 1;
    // 一个表像素占几个子像素（Unifont 1 个，BDF 2 个）
    const s = SUB / os;
    const [dwidth, w, h, xoff, yoff] = [f.metrics[k * 5]!, f.metrics[k * 5 + 1]!, f.metrics[k * 5 + 2]!, f.metrics[k * 5 + 3]!, f.metrics[k * 5 + 4]!];
    const rowBytes = Math.ceil(w / 8);
    const off = f.offsets[k]!;
    const advance = cp === 0x20 && w === 0 && os === 1 ? Math.max(dwidth, 1) : dwidth;
    return {
      advance: advance * s,
      dx: xoff * s,
      dy: -(yoff + h) * s,
      w: w * s,
      h: h * s,
      alpha: (x, y) => {
        const px = Math.floor(x / s);
        const py = Math.floor(y / s);
        return (f.bits[off + py * rowBytes + (px >> 3)]! >> (7 - (px & 7))) & 1 ? 255 : 0;
      },
      above: f.ascent * s,
      below: f.descent * s,
      offset: s,
    };
  }
}

/**
 * 系统字体的 CSS 字体栈（没有原版字体、或原版字体里没有某个字形时的兜底）。
 * 结果取决于这台机器装了哪些字体：同一台机器上预览和导出走同一条路径、逐帧一致，换机器可能不同（decisions.md）。
 */
export const SYSTEM_FONT_STACK = '"Microsoft YaHei", "PingFang SC", "Noto Sans CJK SC", "Noto Sans SC", "Source Han Sans SC", sans-serif';

/** 系统字体的单个字形：一个 em = 8 个字体像素（与 Unifont 的字形同高），基线在格子顶下 7 个字体像素 */
const SYS_EM = 8 * SUB;
const SYS_BASELINE = 7 * SUB;
const SYS_CELL_H = 10 * SUB;

/**
 * 原版字体里缺的字形，用系统字体在 OffscreenCanvas 上按子像素画出来，再按 alpha ≥ 50% 二值化，
 * 和位图字一样是硬边像素（混排时不会一半糊一半锐）。阴影和粗体偏移同 Unifont（半个字体像素）。
 * Worker 里没有 2D 画布时这个来源什么都没有，缺的字形照常报警告。
 */
export class SystemGlyphs implements Provider {
  private readonly g: OffscreenCanvasRenderingContext2D | null;
  private readonly canvas: OffscreenCanvas | null;
  constructor() {
    const canvas = typeof OffscreenCanvas === 'function' ? new OffscreenCanvas(4 * SYS_EM, SYS_CELL_H) : null;
    const g = canvas?.getContext('2d', { willReadFrequently: true }) ?? null;
    if (g) {
      g.font = `${SYS_EM}px ${SYSTEM_FONT_STACK}`;
      g.textBaseline = 'alphabetic';
      g.fillStyle = '#FFFFFF';
    }
    this.canvas = canvas;
    this.g = g;
  }
  get size() {
    return this.g ? 1 : 0;
  }
  glyph(cp: number): Glyph | undefined {
    const g = this.g;
    if (!g || !this.canvas || cp < 0x20 || (cp >= 0x7f && cp < 0xa0)) return undefined;
    const ch = String.fromCodePoint(cp);
    const width = g.measureText(ch).width;
    if (!(width > 0)) return undefined;
    const W = this.canvas.width;
    g.clearRect(0, 0, W, SYS_CELL_H);
    g.fillText(ch, SUB, SYS_BASELINE);
    const data = g.getImageData(0, 0, W, SYS_CELL_H).data;
    let right = -1;
    let left = W;
    for (let y = 0; y < SYS_CELL_H; y++) {
      for (let x = 0; x < W; x++) {
        if (data[(y * W + x) * 4 + 3]! >= 128) {
          if (x < left) left = x;
          if (x > right) right = x;
        }
      }
    }
    // 前进宽度：量出的宽度向上取整到整字体像素，加 1 像素字间距（中文 8 + 1 = 9，与游戏的 Unifont 字形一致）
    const advance = (Math.ceil(width / SUB) + (cp === 0x20 ? 0 : GLYPH_SPACING)) * SUB;
    if (right < 0) return { advance, dx: 0, dy: 0, w: 0, h: 0, alpha: () => 0, above: 0, below: 0, offset: 1 };
    const w = right - left + 1;
    const mask = new Uint8Array(w * SYS_CELL_H);
    for (let y = 0; y < SYS_CELL_H; y++) for (let x = 0; x < w; x++) mask[y * w + x] = data[(y * W + left + x) * 4 + 3]! >= 128 ? 255 : 0;
    return {
      advance,
      dx: left - SUB,
      dy: -SYS_BASELINE,
      w,
      h: SYS_CELL_H,
      alpha: (x, y) => mask[y * w + x] ?? 0,
      above: SYS_BASELINE,
      below: SUB,
      offset: 1,
    };
  }
}

/** 一个字体族的字形查找：按提供器顺序第一个有这个码位的胜出，再退回后备链 */
export class GlyphSource {
  private readonly cache = new Map<number, Glyph | null>();
  readonly hasAny: boolean;

  constructor(
    private readonly providers: readonly Provider[],
    private readonly fallbacks: readonly GlyphSource[] = [],
  ) {
    this.hasAny = providers.some((p) => p.size > 0) || fallbacks.some((f) => f.hasAny);
  }

  /** 这个字体族自己（不含后备）有没有字形 */
  get ownGlyphs(): boolean {
    return this.providers.some((p) => p.size > 0);
  }

  /** 缺失时返回 null */
  glyph(cp: number): Glyph | null {
    let g = this.cache.get(cp);
    if (g === undefined) {
      g = null;
      for (const p of this.providers) {
        const hit = p.glyph(cp);
        if (hit) {
          g = hit;
          break;
        }
      }
      if (!g) for (const f of this.fallbacks) if ((g = f.glyph(cp))) break;
      this.cache.set(cp, g);
    }
    return g;
  }
}

/** 资源栈字体（展开后的提供器列表）的字形来源 */
export function stackGlyphSource(font: FontPayload | null, fallbacks: readonly GlyphSource[] = []): GlyphSource {
  const providers: Provider[] = [];
  for (const p of font?.providers ?? []) {
    if (p.type === 'space') providers.push(new SpaceProvider(new Map(p.advances)));
    else if (p.type === 'bitmap') providers.push(new BitmapSheet(p));
    else providers.push(new GlyphTable(p));
  }
  return new GlyphSource(providers, fallbacks);
}

/** BDF 字体（用户导入的 BDF）的字形来源 */
export function tableGlyphSource(table: BitmapFontPayload | null, fallbacks: readonly GlyphSource[] = []): GlyphSource {
  return new GlyphSource(table ? [new GlyphTable(table)] : [], fallbacks);
}

/** 系统字体字形的来源（整个 Worker 共用一个画布） */
let systemGlyphs: GlyphSource | null = null;
export function systemGlyphSource(): GlyphSource {
  systemGlyphs ??= new GlyphSource([new SystemGlyphs()]);
  return systemGlyphs;
}

/** minecraft:default，缺的字形退回系统字体 */
export function createGlyphSource(vanilla: FontPayload | null): GlyphSource {
  return stackGlyphSource(vanilla, [systemGlyphSource()]);
}

function isCjk(cp: number): boolean {
  return (cp >= 0x2e80 && cp <= 0x9fff) || (cp >= 0xac00 && cp <= 0xd7af) || (cp >= 0xf900 && cp <= 0xfaff) || (cp >= 0xff00 && cp <= 0xffef) || (cp >= 0x20000 && cp <= 0x3134f);
}

/** 解析好的文字样式 */
export interface ResolvedStyle {
  bold: boolean;
  italic: boolean;
  underline: boolean;
  strikethrough: boolean;
  shadow: boolean;
  /** 描边颜色；null 不描边 */
  outline: string | null;
}

const OUTLINE_RE = /^#[0-9a-fA-F]{6}$/;

/** 合并 TextOptions 的样式字段和 font 对象（对象里写了的优先） */
export function resolveStyle(opts: TextOptions): { family: string | null; style: ResolvedStyle } {
  const font: Partial<FontStyle> = typeof opts.font === 'object' && opts.font !== null ? opts.font : {};
  const family = typeof opts.font === 'string' ? opts.font : typeof font.family === 'string' ? font.family : null;
  const pick = (k: 'bold' | 'italic' | 'underline' | 'strikethrough' | 'shadow'): boolean => (typeof font[k] === 'boolean' ? font[k] : opts[k] === true);
  const outlineRaw = font.outline !== undefined ? font.outline : opts.outline;
  return {
    family,
    style: {
      bold: pick('bold'),
      italic: pick('italic'),
      underline: pick('underline'),
      strikethrough: pick('strikethrough'),
      shadow: pick('shadow'),
      outline: typeof outlineRaw === 'string' && OUTLINE_RE.test(outlineRaw) ? outlineRaw : null,
    },
  };
}

interface Placed {
  g: Glyph;
  x: number;
}

interface Line {
  glyphs: Placed[];
  /** 子像素 */
  width: number;
  above: number;
  below: number;
}

/** 前进宽度（子像素）：粗体加上它的偏移（游戏的 getAdvance(bold)） */
const advanceOf = (g: Glyph, bold: boolean) => g.advance + (bold ? g.offset : 0);

/** 断行：显式换行；超过 maxWidth（子像素）时在空格处断，中日韩字符可以逐字断 */
function layoutLines(text: string, source: GlyphSource, maxWidth: number, bold: boolean, onMissing: (cp: number) => void): Line[] {
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
      const glyphs: Placed[] = [];
      let x = 0;
      let above = 0;
      let below = 0;
      for (const it of items.slice(0, end)) {
        glyphs.push({ g: it.g, x });
        x += advanceOf(it.g, bold);
        above = Math.max(above, it.g.above);
        below = Math.max(below, it.g.below);
      }
      // 空行按原版的常见高度（7 + 1）
      if (above === 0 && below === 0) {
        above = 7 * SUB;
        below = 1 * SUB;
      }
      lines.push({ glyphs, width: x, above, below });
    };
    for (const cp of cps) {
      const g = source.glyph(cp);
      if (!g) {
        onMissing(cp);
        continue;
      }
      const adv = advanceOf(g, bold);
      if (maxWidth > 0 && width + adv > maxWidth && cur.length > 0 && cp !== 0x20) {
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
          width = tail.reduce((n, i) => n + advanceOf(i.g, bold), 0);
          breakAt = -1;
        }
      }
      if (cp === 0x20) breakAt = cur.length;
      else if (isCjk(cp)) breakAt = -1;
      cur.push({ cp, g });
      width += adv;
    }
    flush(cur);
  }
  return lines;
}

/** 栅格化后的一段文字 */
export interface RasterText {
  /** 内容框（不含阴影、描边的外扩），子像素 */
  width: number;
  height: number;
  /** 贴图四周为阴影、描边、下划线外扩留的边（子像素） */
  pad: number;
  /** RGBA8（sRGB，直通 alpha），第一行是顶部；尺寸 (width + 2 pad) × (height + 2 pad) */
  pixels: Uint8Array;
  /** 每一行在内容框里的基线位置和上下边界（子像素，从内容框顶部算），斜体错切用 */
  lines: { baseline: number; top: number; bottom: number }[];
}

type Rgb = [number, number, number];

function parseRgb(color: string): Rgb {
  const m = /^#?([0-9a-fA-F]{6})/.exec(color);
  const v = m ? Number.parseInt(m[1]!, 16) : 0xffffff;
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
}

/**
 * 栅格化。color 是正文颜色；阴影颜色按游戏取正文各通道的 1/4（向下取整）；有描边时不画阴影（发光告示牌的做法）。
 * 字形和效果线都画进 alpha 遮罩，再按“正文盖在阴影或描边上”合成。
 */
export function rasterizeText(
  text: string,
  source: GlyphSource,
  maxWidthPx: number,
  align: 'left' | 'center' | 'right',
  onMissing: (cp: number) => void,
  style: ResolvedStyle = { bold: false, italic: false, underline: false, strikethrough: false, shadow: false, outline: null },
  color = '#FFFFFF',
): RasterText {
  const lines = layoutLines(text, source, maxWidthPx * SUB, style.bold, onMissing);
  const width = Math.max(1, ...lines.map((l) => l.width));
  // 行距：每行高度加 1 字体像素的间隔（游戏的行高 9 = 8 + 1）
  const height = Math.max(1, lines.reduce((n, l) => n + l.above + l.below, 0) + Math.max(0, lines.length - 1) * SUB);
  const pad = 2 * SUB;
  const W = width + 2 * pad;
  const H = height + 2 * pad;
  const layout: { baseline: number; top: number; bottom: number }[] = [];
  let top = 0;
  for (const l of lines) {
    layout.push({ baseline: top + l.above, top, bottom: top + l.above + l.below });
    top += l.above + l.below + SUB;
  }

  // 把全部字形（含粗体的第二遍、效果线）按每字形 k × offset 的偏移画进遮罩
  const paint = (mask: Uint8Array, kx: number, ky: number) => {
    lines.forEach((line, i) => {
      const baseline = pad + layout[i]!.baseline;
      const x0 = pad + (align === 'left' ? 0 : align === 'center' ? Math.floor((width - line.width) / 2 / SUB) * SUB : width - line.width);
      for (const { g, x } of line.glyphs) {
        const ox = x0 + x + kx * g.offset;
        const oy = baseline + ky * g.offset;
        const passes = style.bold ? 2 : 1;
        for (let pass = 0; pass < passes; pass++) {
          const bx = ox + g.dx + pass * g.offset;
          for (let y = 0; y < g.h; y++) {
            const py = oy + g.dy + y;
            if (py < 0 || py >= H) continue;
            for (let xx = 0; xx < g.w; xx++) {
              const px = bx + xx;
              if (px < 0 || px >= W) continue;
              const a = g.alpha(xx, y);
              if (a > mask[py * W + px]!) mask[py * W + px] = a;
            }
          }
        }
        // 效果线（游戏的 Effect）：从字形左边 1 个字体像素到前进宽度末尾；删除线在基线上方 3.5–2.5，下划线在基线下方 1–2
        const adv = advanceOf(g, style.bold);
        const fill = (y0: number, y1: number) => {
          for (let py = Math.max(0, y0); py < Math.min(H, y1); py++) for (let px = Math.max(0, ox - SUB); px < Math.min(W, ox + adv); px++) mask[py * W + px] = 255;
        };
        const ey = baseline + ky * SUB;
        if (style.strikethrough) fill(ey - 3.5 * SUB, ey - 2.5 * SUB);
        if (style.underline) fill(ey + 1 * SUB, ey + 2 * SUB);
      }
    });
  };

  const main = new Uint8Array(W * H);
  paint(main, 0, 0);
  let under: Uint8Array | null = null;
  const textRgb = parseRgb(color);
  let underRgb: Rgb = [0, 0, 0];
  if (style.outline) {
    under = new Uint8Array(W * H);
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (dx !== 0 || dy !== 0) paint(under, dx, dy);
    underRgb = parseRgb(style.outline);
  } else if (style.shadow) {
    under = new Uint8Array(W * H);
    paint(under, 1, 1);
    underRgb = [textRgb[0] >> 2, textRgb[1] >> 2, textRgb[2] >> 2];
  }

  const pixels = new Uint8Array(W * H * 4);
  for (let i = 0; i < W * H; i++) {
    const am = main[i]! / 255;
    const au = under ? under[i]! / 255 : 0;
    const a = am + au * (1 - am);
    if (a <= 0) continue;
    const o = i * 4;
    for (let c = 0; c < 3; c++) pixels[o + c] = Math.round((textRgb[c]! * am + underRgb[c]! * au * (1 - am)) / a);
    pixels[o + 3] = Math.round(a * 255);
  }
  return { width, height, pad, pixels, lines: layout };
}

/**
 * 斜体的错切：游戏把字形四边形的顶边右移 1 − 0.25 × 上沿、底边右移 1 − 0.25 × 下沿（相对行的 y，ascii 的格子顶在 y 处、基线在 y + 7）。
 * 换成相对基线：右移量 = −0.75 − 0.25 × (相对基线的 y)，字体像素，y 向下。
 */
export const italicShift = (yFromBaseline: number): number => -0.75 - 0.25 * yFromBaseline;

/**
 * 把栅格好的文字做成网格：没有斜体时一个四边形；有斜体时每行一个按 italicShift 错切的四边形（行之间在间隔正中分界）。
 * 原点：水平方向按 align（内容框的左边、中点、右边），垂直方向在内容框的中线。
 */
export function textGeometry(raster: RasterText, unit: number, align: 'left' | 'center' | 'right', italic: boolean): THREE.BufferGeometry {
  const { width, height, pad } = raster;
  const W = width + 2 * pad;
  const H = height + 2 * pad;
  const u = unit / SUB; // 每个子像素的设计单位
  const cx = align === 'left' ? 0 : align === 'center' ? -width / 2 : -width;
  // 内容框左上角在 (cx·u, height·u/2)，贴图左上角再往外 pad
  const X = (sx: number) => (cx - pad + sx) * u;
  const Y = (sy: number) => (height / 2 + pad - sy) * u;
  const bands: { y0: number; y1: number; baseline: number }[] = [];
  if (!italic) bands.push({ y0: 0, y1: H, baseline: 0 });
  else {
    raster.lines.forEach((l, i) => {
      const next = raster.lines[i + 1];
      const y0 = i === 0 ? 0 : bands[i - 1]!.y1;
      const y1 = next ? pad + Math.round((l.bottom + next.top) / 2) : H;
      bands.push({ y0, y1, baseline: pad + l.baseline });
    });
  }
  const pos: number[] = [];
  const uv: number[] = [];
  const index: number[] = [];
  for (const b of bands) {
    const shift = (sy: number) => (italic ? italicShift((sy - b.baseline) / SUB) * unit : 0);
    const base = pos.length / 3;
    // 左上、左下、右下、右上
    const corners: [number, number][] = [
      [0, b.y0],
      [0, b.y1],
      [W, b.y1],
      [W, b.y0],
    ];
    for (const [sx, sy] of corners) {
      pos.push(X(sx) + shift(sy), Y(sy), 0);
      // 贴图第一行是顶部（makeDataTexture 在 CPU 上翻过，v = 1 是顶部）
      uv.push(sx / W, 1 - sy / H);
    }
    index.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geometry.setIndex(index);
  return geometry;
}

/** 文字对象的公共部分：一张贴图、一个网格，不透明度改材质 */
export function textObjectFrom(tex: THREE.Texture, geometry: THREE.BufferGeometry, width: number, height: number): TextObject {
  const material = new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false });
  const group = new THREE.Group();
  group.add(new THREE.Mesh(geometry, material));
  return {
    object: group,
    width,
    height,
    setOpacity(a) {
      material.opacity = Math.min(1, Math.max(0, Number.isFinite(a) ? a : 0));
    },
  };
}

/** 位图文字的公共参数检查 */
export function readTextOptions(opts: TextOptions): { text: string; size: number; align: 'left' | 'center' | 'right'; maxWidthPx: number; color: string } {
  if (typeof opts !== 'object' || opts === null) throw new TypeError('text options must be an object');
  const text = String(opts.text ?? '').slice(0, 10_000);
  const size = Number(opts.size);
  if (!Number.isFinite(size) || size <= 0) throw new RangeError('text size must be a positive number');
  const align = opts.align === 'center' || opts.align === 'right' ? opts.align : 'left';
  const maxWidthPx = opts.maxWidth !== undefined && Number.isFinite(opts.maxWidth) && opts.maxWidth > 0 ? Math.floor(opts.maxWidth / size) : 0;
  const color = typeof opts.color === 'string' && /^#[0-9a-fA-F]{6}/.test(opts.color) ? opts.color.slice(0, 7) : '#FFFFFF';
  return { text, size, align, maxWidthPx, color };
}

/** ctx.text.create(opts)（04-templates.md 4.5），位图字体。owned 收集这段文字自己的贴图，模板实例销毁时一起释放 */
export function createText(opts: TextOptions, source: GlyphSource, warn: Warn, owned: THREE.Texture[], style?: ResolvedStyle): TextObject {
  const { text, size, align, maxWidthPx, color } = readTextOptions(opts);
  const st = style ?? resolveStyle(opts).style;

  if (!source.hasAny) warn('no font is available (no vanilla layer, resource pack font or fallback font); text is not drawn');
  const missing = new Set<number>();
  const raster = rasterizeText(text, source, maxWidthPx, align, (cp) => missing.add(cp), st, color);
  if (missing.size > 0 && source.hasAny) {
    const list = [...missing].slice(0, 8).map((cp) => `U+${cp.toString(16).toUpperCase().padStart(4, '0')}`).join(', ');
    warn(`text: ${missing.size} character(s) have no glyph in any font (${list})`);
  }

  const tex = makeDataTexture(raster.width + 2 * raster.pad, raster.height + 2 * raster.pad, raster.pixels);
  // 文字一律最近邻，缩小也不平滑（2.8“像素对齐，不做平滑”）
  tex.minFilter = THREE.NearestFilter;
  tex.generateMipmaps = false;
  owned.push(tex);
  const geometry = textGeometry(raster, size, align, st.italic);
  return textObjectFrom(tex, geometry, (raster.width / SUB) * size, (raster.height / SUB) * size);
}
