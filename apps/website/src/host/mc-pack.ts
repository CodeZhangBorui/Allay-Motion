// 官网展示用的 Minecraft 原版贴图（public/mc/，由 pnpm website:mc 从本机正版游戏的 jar 里提取，docs/decisions.md 官网 · 原版素材）。
// 只在官网里用；桌面版读用户本机的游戏，安装包里没有这些文件。
// 有哪些文件在构建时就知道（virtual:allay-website-mc），不试探着请求。
import { textureIdToPath, textureMetaPath } from '@allay/assets';
import mc from 'virtual:allay-website-mc';

const files = new Set(mc?.files ?? []);

/** 提取过的游戏版本；没有提取时为 null（官网退回生成的纯色色块） */
export const mcGameVersion: string | null = mc?.gameVersion ?? null;

function url(path: string): string {
  return new URL(`mc/${path}`, document.baseURI).href;
}

async function fetchBytes(path: string): Promise<Uint8Array> {
  const res = await fetch(url(path));
  if (!res.ok) throw new Error(`mc ${path}: ${res.status}`);
  return new Uint8Array(await res.arrayBuffer());
}

const cache = new Map<string, Promise<{ png: Uint8Array; mcmeta: string | null } | null>>();

/** 贴图 ID 对应的原版 PNG 和 .mcmeta；这里没有时为 null */
export function mcTexture(id: string): Promise<{ png: Uint8Array; mcmeta: string | null } | null> {
  const path = textureIdToPath(id);
  if (!path || !files.has(path)) return Promise.resolve(null);
  let p = cache.get(path);
  if (!p) {
    const meta = textureMetaPath(path);
    p = Promise.all([fetchBytes(path), files.has(meta) ? fetchBytes(meta).then((b) => new TextDecoder().decode(b)) : Promise.resolve(null)])
      .then(([png, mcmeta]) => ({ png, mcmeta }))
      .catch((error: unknown) => {
        console.warn('[web-host] vanilla texture unavailable', error);
        return null;
      });
    cache.set(path, p);
  }
  // 调用方会把缓冲转移给 Worker，每次给一份新的
  return p.then((r) => (r ? { png: r.png.slice(), mcmeta: r.mcmeta } : null));
}
