// 资源 ID 与资源包内文件路径之间的换算（docs/03-assets.md 3.2）。
// 资源 ID 写成“命名空间:路径”，省略命名空间时是 minecraft。

export const DEFAULT_NAMESPACE = 'minecraft';

export interface ResourceId {
  namespace: string;
  path: string;
}

const NAMESPACE_RE = /^[a-z0-9_.-]+$/;
const PATH_RE = /^[a-z0-9_.\-/]+$/;

/** 解析资源 ID；格式不对时返回 null（资源 ID 可能来自用户模板或资源包，不抛错） */
export function parseResourceId(id: string): ResourceId | null {
  const colon = id.indexOf(':');
  const namespace = colon < 0 ? DEFAULT_NAMESPACE : id.slice(0, colon);
  const path = colon < 0 ? id : id.slice(colon + 1);
  if (!NAMESPACE_RE.test(namespace) || !PATH_RE.test(path)) return null;
  if (!isSafeRelativePath(path)) return null;
  return { namespace, path };
}

/** 规范写法：总带命名空间 */
export function formatResourceId(id: ResourceId): string {
  return `${id.namespace}:${id.path}`;
}

export function normalizeResourceId(id: string): string | null {
  const parsed = parseResourceId(id);
  return parsed ? formatResourceId(parsed) : null;
}

/** 贴图 ID → 包内路径。`minecraft:block/stone` → `assets/minecraft/textures/block/stone.png` */
export function textureIdToPath(id: string): string | null {
  const parsed = parseResourceId(id);
  return parsed ? `assets/${parsed.namespace}/textures/${parsed.path}.png` : null;
}

/** 贴图的动画元数据文件路径 */
export function textureMetaPath(texturePath: string): string {
  return `${texturePath}.mcmeta`;
}

/** 音效名（sounds.json 里的 name）→ 候选文件路径。游戏只认 .ogg；本项目另认 .wav（3.8） */
export function soundNameToPaths(name: string): string[] {
  const parsed = parseResourceId(name);
  if (!parsed) return [];
  const base = `assets/${parsed.namespace}/sounds/${parsed.path}`;
  return [`${base}.ogg`, `${base}.wav`];
}

/** 某命名空间的 sounds.json */
export function soundsJsonPath(namespace: string): string {
  return `assets/${namespace}/sounds.json`;
}

/** 字体定义：`minecraft:default` → `assets/minecraft/font/default.json` */
export function fontIdToPath(id: string): string | null {
  const parsed = parseResourceId(id);
  return parsed ? `assets/${parsed.namespace}/font/${parsed.path}.json` : null;
}

/** 字体提供器里的贴图文件引用：`minecraft:font/ascii.png` → `assets/minecraft/textures/font/ascii.png` */
export function fontTextureToPath(file: string): string | null {
  const parsed = parseResourceId(file);
  return parsed ? `assets/${parsed.namespace}/textures/${parsed.path}` : null;
}

/**
 * 包内相对路径是否安全：只用正斜杠，没有空段、`.`、`..`，不是绝对路径，没有盘符和反斜杠。
 * 资源层的 has/read 只接受这样的路径，解压和文件夹读取也用它把关。
 */
export function isSafeRelativePath(path: string): boolean {
  if (path.length === 0 || path.length > 1024) return false;
  if (path.includes('\\') || path.includes('\0')) return false;
  if (path.startsWith('/') || /^[a-zA-Z]:/.test(path)) return false;
  for (const seg of path.split('/')) {
    if (seg === '' || seg === '.' || seg === '..') return false;
  }
  return true;
}
