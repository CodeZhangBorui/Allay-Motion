import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { APP_HOST, APP_SCHEME } from './security-policy';

/**
 * 把 app://renderer/<path> 映射到 root 下的文件；越出 root 或主机不对时返回 null。
 */
export function resolveAppPath(root: string, rawUrl: string): string | null {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return null;
  }
  if (url.protocol !== `${APP_SCHEME}:` || url.host !== APP_HOST) return null;
  let pathname: string;
  try {
    pathname = decodeURIComponent(url.pathname);
  } catch {
    return null;
  }
  if (pathname.includes('\0')) return null;
  if (pathname === '/' || pathname === '') pathname = '/index.html';
  const absRoot = resolve(root);
  const target = resolve(absRoot, `.${pathname}`);
  const rel = relative(absRoot, target);
  if (rel === '' || rel.startsWith('..') || isAbsolute(rel) || rel.split(sep).includes('..')) return null;
  return target;
}

/** 悦灵烘焙产物在 app://renderer/ 下的路径前缀（docs/decisions.md M5b） */
export const MASCOT_URL_PREFIX = '/mascot/';
/** 只认烘焙产物那种扁平的文件名：小写字母、数字、点、连字符，只有 .png 和 .json */
const MASCOT_FILE = /^[a-z0-9-]+(?:\.[a-z0-9-]+)*\.(?:png|json)$/;

/**
 * app://renderer/mascot/<文件名> → 烘焙产物目录里的文件。不是这个前缀时返回 undefined（交给 resolveAppPath）；
 * 是这个前缀但文件名不合格（子目录、..、别的扩展名）时返回 null。
 */
export function resolveMascotPath(mascotDir: string, rawUrl: string): string | null | undefined {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return undefined;
  }
  if (url.protocol !== `${APP_SCHEME}:` || url.host !== APP_HOST || !url.pathname.startsWith(MASCOT_URL_PREFIX)) return undefined;
  const name = url.pathname.slice(MASCOT_URL_PREFIX.length);
  if (!MASCOT_FILE.test(name)) return null;
  return join(resolve(mascotDir), name);
}
