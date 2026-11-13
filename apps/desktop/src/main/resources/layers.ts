// 资源层的三种 Node 实现：内置目录、资源包（zip、文件夹）（docs/03-assets.md 3.2–3.5）。
// 原版层在 vanilla.ts。层是普通对象（方法写成闭包），资源栈的纯逻辑在 @allay/assets 的 stack.ts。
import { stat } from 'node:fs/promises';
import { basename } from 'node:path';
import { parsePackMeta, readPngHeader, type ResourceLayer } from '@allay/assets';
import { scanDirectory } from './directory';
import { openZip, type ZipArchive } from './zip';

export const BUILTIN_LAYER_ID = 'builtin';

/** 1.12 及更早的命名（3.5） */
const LEGACY_PREFIX = 'assets/minecraft/textures/blocks/';

/** pack.png 只当图标用：必须是 PNG 且不太大 */
const MAX_ICON_BYTES = 1024 * 1024;

export interface ClosableLayer extends ResourceLayer {
  /** 释放文件句柄（zip）；文件夹和内置层什么也不做 */
  close(): void;
}

interface Source {
  has(path: string): boolean;
  read(path: string): Promise<Uint8Array | null>;
  list(prefix: string): string[];
  warnings: readonly string[];
}

async function packInfo(src: Source): Promise<Pick<ResourceLayer, 'description' | 'packFormat' | 'icon' | 'legacyFormat'>> {
  const out: Pick<ResourceLayer, 'description' | 'packFormat' | 'icon' | 'legacyFormat'> = {};
  const meta = src.has('pack.mcmeta') ? await src.read('pack.mcmeta').catch(() => null) : null;
  if (meta) {
    const parsed = parsePackMeta(new TextDecoder().decode(meta));
    if (parsed.description !== undefined) out.description = parsed.description;
    if (parsed.packFormat !== undefined) out.packFormat = parsed.packFormat;
  }
  const icon = src.has('pack.png') ? await src.read('pack.png').catch(() => null) : null;
  if (icon && icon.length <= MAX_ICON_BYTES && readPngHeader(icon)) out.icon = icon;
  if (src.list(LEGACY_PREFIX).length > 0) out.legacyFormat = true;
  return out;
}

/**
 * 内置层：通用的“从一个目录读”，不假设里面有什么（v1 不再自制贴图，素材来源待定，见 decisions.md M2a）。
 * 目录不存在时是一个空层：资源栈照常工作，所有资源退到上层或占位图。
 */
export async function openBuiltinLayer(root: string): Promise<ClosableLayer> {
  const exists = await stat(root).then(
    (s) => s.isDirectory(),
    () => false,
  );
  const dir = exists ? await scanDirectory(root) : null;
  return {
    id: BUILTIN_LAYER_ID,
    kind: 'builtin',
    name: 'builtin',
    enabled: true,
    revision: dir?.revision ?? 'empty',
    warnings: dir?.warnings ?? [],
    has: (path) => dir?.has(path) ?? false,
    read: async (path) => (dir ? dir.read(path) : null),
    list: (prefix) => dir?.list(prefix) ?? [],
    close: () => undefined,
  };
}

/** 文件夹形式的资源包。只记路径；窗口重新获得焦点时由调用方重新打开（重扫） */
export async function openFolderPack(root: string, id: string): Promise<ClosableLayer> {
  const dir = await scanDirectory(root);
  const info = await packInfo(dir);
  return {
    id,
    kind: 'pack',
    name: basename(root),
    enabled: true,
    revision: dir.revision,
    warnings: dir.warnings,
    ...info,
    has: dir.has,
    read: dir.read,
    list: dir.list,
    close: () => undefined,
  };
}

function zipLayer(zip: ZipArchive, id: string, name: string, revision: string, info: Awaited<ReturnType<typeof packInfo>>): ClosableLayer {
  return {
    id,
    kind: 'pack',
    name,
    enabled: true,
    revision,
    warnings: zip.warnings,
    ...info,
    has: zip.has,
    read: zip.read,
    list: zip.list,
    close: zip.close,
  };
}

/**
 * zip 形式的资源包（通常是 userData/packs/<内容哈希>.zip）。
 * 名字不安全的条目会让整个包被拒绝（抛 ZipRejectedError）。
 */
export async function openZipPack(file: string, id: string, displayName?: string): Promise<ClosableLayer> {
  const zip = await openZip(file);
  try {
    const st = await stat(file);
    const info = await packInfo(zip);
    return zipLayer(zip, id, displayName ?? basename(file).replace(/\.zip$/i, ''), `${st.size}:${Math.round(st.mtimeMs)}`, info);
  } catch (err) {
    zip.close();
    throw err;
  }
}
