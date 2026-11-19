// 引擎里的资源缓存（docs/02-engine.md 2.3、2.8）：经宿主的 resolveResource 取资源，做成 Three 的贴图。
// 缓存按 resourceStamp 分代：stamp 变了就整个清空。动画贴图（.mcmeta）在每个子帧按 t 更新 UV（2.8）。
import { animationFrameAt, frameRect, layoutAnimation, parseAnimationMeta, parseGuiNineSlice, type AnimationLayout, type NineSlice } from '@allay/assets';
import {
  BitmapFontPayloadSchema,
  DEFAULT_FONT_ID,
  FontPayloadSchema,
  SoundMetaPayloadSchema,
  TexturePayloadSchema,
  USER_FONT_RE,
  VectorFontPayloadSchema,
  type SoundMetaVariant,
  type BitmapFontPayload,
  type FontPayload,
  type ResourceKind,
  type ResourcePayload,
} from '@allay/template-sdk';
import * as THREE from 'three';

export type ResolveResource = (kind: ResourceKind, id: string) => Promise<ResourcePayload | null>;
export type Warn = (message: string) => void;

/** 贴图上挂的 CPU 侧信息（物品挤出、文字、九宫格要用） */
export interface TextureInfo {
  id: string;
  /** 整张图，RGBA8 直通 alpha，第一行是顶部 */
  pixels: Uint8Array;
  width: number;
  height: number;
  /** 一帧的尺寸（没有动画时就是整张图） */
  frameWidth: number;
  frameHeight: number;
  animation: AnimationLayout | null;
  /** 界面贴图的九宫格（.mcmeta 的 gui.scaling） */
  nineSlice: NineSlice | null;
  missing: boolean;
}

export function textureInfo(texture: THREE.Texture): TextureInfo | null {
  const info = (texture.userData as { allay?: TextureInfo }).allay;
  return info ?? null;
}

/** 贴图：放大用 Nearest，缩小用 LinearMipmapLinear 并生成 mipmap（2.8）；sRGB 编码 */
export function makeDataTexture(width: number, height: number, topFirst: Uint8Array): THREE.DataTexture {
  // 载荷第一行是顶部；DataTexture 不翻转，第一行对应 v = 0（底部），所以在 CPU 上翻一次
  const data = new Uint8Array(topFirst.length);
  const row = width * 4;
  for (let y = 0; y < height; y++) data.set(topFirst.subarray((height - 1 - y) * row, (height - y) * row), y * row);
  const tex = new THREE.DataTexture(data, width, height, THREE.RGBAFormat, THREE.UnsignedByteType);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.flipY = false;
  tex.needsUpdate = true;
  return tex;
}

/** 品红与黑的棋盘（8 像素一格），16×16。贴图缺失时的占位（3.2） */
export function placeholderPixels(): Uint8Array {
  const data = new Uint8Array(16 * 16 * 4);
  for (let y = 0; y < 16; y++)
    for (let x = 0; x < 16; x++) {
      const on = ((x >> 3) + (y >> 3)) % 2 === 0;
      data.set(on ? [248, 0, 248, 255] : [0, 0, 0, 255], (y * 16 + x) * 4);
    }
  return data;
}

function attachInfo(tex: THREE.Texture, info: TextureInfo): void {
  (tex.userData as { allay?: TextureInfo }).allay = info;
}

/** 把动画贴图的 UV 变换设到第 index 帧 */
function showFrame(tex: THREE.Texture, info: TextureInfo, index: number): void {
  const layout = info.animation;
  if (!layout) return;
  const r = frameRect(layout, info.width, index);
  // CPU 上翻过行：图里从顶部数第 y 行，在贴图里是 v = 1 - y / H
  tex.offset.set(r.x / info.width, 1 - (r.y + r.height) / info.height);
}

/**
 * 一个字体族载入后的样子：资源栈字体（提供器列表）、定长字形表（用户导入的 BDF）、
 * 用户导入的矢量字体（已经用 FontFace 注册进 Worker，css 是注册时的字体名）。取不到时为 null。
 */
export type FontAsset = { kind: 'stack'; payload: FontPayload } | { kind: 'table'; payload: BitmapFontPayload } | { kind: 'vector'; css: string };

/** Worker 里注册过的矢量字体（按内容哈希，不随资源栈变，整个 Worker 只注册一次） */
const vectorFaces = new Map<string, Promise<string | null>>();

async function registerVectorFont(family: string, data: Uint8Array): Promise<string | null> {
  const fonts = (globalThis as { fonts?: FontFaceSet }).fonts;
  if (!fonts || typeof FontFace !== 'function') return null;
  const css = `allay-${family.slice('user:'.length)}`;
  const face = new FontFace(css, data.slice().buffer);
  await face.load();
  fonts.add(face);
  return css;
}

export class EngineResources {
  private stamp: string | null = null;
  private readonly textures = new Map<string, Promise<THREE.Texture>>();
  private readonly animated = new Set<THREE.Texture>();
  private placeholder: THREE.Texture | null = null;
  /** 资源栈字体，随 stamp 清空 */
  private readonly stackFonts = new Map<string, Promise<FontAsset | null>>();
  /** 用户导入的字体（按内容哈希命名，不随资源栈变） */
  private readonly fixedFonts = new Map<string, Promise<FontAsset | null>>();

  constructor(
    private readonly resolve: ResolveResource,
    private readonly log: (level: 'debug' | 'warn' | 'error', message: string) => void,
  ) {}

  /** 资源栈变了：清空贴图和资源栈字体（兜底字体不随资源栈变） */
  setStamp(stamp: string): void {
    if (stamp === this.stamp) return;
    this.stamp = stamp;
    this.clear();
  }

  clear(): void {
    for (const p of this.textures.values())
      void p.then(
        (t) => {
          if (t !== this.placeholder) t.dispose();
        },
        () => undefined,
      );
    this.textures.clear();
    this.animated.clear();
    this.stackFonts.clear();
    this.sounds.clear();
  }

  private readonly sounds = new Map<string, Promise<readonly SoundMetaVariant[]>>();

  /**
   * 音效事件的全部变体（资源栈里合并后的 sounds.json，展开 event 引用之后），按 stamp 缓存。
   * 宿主没有这个事件时是空数组；取不到（宿主出错）也当作空数组，不让模板装载失败。
   */
  soundVariants(eventId: string): Promise<readonly SoundMetaVariant[]> {
    let p = this.sounds.get(eventId);
    if (!p) {
      p = this.resolve('sound-meta', eventId).then(
        (raw) => {
          if (!raw) return [];
          const parsed = SoundMetaPayloadSchema.safeParse(raw);
          if (parsed.success) return parsed.data.variants;
          this.log('warn', `invalid sound-meta payload for ${eventId}`);
          return [];
        },
        (error: unknown) => {
          this.log('warn', `sound-meta ${eventId} failed: ${error instanceof Error ? error.message : String(error)}`);
          return [];
        },
      );
      this.sounds.set(eventId, p);
    }
    return p;
  }

  dispose(): void {
    this.clear();
    this.placeholder?.dispose();
    this.placeholder = null;
  }

  /** 每个子帧调用：所有动画贴图切到 t 时刻的帧（2.8） */
  applyAnimations(t: number): void {
    for (const tex of this.animated) {
      const info = textureInfo(tex);
      if (info?.animation) showFrame(tex, info, animationFrameAt(info.animation, t));
    }
  }

  /** 设好过滤和色彩空间的贴图；缺失时返回占位图并经 warn 记一条警告（3.2、T-AST-3） */
  texture(id: string, warn: Warn): Promise<THREE.Texture> {
    if (typeof id !== 'string' || id.length === 0 || id.length > 512) return Promise.reject(new TypeError('invalid texture id'));
    let p = this.textures.get(id);
    if (!p) {
      const fetched = this.fetchTexture(id).catch((error: unknown) => {
        this.log('warn', `texture ${id} failed: ${error instanceof Error ? error.message : String(error)}`);
        return null;
      });
      p = fetched.then((tex) => {
        if (tex) return tex;
        // 缺失的不缓存占位，下一次 setup 仍然报警告
        this.textures.delete(id);
        return this.placeholderTexture();
      });
      this.textures.set(id, p);
    }
    return p.then((tex) => {
      if (textureInfo(tex)?.missing) warn(`texture ${id} is missing; a placeholder is used`);
      return tex;
    });
  }

  placeholderTexture(): THREE.Texture {
    if (!this.placeholder) {
      const pixels = placeholderPixels();
      this.placeholder = makeDataTexture(16, 16, pixels);
      attachInfo(this.placeholder, { id: 'placeholder', pixels, width: 16, height: 16, frameWidth: 16, frameHeight: 16, animation: null, nineSlice: null, missing: true });
    }
    return this.placeholder;
  }

  private async fetchTexture(id: string): Promise<THREE.Texture | null> {
    const raw = await this.resolve('texture', id);
    if (raw === null) return null;
    const payload = TexturePayloadSchema.parse(raw);
    let animation: AnimationLayout | null = null;
    let nineSlice: NineSlice | null = null;
    if (payload.mcmeta !== undefined) {
      const meta = parseAnimationMeta(payload.mcmeta);
      if (meta) {
        animation = layoutAnimation(meta, payload.width, payload.height);
        if (!animation) this.log('warn', `texture ${id}: animation metadata does not fit the image; shown as a still image`);
      }
      nineSlice = parseGuiNineSlice(payload.mcmeta);
    }
    const tex = makeDataTexture(payload.width, payload.height, payload.data);
    const info: TextureInfo = {
      id,
      pixels: payload.data,
      width: payload.width,
      height: payload.height,
      frameWidth: animation?.frameWidth ?? payload.width,
      frameHeight: animation?.frameHeight ?? payload.height,
      animation,
      nineSlice,
      missing: false,
    };
    attachInfo(tex, info);
    if (animation) {
      tex.repeat.set(animation.frameWidth / payload.width, animation.frameHeight / payload.height);
      showFrame(tex, info, animationFrameAt(animation, 0));
      this.animated.add(tex);
    }
    return tex;
  }

  /**
   * 文字用的字体（字体族见 template-sdk 的 isFontFamily），在每次 setup 之前载入（text.create 是同步的）。
   * 取不到（资源栈里没有、文件丢了、解析失败）时为 null，由调用方退回默认字体。
   */
  font(family: string): Promise<FontAsset | null> {
    const fixed = USER_FONT_RE.test(family);
    const cache = fixed ? this.fixedFonts : this.stackFonts;
    let p = cache.get(family);
    if (!p) {
      p = this.resolve('font', family).then(
        async (raw): Promise<FontAsset | null> => {
          if (raw === null) return null;
          if (raw.kind === 'font') return { kind: 'stack', payload: FontPayloadSchema.parse(raw) };
          if (raw.kind === 'bdf') return { kind: 'table', payload: BitmapFontPayloadSchema.parse(raw) };
          if (raw.kind === 'vector' && USER_FONT_RE.test(family)) {
            const data = VectorFontPayloadSchema.parse(raw).data;
            let face = vectorFaces.get(family);
            if (!face) {
              face = registerVectorFont(family, data).catch(() => null);
              vectorFaces.set(family, face);
            }
            const css = await face;
            if (!css) throw new Error('the font file could not be loaded');
            return { kind: 'vector', css };
          }
          throw new Error(`unexpected payload ${raw.kind}`);
        },
      );
      p = p.catch((error: unknown) => {
        this.log('warn', `font ${family} failed: ${error instanceof Error ? error.message : String(error)}`);
        return null;
      });
      cache.set(family, p);
    }
    return p;
  }

  /** 资源栈里的默认字体；没有时为 null */
  async defaultFont(): Promise<FontPayload | null> {
    const v = await this.font(DEFAULT_FONT_ID);
    return v?.kind === 'stack' ? v.payload : null;
  }

}
