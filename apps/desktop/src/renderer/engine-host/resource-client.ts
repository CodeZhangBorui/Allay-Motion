// 宿主一侧的 resolveResource（docs/02-engine.md 2.3、01-product-architecture.md 1.5）：
// 引擎 Worker 要资源 → 这里经 IPC 向主进程的资源栈要原始文件 → 在渲染进程里解码 → 交给 Worker。
// Worker 自己不能读任何东西。解码结果按 resourceStamp 缓存；资源栈一变就清空。
import { decodePng, type DecodedImage } from '@allay/assets';
import {
  DEFAULT_FONT_ID,
  FALLBACK_FONT_ID,
  MAX_TEXTURE_SIZE,
  type BitmapFontPayload,
  type FontPayload,
  type FontProviderPayload,
  type ResourceKind,
  type ResourcePayload,
} from '@allay/template-sdk';
import { currentStamp, useResourceStore } from '../stores/resourceStore';
import { assetKey, type AssetSource } from '../templates/catalog';

/** 浏览器自带的 zlib 解压，给 PNG 解码用（不需要 WebAssembly，CSP 不用放宽） */
async function inflate(data: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([data as Uint8Array<ArrayBuffer>]).stream().pipeThrough(new DecompressionStream('deflate'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

export function decodeImage(png: Uint8Array): Promise<DecodedImage> {
  return decodePng(png, inflate);
}

let cacheStamp = '';
const cache = new Map<string, Promise<ResourcePayload | null>>();
let fallbackFont: Promise<BitmapFontPayload | null> | null = null;

function checkStamp(): void {
  const stamp = currentStamp();
  if (stamp !== cacheStamp) {
    cacheStamp = stamp;
    cache.clear();
  }
}

// 资源栈一变就丢掉缓存（引擎那边由 load 时带的新 stamp 清空自己的缓存）
useResourceStore.subscribe((s, prev) => {
  if (s.state?.stamp !== prev.state?.stamp) checkStamp();
});

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47];

/** PNG 自己解码（保留直通 alpha 的精度）；JPG、WebP 交给浏览器解码 */
async function decodeAnyImage(bytes: Uint8Array): Promise<DecodedImage> {
  if (PNG_SIGNATURE.every((b, i) => bytes[i] === b)) return decodeImage(bytes);
  const bitmap = await createImageBitmap(new Blob([bytes as Uint8Array<ArrayBuffer>]), { premultiplyAlpha: 'none', colorSpaceConversion: 'none' });
  try {
    if (bitmap.width > MAX_TEXTURE_SIZE || bitmap.height > MAX_TEXTURE_SIZE) throw new Error('image too large');
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    const g = canvas.getContext('2d');
    if (!g) throw new Error('no 2d context');
    g.drawImage(bitmap, 0, 0);
    const data = g.getImageData(0, 0, bitmap.width, bitmap.height).data;
    return { width: bitmap.width, height: bitmap.height, data: new Uint8Array(data.buffer, data.byteOffset, data.byteLength) };
  } finally {
    bitmap.close();
  }
}

/** 模板包 assets/ 里的图片（asset:路径）和用户选的图片（file:引用） */
async function loadImageTexture(id: string, assets: AssetSource | null): Promise<ResourcePayload | null> {
  let bytes: Uint8Array | null = null;
  if (id.startsWith('asset:')) {
    if (!assets) return null;
    bytes = await window.allay.templates.readAsset(assets, id.slice('asset:'.length));
  } else if (id.startsWith('file:')) {
    bytes = await window.allay.files.read(id.slice('file:'.length));
  }
  if (!bytes) return null;
  const img = await decodeAnyImage(bytes);
  return { kind: 'rgba', width: img.width, height: img.height, data: img.data };
}

async function loadTexture(id: string): Promise<ResourcePayload | null> {
  const raw = await window.allay.resources.readTexture(id);
  if (!raw) return null;
  const img = await decodeImage(raw.png);
  return { kind: 'rgba', width: img.width, height: img.height, data: img.data, ...(raw.mcmeta !== null ? { mcmeta: raw.mcmeta } : {}) };
}

async function loadFont(id: string): Promise<FontPayload | null> {
  const def = await window.allay.resources.fontProviders(id);
  if (!def) return null;
  const providers: FontProviderPayload[] = [];
  const skipped = [...def.skipped];
  for (const p of def.providers) {
    if (p.type === 'space') {
      providers.push(p);
      continue;
    }
    const png = await window.allay.resources.read(p.file);
    if (!png) {
      skipped.push(`missing(${p.file})`);
      continue;
    }
    try {
      const image = await decodeImage(png);
      providers.push({ type: 'bitmap', ascent: p.ascent, height: p.height, rows: p.rows, image });
    } catch {
      skipped.push(`undecodable(${p.file})`);
    }
  }
  return { kind: 'font', providers, skipped };
}

async function loadFallbackFont(): Promise<BitmapFontPayload | null> {
  const t = await window.allay.resources.fallbackFont();
  return t ? { kind: 'bdf', ascent: t.ascent, descent: t.descent, codepoints: t.codepoints, metrics: t.metrics, offsets: t.offsets, bits: t.bits } : null;
}

/**
 * 引擎的 resolveResource（只有资源栈，没有模板自带的图片：缩略图用）。
 * 每次返回一份新的副本：载荷会被零拷贝转移给 Worker，转移后原对象就不能用了。
 */
export function resolveResource(kind: ResourceKind, id: string): Promise<ResourcePayload | null> {
  return resolveWith(kind, id, null);
}

/** 带模板自带图片的 resolveResource：asset: 从 getAssets() 指的模板读（预览换模板时它跟着变） */
export function createResolver(getAssets: () => AssetSource | null): (kind: ResourceKind, id: string) => Promise<ResourcePayload | null> {
  return (kind, id) => resolveWith(kind, id, getAssets());
}

/** 交给引擎 load 的分代键：资源栈的 stamp 加上模板（asset: 引用随模板变，引擎据此清空贴图缓存） */
export function loadStamp(assets: AssetSource | null): string {
  const key = assetKey(assets);
  return key ? `${currentStamp()}|${key}` : currentStamp();
}

async function resolveWith(kind: ResourceKind, id: string, assets: AssetSource | null): Promise<ResourcePayload | null> {
  let p: Promise<ResourcePayload | null>;
  if (kind === 'font' && id === FALLBACK_FONT_ID) {
    // 兜底字体不随资源栈变
    fallbackFont ??= loadFallbackFont().catch(() => null);
    p = fallbackFont;
  } else {
    checkStamp();
    const image = kind === 'texture' && /^(asset|file):/.test(id);
    // asset: 随模板变，键里带上模板
    const key = image && id.startsWith('asset:') ? `${kind}:${assetKey(assets)}:${id}` : `${kind}:${id}`;
    let entry = cache.get(key);
    if (!entry) {
      entry = image
        ? loadImageTexture(id, assets)
        : kind === 'texture'
          ? loadTexture(id)
          : kind === 'font' && id === DEFAULT_FONT_ID
            ? loadFont(id)
            : Promise.resolve(null);
      // 失败（解码不了等）当作缺失，交给引擎用占位并报警告；不缓存失败
      entry = entry.catch((error: unknown) => {
        console.warn(`[resources] ${key} failed: ${error instanceof Error ? error.message : String(error)}`);
        cache.delete(key);
        return null;
      });
      cache.set(key, entry);
    }
    p = entry;
  }
  const payload = await p;
  return payload ? structuredClone(payload) : null;
}
