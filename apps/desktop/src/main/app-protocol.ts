import { readFile } from 'node:fs/promises';
import { extname } from 'node:path';
import { protocol } from 'electron';
import type { Logger } from './logger';
import { resolveAppPath } from './app-path';
import { APP_SCHEME, CONTENT_SECURITY_POLICY } from './security-policy';

// 1.6 第 2 条：渲染进程的页面由 app:// 提供（standard、secure），每个响应都带同一份 CSP。

/** 必须在 app ready 之前调用 */
export function registerAppScheme(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: APP_SCHEME,
      privileges: { standard: true, secure: true, supportFetchAPI: true, codeCache: true },
    },
  ]);
}

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.wasm': 'application/wasm',
  '.ogg': 'audio/ogg',
};

function respond(status: number, body: Uint8Array<ArrayBuffer> | null,contentType = 'text/plain; charset=utf-8'): Response {
  return new Response(body, {
    status,
    headers: {
      'Content-Type': contentType,
      'Content-Security-Policy': CONTENT_SECURITY_POLICY,
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'no-store',
    },
  });
}

export function handleAppProtocol(root: string, log: Logger): void {
  protocol.handle(APP_SCHEME, async (request) => {
    if (request.method !== 'GET' && request.method !== 'HEAD') return respond(405, null);
    const file = resolveAppPath(root, request.url);
    if (!file) {
      log.warn('protocol', 'rejected app:// path', { url: request.url.slice(0, 200) });
      return respond(404, null);
    }
    try {
      const data = await readFile(file);
      return respond(200, new Uint8Array(data), MIME[extname(file).toLowerCase()] ?? 'application/octet-stream');
    } catch {
      return respond(404, null);
    }
  });
}
