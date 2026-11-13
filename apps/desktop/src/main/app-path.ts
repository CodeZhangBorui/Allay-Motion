import { isAbsolute, relative, resolve, sep } from 'node:path';
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
