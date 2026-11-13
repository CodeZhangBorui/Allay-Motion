// 原版字体提供器的解析（docs/03-assets.md 3.9）：bitmap、space、reference 三种。
// unihex 和 ttf v1 不解析，记下来让调用方报告；找不到的字形回退到内置像素字体（M2b）。
import { fontIdToPath, fontTextureToPath, normalizeResourceId } from './ids';

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

export type FontProvider = BitmapProvider | SpaceProvider;

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
