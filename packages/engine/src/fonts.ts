// 每次 setup 之前载入的字体（text.create 是同步的）：minecraft:default，加上模板 font 参数里出现的字体族。
// 后备顺序：所选字体 → minecraft:default → 系统字体。
// - 资源栈里一个原版字形都没有（没有原版素材、也没有资源包提供字体）时，整段文字用系统字体的矢量画法（vector-text.ts）；
// - 有原版字体、只是缺某些字形时，缺的字形用系统字体按像素画（text.ts 的 SystemGlyphs），和原版字形混排；
// - system:sans（以及旧版本的 allay:fallback）整段用系统字体的矢量画法。
import {
  DEFAULT_FONT_ID,
  isFontFamily,
  LEGACY_FALLBACK_FONT_ID,
  SYSTEM_FONT_ID,
  type ParamDef,
  type ParamValues,
  type TextObject,
  type TextOptions,
} from '@allay/template-sdk';
import * as THREE from 'three';
import type { CachedText, EngineResources, Warn } from './resources';
import { createText, resolveStyle, stackGlyphSource, SYSTEM_FONT_STACK, systemGlyphSource, tableGlyphSource, textObjectFrom, type GlyphSource } from './text';
import { createVectorText, type VectorTextEnv } from './vector-text';

type Loaded = { kind: 'glyphs'; source: GlyphSource } | { kind: 'vector'; css: string };

const isSystem = (family: string) => family === SYSTEM_FONT_ID || family === LEGACY_FALLBACK_FONT_ID;

/** 参数里用到、需要向宿主要的字体族：font 参数的当前值和默认值（系统字体不用要） */
export function fontFamiliesIn(defs: readonly ParamDef[] | undefined, values: Readonly<ParamValues>): string[] {
  const out = new Set<string>([DEFAULT_FONT_ID]);
  for (const def of defs ?? []) {
    if (def.type !== 'font') continue;
    out.add(def.default.family);
    const v = values[def.key];
    const family = v && typeof v === 'object' && !Array.isArray(v) ? (v as { family?: unknown }).family : undefined;
    if (typeof family === 'string' && isFontFamily(family)) out.add(family);
  }
  return [...out].filter((f) => !isSystem(f)).slice(0, 32);
}

const TEXT_CACHE_MAX = 512;

/** 刚画好的文字对象 → 缓存项（只认一个网格、贴图是 DataTexture 的情况；空文字不缓存） */
function toCache(text: TextObject, warnings: string[]): CachedText | null {
  const mesh = text.object.children[0];
  if (!(mesh instanceof THREE.Mesh) || text.object.children.length !== 1) return null;
  const map = (mesh.material as THREE.MeshBasicMaterial).map;
  if (!(map instanceof THREE.DataTexture)) return null;
  const image = map.image as { data: Uint8Array; width: number; height: number };
  return { data: image.data, width: image.width, height: image.height, nearest: map.minFilter === THREE.NearestFilter, geometry: (mesh.geometry as THREE.BufferGeometry).clone(), textWidth: text.width, textHeight: text.height, warnings };
}

/** 缓存项 → 新的文字对象（贴图共用同一份像素数组，各自上传；几何复制一份，随场景释放） */
function fromCache(c: CachedText, owned: THREE.Texture[]): TextObject {
  const tex = new THREE.DataTexture(c.data, c.width, c.height, THREE.RGBAFormat, THREE.UnsignedByteType);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.flipY = false;
  tex.generateMipmaps = false;
  tex.magFilter = c.nearest ? THREE.NearestFilter : THREE.LinearFilter;
  tex.minFilter = c.nearest ? THREE.NearestFilter : THREE.LinearFilter;
  tex.needsUpdate = true;
  owned.push(tex);
  return textObjectFrom(tex, c.geometry.clone(), c.textWidth, c.textHeight);
}

/** 系统字体的整段画法 */
const SYSTEM: Loaded = { kind: 'vector', css: SYSTEM_FONT_STACK };

export class FontRegistry {
  private readonly warned = new Set<string>();

  private constructor(
    private readonly fonts: ReadonlyMap<string, Loaded>,
    /** minecraft:default 有没有任何字形 */
    private readonly hasVanilla: boolean,
    private readonly defaultSource: GlyphSource,
    private readonly cache: Map<string, CachedText> | null,
  ) {}

  static async load(resources: EngineResources, families: readonly string[]): Promise<FontRegistry> {
    const assets = new Map(await Promise.all(families.map(async (f) => [f, await resources.font(f)] as const)));
    const def = assets.get(DEFAULT_FONT_ID);
    const defaultSource = stackGlyphSource(def?.kind === 'stack' ? def.payload : null, [systemGlyphSource()]);
    const fonts = new Map<string, Loaded>([[DEFAULT_FONT_ID, { kind: 'glyphs', source: defaultSource }]]);
    for (const [family, asset] of assets) {
      if (fonts.has(family) || !asset) continue;
      // 导入的字体按注册时的名字找（加引号，后面跟系统字体栈：字体里没有的字形由系统字体补）
      if (asset.kind === 'vector') fonts.set(family, { kind: 'vector', css: `"${asset.css}", ${SYSTEM_FONT_STACK}` });
      else if (asset.kind === 'stack') fonts.set(family, { kind: 'glyphs', source: stackGlyphSource(asset.payload, [defaultSource]) });
      else fonts.set(family, { kind: 'glyphs', source: tableGlyphSource(asset.payload, [defaultSource]) });
    }
    return new FontRegistry(fonts, defaultSource.ownGlyphs, defaultSource, resources.textCache);
  }

  create(opts: TextOptions, warn: Warn, owned: THREE.Texture[], env: VectorTextEnv): TextObject {
    const { family, style } = resolveStyle(opts);
    const want = family ?? DEFAULT_FONT_ID;
    let font: Loaded | undefined = isSystem(want) ? SYSTEM : this.fonts.get(want);
    if (!font || (font.kind === 'glyphs' && !font.source.ownGlyphs && want !== DEFAULT_FONT_ID)) {
      // 选的字体不在（资源栈里没有、导入的文件丢了）：退回默认字体，并报一次
      if (!this.warned.has(want)) {
        this.warned.add(want);
        warn(`text: font "${want.slice(0, 80)}" is not available; using ${DEFAULT_FONT_ID}`);
      }
      font = { kind: 'glyphs', source: this.defaultSource };
    }
    // 没有任何原版字形：整段用系统字体（不算缺字形，不报警告）
    if (font.kind === 'glyphs' && !this.hasVanilla && !font.source.ownGlyphs) font = SYSTEM;
    const chosen = font;
    const draw = (w: Warn, own: THREE.Texture[]) => (chosen.kind === 'vector' ? createVectorText(opts, chosen.css, style, env, w, own) : createText(opts, chosen.source, w, own, style));
    if (!this.cache) return draw(warn, owned);
    // 缓存（改参数时省掉重画）：同一份资源栈里，字体、文字、样式、大小、像素比例都相同就画出同样的像素
    const key = JSON.stringify([chosen.kind === 'vector' ? chosen.css : want, this.hasVanilla, opts.text, opts.size, opts.color ?? null, opts.align ?? null, opts.maxWidth ?? null, style, env.pixelScale]);
    const hit = this.cache.get(key);
    if (hit) {
      this.cache.delete(key);
      this.cache.set(key, hit);
      for (const w of hit.warnings) warn(w);
      return fromCache(hit, owned);
    }
    const warnings: string[] = [];
    const made = draw((m) => {
      warnings.push(m);
      warn(m);
    }, owned);
    const entry = toCache(made, warnings);
    if (entry) {
      this.cache.set(key, entry);
      if (this.cache.size > TEXT_CACHE_MAX) this.cache.delete(this.cache.keys().next().value!);
    }
    return made;
  }
}
