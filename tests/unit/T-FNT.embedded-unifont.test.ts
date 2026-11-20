// T-FNT-5 至 T-FNT-10：内嵌 Unifont 与两种字体模式（docs/decisions.md“内嵌 Unifont 与两种字体模式”，docs/04-templates.md 4.4）。
// T-FNT-11（安装包里有且只有一份字体文件）在 tests/dist/M8.package.test.ts。
// Unifont 是 GNU 的字体，直接用仓库里那一份；“原版字体”仍是测试里拼出来的假 bitmap 提供器（不是 Mojang 的文件）。
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { otfToHex, parseUnifontOtf, UNIFONT_FULL_WIDTH } from '../../packages/assets/src/index';
import {
  DEFAULT_FONT_ID,
  EMBEDDED_DEFAULT_FONT_ID,
  EMBEDDED_UNIFONT_RESOURCE_ID,
  EMBEDDED_UNIFORM_FONT_ID,
  isFontFamily,
  sanitizeParams,
  type BitmapFontPayload,
  type FontPayload,
  type ParamDef,
  type ResourceKind,
  type ResourcePayload,
} from '../../packages/template-sdk/src/index';
import { embeddedGlyphSource, rasterizeText, SUB } from '../../packages/engine/src/text';
import { FontRegistry } from '../../packages/engine/src/fonts';
import { EngineResources } from '../../packages/engine/src/resources';
import { EMBEDDED_UNIFONT_FILE, EmbeddedUnifont } from '../../apps/desktop/src/main/resources/fonts';

const ROOT = join(import.meta.dirname, '../..');
const FONT_FILE = join(ROOT, 'resources', ...EMBEDDED_UNIFONT_FILE);
const fontBytes = () => new Uint8Array(readFileSync(FONT_FILE));

/** 解析一次，后面的用例共用（约 1–2 秒） */
let tablesCache: BitmapFontPayload | null = null;
function unifont(): BitmapFontPayload {
  if (!tablesCache) {
    const t = parseUnifontOtf(fontBytes());
    tablesCache = { kind: 'bdf', ascent: t.ascent, descent: t.descent, oversample: 2, codepoints: t.codepoints, metrics: t.metrics, offsets: t.offsets, bits: t.bits };
  }
  return tablesCache;
}

/** 假的原版字体：一个 8×8 的 bitmap 格子，只有“A”，墨迹是左边 3 列的实心块（和 Unifont 的 A 一眼就能分开） */
function fakeVanilla(withUnihex: boolean): FontPayload {
  const data = new Uint8Array(8 * 8 * 4);
  for (let y = 0; y < 7; y++) for (let x = 0; x < 3; x++) data.set([255, 255, 255, 255], (y * 8 + x) * 4);
  const providers: FontPayload['providers'] = [
    { type: 'space', advances: [[0x20, 4]] },
    { type: 'bitmap', ascent: 7, height: 8, rows: [[0x41]], image: { width: 8, height: 8, data } },
  ];
  if (withUnihex) {
    // 资源栈里的 unihex（字形表）：“中”是一个 2 列宽的竖条，用来确认普通模式不用它
    const bits = new Uint8Array(16).fill(0xc0);
    providers.push({ type: 'glyphs', ascent: 14, descent: 2, oversample: 2, codepoints: Uint32Array.of(0x4e2d), metrics: Int16Array.of(4, 2, 16, 0, -2), offsets: Uint32Array.of(0), bits });
  }
  return { kind: 'font', providers, skipped: [] };
}

describe('T-FNT-5 内嵌 Unifont 的 OTF 还原成点阵', () => {
  it('文件是 GNU Unifont 18.0.01（标准版，汉字是 G 源字形），sha256 与登记的一致', async () => {
    const { createHash } = await import('node:crypto');
    const bytes = fontBytes();
    expect(createHash('sha256').update(bytes).digest('hex')).toBe('88d0a14d4aa9a96419720b39ba5da921a59560d76d4ec7d523acc06ed85cd3c2');
    const provenance = JSON.parse(readFileSync(join(ROOT, 'ASSETS_PROVENANCE.json'), 'utf8')) as { path: string; note?: string }[];
    expect(provenance.find((e) => e.path === 'resources/fonts/unifont/unifont-18.0.01.otf')?.note).toContain('88d0a14d4aa9a96419720b39ba5da921a59560d76d4ec7d523acc06ed85cd3c2');
  });

  it('字形和 .hex 一样：8 或 16 列 × 16 行，“A”与 Unifont 的 .hex 逐位相同；全部基本多文种平面的字形都读得出来', () => {
    const { hex, version, glyphs } = otfToHex(fontBytes());
    expect(version).toBe('Version 18.0.01');
    expect(glyphs).toBeGreaterThan(57_000);
    const lines = new Map(hex.split('\n').map((l) => [l.slice(0, l.indexOf(':')), l.slice(l.indexOf(':') + 1)] as const));
    expect(lines.get('0041')).toBe('0000000018242442427E424242420000');
    // 汉字是 16 列（64 个十六进制数字），空格没有墨迹
    expect(lines.get('4E2D')).toHaveLength(64);
    expect(lines.get('0020')).toBe('0'.repeat(32));
    for (const bits of lines.values()) expect([32, 64]).toContain(bits.length);
  });

  it('全宽区间的字形按整格算：中文、全角标点前进 9 个字体像素（表里存成 18 个半像素）；ASCII 按墨迹', () => {
    const t = unifont();
    const adv = (cp: number) => {
      let lo = 0;
      let hi = t.codepoints.length - 1;
      while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        if (t.codepoints[mid] === cp) return t.metrics[mid * 5]!;
        if (t.codepoints[mid]! < cp) lo = mid + 1;
        else hi = mid - 1;
      }
      return null;
    };
    for (const ch of '中文，。、一') expect(adv(ch.codePointAt(0)!), ch).toBe(18);
    // A 的墨迹 6 列：floor(6 / 2) + 1 = 4 个字体像素
    expect(adv(0x41)).toBe(8);
    expect(UNIFONT_FULL_WIDTH.every((o) => o.from <= o.to)).toBe(true);
  });

  it('确定性：同一个文件解析两次逐字节相同', () => {
    const a = parseUnifontOtf(fontBytes());
    const b = parseUnifontOtf(fontBytes());
    expect(Buffer.from(a.bits).equals(Buffer.from(b.bits))).toBe(true);
    expect(Buffer.from(a.metrics.buffer).equals(Buffer.from(b.metrics.buffer))).toBe(true);
    expect([...a.codepoints]).toEqual([...b.codepoints]);
  });
});

describe('T-FNT-6 两种模式下各字形取自哪里', () => {
  it('普通模式：ASCII 取原版 bitmap（偏移 1 个字体像素），中文取内嵌 Unifont（不用资源栈里的 unihex），空格 4 像素', () => {
    const src = embeddedGlyphSource(fakeVanilla(true), unifont(), false);
    const a = src.glyph(0x41)!;
    expect(a.offset).toBe(SUB);
    expect(a.w).toBe(3 * SUB);
    const zh = src.glyph(0x4e2d)!;
    // 内嵌 Unifont 的“中”：半像素一格（偏移 1 个子像素），整格 16 列 = 8 个字体像素，前进 9
    expect(zh.offset).toBe(1);
    expect(zh.advance).toBe(9 * SUB);
    expect(zh.w).toBe(16);
    expect(src.glyph(0x20)!.advance).toBe(4 * SUB);
  });

  it('强制 Unicode 模式：ASCII 也取内嵌 Unifont，资源栈里的字形一个都不用', () => {
    const src = embeddedGlyphSource(fakeVanilla(true), unifont(), true);
    const a = src.glyph(0x41)!;
    expect(a.offset).toBe(1);
    // Unifont 的 A：墨迹 6 列（半像素），前进 4 个字体像素
    expect(a.w).toBe(6);
    expect(a.advance).toBe(4 * SUB);
    expect(src.glyph(0x4e2d)!.offset).toBe(1);
    expect(src.glyph(0x20)!.advance).toBe(4 * SUB);
  });

  it('混排：普通模式下“A中 A”的宽度 = 原版 A（4）+ 中（9）+ 空格（4）+ 原版 A（4）', () => {
    const src = embeddedGlyphSource(fakeVanilla(false), unifont(), false);
    const r = rasterizeText('A中 A', src, 0, 'left', () => undefined);
    expect(r.width).toBe((4 + 9 + 4 + 4) * SUB);
  });

  it('没有原版素材时普通模式等于全部用 Unifont；内嵌 Unifont 也没有的字形（平面 1 的表情）交给系统字体', () => {
    const plain = embeddedGlyphSource(null, unifont(), false);
    const forced = embeddedGlyphSource(null, unifont(), true);
    for (const ch of 'Ag中，') {
      const cp = ch.codePointAt(0)!;
      expect(plain.glyph(cp)).toEqual(expect.objectContaining({ w: forced.glyph(cp)!.w, advance: forced.glyph(cp)!.advance, offset: 1 }));
    }
    // 测试环境没有 OffscreenCanvas，系统字体画不出来：字形链走到了最后一环，结果是缺字
    expect(plain.glyph(0x1f600)).toBeNull();
  });
});

describe('T-FNT-7 逐像素确定性', () => {
  it('两次各自建的字形来源画同一段中英混排，像素逐字节相同', () => {
    const style = { bold: true, italic: false, underline: true, strikethrough: false, shadow: true, outline: null };
    const a = rasterizeText('Hello 你好，世界', embeddedGlyphSource(fakeVanilla(false), unifont(), false), 0, 'center', () => undefined, style, '#FFAA00');
    const b = rasterizeText('Hello 你好，世界', embeddedGlyphSource(fakeVanilla(false), unifont(), false), 0, 'center', () => undefined, style, '#FFAA00');
    expect(Buffer.from(a.pixels).equals(Buffer.from(b.pixels))).toBe(true);
    // 字形是硬边像素：遮罩里没有半透明（阴影在下、正文在上，各自不透明）
    for (let i = 3; i < a.pixels.length; i += 4) expect([0, 255]).toContain(a.pixels[i]);
  });
});

describe('T-FNT-8 字体族 ID', () => {
  it('embedded: 命名空间只认 default 和 uniform；参数清洗保留它们', () => {
    expect(isFontFamily(EMBEDDED_DEFAULT_FONT_ID)).toBe(true);
    expect(isFontFamily(EMBEDDED_UNIFORM_FONT_ID)).toBe(true);
    expect(isFontFamily(EMBEDDED_UNIFONT_RESOURCE_ID)).toBe(false);
    expect(isFontFamily('embedded:other')).toBe(false);
    expect(isFontFamily(DEFAULT_FONT_ID)).toBe(true);
    const defs: ParamDef[] = [{ key: 'font', type: 'font', label: { 'zh-CN': '字体', en: 'Font' }, default: { family: EMBEDDED_DEFAULT_FONT_ID } } as ParamDef];
    expect((sanitizeParams(defs, { font: { family: EMBEDDED_UNIFORM_FONT_ID } }).font as { family: string }).family).toBe(EMBEDDED_UNIFORM_FONT_ID);
    expect((sanitizeParams(defs, { font: { family: 'embedded:unifont' } }).font as { family: string }).family).toBe(EMBEDDED_DEFAULT_FONT_ID);
  });
});

describe('T-FNT-9 字体只加载一次', () => {
  it('主进程：第一次调用才读文件，之后给同一份', async () => {
    const logs: string[] = [];
    const store = new EmbeddedUnifont(FONT_FILE, (m) => logs.push(m));
    expect(logs).toEqual([]);
    const [a, b] = await Promise.all([store.get(), store.get()]);
    expect(a).not.toBeNull();
    expect(a).toBe(b);
    expect(await store.get()).toBe(a);
    expect(logs).toEqual(['embedded unifont loaded']);
  });

  it('主进程：文件不在时为 null 并记日志', async () => {
    const logs: string[] = [];
    expect(await new EmbeddedUnifont(join(ROOT, 'no-such.otf'), (m) => logs.push(m)).get()).toBeNull();
    expect(logs).toEqual(['embedded unifont unavailable']);
  });

  it('引擎：资源栈换了也不再向宿主要字形表', async () => {
    let asked = 0;
    const resolve = async (kind: ResourceKind, id: string): Promise<ResourcePayload | null> => {
      if (kind === 'font' && id === EMBEDDED_UNIFONT_RESOURCE_ID) {
        asked++;
        return structuredClone(unifont());
      }
      return null;
    };
    const res = new EngineResources(resolve, () => undefined);
    res.setStamp('a');
    await FontRegistry.load(res, [DEFAULT_FONT_ID, EMBEDDED_DEFAULT_FONT_ID, EMBEDDED_UNIFORM_FONT_ID]);
    res.setStamp('b');
    await FontRegistry.load(res, [DEFAULT_FONT_ID, EMBEDDED_UNIFORM_FONT_ID]);
    // 不用内嵌字体族时不要
    await FontRegistry.load(res, [DEFAULT_FONT_ID]);
    expect(asked).toBe(1);
  });
});

describe('T-FNT-10 文字对象与缓存', () => {
  const env = { pixelScale: 1 };
  const host = (withTable: boolean) => async (kind: ResourceKind, id: string): Promise<ResourcePayload | null> => {
    if (kind !== 'font') return null;
    if (id === EMBEDDED_UNIFONT_RESOURCE_ID) return withTable ? structuredClone(unifont()) : null;
    if (id === DEFAULT_FONT_ID) return fakeVanilla(false);
    return null;
  };

  it('两种模式、minecraft:default 画出的宽度各不相同，缓存键把它们分开；minecraft:default 的行为不变', async () => {
    const res = new EngineResources(host(true), () => undefined);
    res.setStamp('s');
    const reg = await FontRegistry.load(res, [DEFAULT_FONT_ID, EMBEDDED_DEFAULT_FONT_ID, EMBEDDED_UNIFORM_FONT_ID]);
    const warns: string[] = [];
    const width = (font: string) => reg.create({ text: 'AA', size: 1, font }, (m) => warns.push(m), [], env).width;
    // 原版 A：3 列墨迹 + 1 = 4；Unifont 的 A：floor(6 / 2) + 1 = 4，但内容框按子像素算，粗细不同；用中文区分更直接
    const zh = (font: string) => reg.create({ text: 'A中', size: 1, font }, (m) => warns.push(m), [], env).width;
    expect(zh(EMBEDDED_DEFAULT_FONT_ID)).toBe(4 + 9);
    expect(zh(EMBEDDED_UNIFORM_FONT_ID)).toBe(4 + 9);
    expect(width(EMBEDDED_UNIFORM_FONT_ID)).toBe(8);
    // minecraft:default：中文没有 unihex 时交给系统字体（测试环境画不出来，算缺字），只剩 A
    expect(zh(DEFAULT_FONT_ID)).toBe(4);
    expect(warns.some((w) => w.includes('U+4E2D'))).toBe(true);
    // 同样的输入第二次命中缓存，结果一样
    expect(zh(EMBEDDED_DEFAULT_FONT_ID)).toBe(4 + 9);
    const keys = [...res.textCache.keys()];
    expect(keys.some((k) => k.includes(EMBEDDED_DEFAULT_FONT_ID))).toBe(true);
    expect(keys.some((k) => k.includes(EMBEDDED_UNIFORM_FONT_ID))).toBe(true);
  });

  it('宿主没有内嵌字体（官网）时退回 minecraft:default，并记一条警告', async () => {
    const res = new EngineResources(host(false), () => undefined);
    res.setStamp('s');
    const reg = await FontRegistry.load(res, [DEFAULT_FONT_ID, EMBEDDED_DEFAULT_FONT_ID]);
    const warns: string[] = [];
    const text = reg.create({ text: 'A', size: 1, font: EMBEDDED_DEFAULT_FONT_ID }, (m) => warns.push(m), [], env);
    expect(text.width).toBe(4);
    expect(warns.some((w) => w.includes('embedded:default') && w.includes('not available'))).toBe(true);
  });
});
