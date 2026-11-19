// 原版字体提供器的解析（docs/03-assets.md 3.9）：bitmap、space、reference、unihex 四种。
// ttf 和 legacy_unicode 不解析，记下来让调用方报告；找不到的字形回退到内置像素字体（M2b）。
// 提供器和 reference 上的 filter（1.20 起，对应“强制使用 Unicode 字体”“日文字形变体”两个选项）按游戏默认（都关）处理：
// 要求 uniform 或 jp 为 true 的跳过，要求为 false 的保留。
import type { BitmapFontTables } from './bdf';
import { fontIdToPath, fontTextureToPath, normalizeResourceId, parseResourceId } from './ids';

/** unihex 的 hex_file：`minecraft:font/unifont.zip` → `assets/minecraft/font/unifont.zip`（不在 textures 下） */
export function hexFileToPath(file: string): string | null {
  const parsed = parseResourceId(file);
  return parsed && parsed.path.endsWith('.zip') ? `assets/${parsed.namespace}/${parsed.path}` : null;
}

/** filter 里的选项按游戏默认值（都关）判断：要求开着的提供器不用 */
function filterPasses(raw: Record<string, unknown>): boolean {
  const f = raw.filter;
  if (typeof f !== 'object' || f === null) return true;
  for (const [key, want] of Object.entries(f as Record<string, unknown>)) {
    if ((key === 'uniform' || key === 'jp') && want === true) return false;
  }
  return true;
}

/** 字间距 1 像素，空格宽 4 像素（3.9） */
export const GLYPH_SPACING = 1;
export const SPACE_ADVANCE = 4;

export interface BitmapProvider {
  type: 'bitmap';
  /** 贴图文件在资源包里的路径 */
  file: string;
  ascent: number;
  height: number;
  /** 每行一串字符，按码位拆开；U+0000 表示空格子 */
  rows: number[][];
}

export interface SpaceProvider {
  type: 'space';
  advances: Map<number, number>;
}

/** Unifont 的 .hex 字形（1.20 起游戏里中日韩等字形的来源）。file 是 zip 在资源包里的路径 */
export interface UnihexProvider {
  type: 'unihex';
  file: string;
  /** 指定码位范围的字形左右边界（列，含两端），代替按墨迹算出的宽度 */
  overrides: UnihexOverride[];
}

export interface UnihexOverride {
  from: number;
  to: number;
  left: number;
  right: number;
}

export type FontProvider = BitmapProvider | SpaceProvider | UnihexProvider;

export interface ParsedFont {
  providers: FontProvider[];
  /** reference 提供器引用的字体 ID，按出现顺序 */
  references: { index: number; id: string }[];
  /** 跳过的提供器类型（unihex、ttf、认不出的） */
  skipped: string[];
}

function codepoints(s: string): number[] {
  return Array.from(s, (ch) => ch.codePointAt(0) ?? 0);
}

/** 解析一个字体定义 JSON。提供器的顺序保持不变；reference 在 references 里记下插入位置 */
export function parseFontJson(text: string): ParsedFont {
  const out: ParsedFont = { providers: [], references: [], skipped: [] };
  let root: unknown;
  try {
    root = JSON.parse(text.replace(/^\uFEFF/, ''));
  } catch {
    out.skipped.push('invalid-json');
    return out;
  }
  const list = typeof root === 'object' && root !== null && Array.isArray((root as { providers?: unknown }).providers) ? (root as { providers: unknown[] }).providers : [];
  for (const raw of list) {
    if (typeof raw !== 'object' || raw === null) continue;
    const p = raw as Record<string, unknown>;
    if (!filterPasses(p)) continue;
    switch (p.type) {
      case 'bitmap': {
        const file = typeof p.file === 'string' ? fontTextureToPath(p.file) : null;
        const chars = Array.isArray(p.chars) && p.chars.every((c) => typeof c === 'string') ? (p.chars as string[]) : null;
        const ascent = typeof p.ascent === 'number' && Number.isFinite(p.ascent) ? Math.trunc(p.ascent) : null;
        const height = typeof p.height === 'number' && Number.isFinite(p.height) && p.height > 0 ? Math.trunc(p.height) : 8;
        if (!file || !chars || ascent === null || chars.length === 0) {
          out.skipped.push('bitmap(invalid)');
          break;
        }
        out.providers.push({ type: 'bitmap', file, ascent, height, rows: chars.map(codepoints) });
        break;
      }
      case 'space': {
        const advances = new Map<number, number>();
        if (typeof p.advances === 'object' && p.advances !== null) {
          for (const [ch, adv] of Object.entries(p.advances as Record<string, unknown>)) {
            const cps = codepoints(ch);
            if (cps.length === 1 && typeof adv === 'number' && Number.isFinite(adv)) advances.set(cps[0] ?? 0, adv);
          }
        }
        out.providers.push({ type: 'space', advances });
        break;
      }
      case 'unihex': {
        const file = typeof p.hex_file === 'string' ? hexFileToPath(p.hex_file) : null;
        if (!file) {
          out.skipped.push('unihex(invalid)');
          break;
        }
        const overrides: UnihexOverride[] = [];
        if (Array.isArray(p.size_overrides)) {
          for (const o of p.size_overrides as unknown[]) {
            if (typeof o !== 'object' || o === null) continue;
            const r = o as Record<string, unknown>;
            const from = typeof r.from === 'string' ? codepoints(r.from) : [];
            const to = typeof r.to === 'string' ? codepoints(r.to) : [];
            if (from.length !== 1 || to.length !== 1 || typeof r.left !== 'number' || typeof r.right !== 'number') continue;
            overrides.push({ from: from[0]!, to: to[0]!, left: Math.trunc(r.left), right: Math.trunc(r.right) });
          }
        }
        out.providers.push({ type: 'unihex', file, overrides: overrides.slice(0, 1024) });
        break;
      }
      case 'reference': {
        const id = typeof p.id === 'string' ? normalizeResourceId(p.id) : null;
        if (id) out.references.push({ index: out.providers.length, id });
        else out.skipped.push('reference(invalid)');
        break;
      }
      default:
        out.skipped.push(typeof p.type === 'string' ? p.type : 'unknown');
    }
  }
  return out;
}

/**
 * 展开 reference，得到扁平的提供器列表。loadFont 按字体 ID 取各层合并后的定义（上层在前），
 * 找不到时返回 null。带环检测和深度上限。
 */
export async function resolveFontProviders(
  fontId: string,
  loadFont: (path: string) => Promise<ParsedFont[] | null>,
): Promise<{ providers: FontProvider[]; skipped: string[] }> {
  const providers: FontProvider[] = [];
  const skipped: string[] = [];
  const visit = async (id: string, stack: string[]): Promise<void> => {
    if (stack.includes(id) || stack.length > 8) {
      skipped.push(`reference-cycle(${id})`);
      return;
    }
    const path = fontIdToPath(id);
    const fonts = path ? await loadFont(path) : null;
    if (!fonts) {
      skipped.push(`missing(${id})`);
      return;
    }
    for (const font of fonts) {
      skipped.push(...font.skipped);
      let refIdx = 0;
      for (let i = 0; i <= font.providers.length; i++) {
        while (refIdx < font.references.length && font.references[refIdx]?.index === i) {
          const ref = font.references[refIdx];
          if (ref) await visit(ref.id, [...stack, id]);
          refIdx++;
        }
        const p = font.providers[i];
        if (p) providers.push(p);
      }
    }
  };
  await visit(normalizeResourceId(fontId) ?? fontId, []);
  return { providers, skipped };
}

export interface BitmapGlyph {
  kind: 'bitmap';
  file: string;
  /** 格子在贴图里的行列 */
  row: number;
  col: number;
  rows: number;
  cols: number;
  ascent: number;
  height: number;
}

export type GlyphSource = BitmapGlyph | { kind: 'space'; advance: number };

/** 某个码位由哪个提供器提供：按列表顺序第一个有它的胜出 */
export function findGlyph(providers: readonly FontProvider[], codepoint: number): GlyphSource | null {
  if (codepoint === 0) return null;
  for (const p of providers) {
    if (p.type === 'space') {
      const adv = p.advances.get(codepoint);
      if (adv !== undefined) return { kind: 'space', advance: adv };
      continue;
    }
    // unihex 的字形表要先从 zip 里读出来，这里只看提供器定义，不知道它有哪些码位
    if (p.type === 'unihex') continue;
    for (let row = 0; row < p.rows.length; row++) {
      const col = p.rows[row]?.indexOf(codepoint) ?? -1;
      if (col >= 0) {
        const cols = Math.max(...p.rows.map((r) => r.length));
        return { kind: 'bitmap', file: p.file, row, col, rows: p.rows.length, cols, ascent: p.ascent, height: p.height };
      }
    }
  }
  return null;
}

/**
 * 字形宽度：该格子里最右侧不透明像素列 + 1（3.9）。整格透明时为 0。
 * alphaAt 读格子内 (x, y) 的不透明度（0–255）。
 */
export function glyphInkWidth(cellWidth: number, cellHeight: number, alphaAt: (x: number, y: number) => number): number {
  for (let x = cellWidth - 1; x >= 0; x--) {
    for (let y = 0; y < cellHeight; y++) if (alphaAt(x, y) > 0) return x + 1;
  }
  return 0;
}

/** 前进宽度（未缩放的字体像素）：字形宽度加字间距；空格固定 4 */
export function glyphAdvance(codepoint: number, inkWidth: number): number {
  if (codepoint === 0x20) return SPACE_ADVANCE;
  return inkWidth + GLYPH_SPACING;
}

// ---- Unifont（unihex 提供器）----
//
// .hex 每行“码位:位图”，位图 16 行；宽 8、12、16、24 列时分别是 32、48、64、96 个十六进制数字，按行从上到下，每行最高位在左。
// 游戏的做法（UnihexProvider）：字形取有墨迹的最左到最右一列（size_overrides 覆盖这两列），画成一半大小
// （2 个 Unifont 像素 = 1 个字体像素），前进宽度 floor(列数 / 2) + 1 个字体像素，阴影和粗体偏移 0.5 个字体像素，
// 顶边与 ascii 格子的顶边对齐（基线以上 7 个字体像素，即第 14 行之下是基线）。
// 解析成和 BDF 一样的定长表，度量单位是 Unifont 像素（oversample = 2）：上升 14、下降 2，前进宽度存成 2 × (floor(列数 / 2) + 1)。

/** Unifont 的像素与字体像素之比 */
export const UNIHEX_OVERSAMPLE = 2;
const UNIHEX_ROWS = 16;
const UNIHEX_ASCENT = 14;
const UNIHEX_DESCENT = 2;
/** 单个 .hex 字形表的码位数上限（Unifont 全集约 6 万） */
const UNIHEX_MAX_GLYPHS = 200_000;

export interface UnihexTables extends BitmapFontTables {
  /** 表里几个像素对应一个字体像素 */
  oversample: number;
}

const hexDigit = (c: number): number => (c >= 48 && c <= 57 ? c - 48 : c >= 65 && c <= 70 ? c - 55 : c >= 97 && c <= 102 ? c - 87 : -1);

/**
 * 解析若干个 .hex 文件的文本（按给出的顺序，同一码位先出现的胜出）。格式不对的行跳过。
 * 没有任何墨迹、也没有覆盖的字形宽度为 0（前进 1 个字体像素）。
 */
export function parseUnihex(texts: readonly string[], overrides: readonly UnihexOverride[] = []): UnihexTables {
  const seen = new Set<number>();
  const glyphs: { cp: number; m: [number, number, number, number, number]; bits: Uint8Array }[] = [];
  const overrideFor = (cp: number) => overrides.find((o) => cp >= o.from && cp <= o.to) ?? null;
  for (const text of texts) {
    let start = 0;
    while (start < text.length && glyphs.length < UNIHEX_MAX_GLYPHS) {
      let end = text.indexOf('\n', start);
      if (end < 0) end = text.length;
      const line = text.slice(start, end).trim();
      start = end + 1;
      const colon = line.indexOf(':');
      if (colon < 1 || colon > 6) continue;
      const cp = Number.parseInt(line.slice(0, colon), 16);
      const hex = line.slice(colon + 1);
      if (!Number.isFinite(cp) || cp < 0 || cp > 0x10ffff || seen.has(cp)) continue;
      const width = hex.length === 32 ? 8 : hex.length === 48 ? 12 : hex.length === 64 ? 16 : hex.length === 96 ? 24 : 0;
      if (width === 0) continue;
      const digits = new Int8Array(hex.length);
      let ok = true;
      for (let i = 0; i < hex.length; i++) {
        const d = hexDigit(hex.charCodeAt(i));
        if (d < 0) {
          ok = false;
          break;
        }
        digits[i] = d;
      }
      if (!ok) continue;
      seen.add(cp);
      const perRow = width / 4;
      const pixel = (x: number, y: number) => (digits[y * perRow + (x >> 2)]! >> (3 - (x & 3))) & 1;
      let left = -1;
      let right = -1;
      const o = overrideFor(cp);
      if (o) {
        left = Math.max(0, Math.min(width - 1, o.left));
        right = Math.max(left - 1, Math.min(width - 1, o.right));
      } else {
        for (let x = 0; x < width; x++) {
          for (let y = 0; y < UNIHEX_ROWS; y++) {
            if (pixel(x, y)) {
              if (left < 0) left = x;
              right = x;
              break;
            }
          }
        }
        if (left < 0) {
          left = 0;
          right = -1;
        }
      }
      const w = right - left + 1;
      const rowBytes = Math.ceil(w / 8);
      const bits = new Uint8Array(rowBytes * UNIHEX_ROWS);
      for (let y = 0; y < UNIHEX_ROWS; y++) {
        for (let x = 0; x < w; x++) if (pixel(left + x, y)) bits[y * rowBytes + (x >> 3)]! |= 0x80 >> (x & 7);
      }
      glyphs.push({ cp, m: [UNIHEX_OVERSAMPLE * (Math.floor(w / 2) + 1), w, UNIHEX_ROWS, 0, -UNIHEX_DESCENT], bits });
    }
  }
  glyphs.sort((a, b) => a.cp - b.cp);
  const cps = new Uint32Array(glyphs.length);
  const metrics = new Int16Array(glyphs.length * 5);
  const offsets = new Uint32Array(glyphs.length);
  const bits = new Uint8Array(glyphs.reduce((n, g) => n + g.bits.length, 0));
  let off = 0;
  glyphs.forEach((g, k) => {
    cps[k] = g.cp;
    metrics.set(g.m, k * 5);
    offsets[k] = off;
    bits.set(g.bits, off);
    off += g.bits.length;
  });
  return { ascent: UNIHEX_ASCENT, descent: UNIHEX_DESCENT, codepoints: cps, metrics, offsets, bits, oversample: UNIHEX_OVERSAMPLE };
}
