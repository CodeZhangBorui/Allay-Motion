// 每次 setup 之前载入的字体（text.create 是同步的）：minecraft:default、allay:fallback，加上模板 font 参数里出现的字体族。
// 后备顺序：所选字体 → minecraft:default → 内置像素字体。
import { DEFAULT_FONT_ID, FALLBACK_FONT_ID, isFontFamily, type ParamDef, type ParamValues, type TextObject, type TextOptions } from '@allay/template-sdk';
import type * as THREE from 'three';
import type { EngineResources, Warn } from './resources';
import { createText, resolveStyle, stackGlyphSource, tableGlyphSource, type GlyphSource } from './text';
import { createVectorText, type VectorTextEnv } from './vector-text';

type Loaded = { kind: 'glyphs'; source: GlyphSource } | { kind: 'vector'; css: string };

/** 参数里用到的字体族：font 参数的当前值和默认值 */
export function fontFamiliesIn(defs: readonly ParamDef[] | undefined, values: Readonly<ParamValues>): string[] {
  const out = new Set<string>([DEFAULT_FONT_ID, FALLBACK_FONT_ID]);
  for (const def of defs ?? []) {
    if (def.type !== 'font') continue;
    out.add(def.default.family);
    const v = values[def.key];
    const family = v && typeof v === 'object' && !Array.isArray(v) ? (v as { family?: unknown }).family : undefined;
    if (typeof family === 'string' && isFontFamily(family)) out.add(family);
  }
  return [...out].slice(0, 32);
}

export class FontRegistry {
  private readonly warned = new Set<string>();

  private constructor(
    private readonly fonts: ReadonlyMap<string, Loaded>,
    private readonly fallbackDefault: GlyphSource,
  ) {}

  static async load(resources: EngineResources, families: readonly string[]): Promise<FontRegistry> {
    const assets = new Map(await Promise.all(families.map(async (f) => [f, await resources.font(f)] as const)));
    const fb = assets.get(FALLBACK_FONT_ID);
    const fallback = tableGlyphSource(fb?.kind === 'table' ? fb.payload : null);
    const def = assets.get(DEFAULT_FONT_ID);
    const defaultSource = stackGlyphSource(def?.kind === 'stack' ? def.payload : null, [fallback]);
    const fonts = new Map<string, Loaded>([
      [DEFAULT_FONT_ID, { kind: 'glyphs', source: defaultSource }],
      [FALLBACK_FONT_ID, { kind: 'glyphs', source: fallback }],
    ]);
    for (const [family, asset] of assets) {
      if (fonts.has(family) || !asset) continue;
      if (asset.kind === 'vector') fonts.set(family, { kind: 'vector', css: asset.css });
      else if (asset.kind === 'stack') fonts.set(family, { kind: 'glyphs', source: stackGlyphSource(asset.payload, [defaultSource]) });
      else fonts.set(family, { kind: 'glyphs', source: tableGlyphSource(asset.payload, [defaultSource]) });
    }
    return new FontRegistry(fonts, defaultSource);
  }

  create(opts: TextOptions, warn: Warn, owned: THREE.Texture[], env: VectorTextEnv): TextObject {
    const { family, style } = resolveStyle(opts);
    const want = family ?? DEFAULT_FONT_ID;
    let font = this.fonts.get(want);
    if (!font || (font.kind === 'glyphs' && !font.source.ownGlyphs && want !== DEFAULT_FONT_ID && want !== FALLBACK_FONT_ID)) {
      if (!this.warned.has(want)) {
        this.warned.add(want);
        warn(`text: font "${want.slice(0, 80)}" is not available; using ${DEFAULT_FONT_ID}`);
      }
      font = { kind: 'glyphs', source: this.fallbackDefault };
    }
    if (font.kind === 'vector') return createVectorText(opts, font.css, style, env, warn, owned);
    return createText(opts, font.source, warn, owned, style);
  }
}
