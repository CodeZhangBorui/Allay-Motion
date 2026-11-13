// 安全策略的纯逻辑部分（不依赖 Electron，便于单元测试）。
// 来源：docs/01-product-architecture.md 1.6 第 2、3 条。

export const APP_SCHEME = 'app';
export const APP_HOST = 'renderer';
export const APP_ORIGIN = `${APP_SCHEME}://${APP_HOST}`;
export const APP_ENTRY_URL = `${APP_ORIGIN}/index.html`;

/** 1.6 第 2 条的内容安全策略，原样照抄，不得放宽 */
export const CONTENT_SECURITY_POLICY =
  "default-src 'none'; script-src 'self' blob:; worker-src 'self' blob:; style-src 'self' 'unsafe-inline'; " +
  "img-src 'self' blob: data:; media-src 'self' blob:; font-src 'self'; connect-src 'self'";

/**
 * 开发模式的 CSP：在生产 CSP 的基础上只额外放行本机开发服务器（http 与它的 HMR websocket）。
 * devOrigin 必须是本机地址，否则抛错。
 */
export function devContentSecurityPolicy(devOrigin: string): string {
  const origin = assertLocalDevOrigin(devOrigin);
  const ws = origin.replace(/^http/, 'ws');
  return CONTENT_SECURITY_POLICY.split('; ')
    .map((directive) => {
      const name = directive.split(' ')[0];
      switch (name) {
        case 'script-src':
        case 'worker-src':
        case 'style-src':
        case 'img-src':
        case 'media-src':
        case 'font-src':
          return `${directive} ${origin}`;
        case 'connect-src':
          return `${directive} ${origin} ${ws}`;
        default:
          return directive;
      }
    })
    .join('; ');
}

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

/** 只接受 http://<本机>:<端口>，返回规范化的 origin */
export function assertLocalDevOrigin(url: string): string {
  const parsed = new URL(url);
  if (parsed.protocol !== 'http:' || !LOCAL_HOSTS.has(parsed.hostname)) {
    throw new Error(`dev server must be a local http origin, got ${parsed.origin}`);
  }
  return parsed.origin;
}

/** 会话级网络拦截放行的协议（1.6 第 3 条） */
const ALLOWED_PROTOCOLS = new Set(['app:', 'blob:', 'data:', 'devtools:']);

/**
 * 判断一个请求是否放行。不是 app:、blob:、data:、devtools:（以及开发模式下本机开发服务器）的一律取消。
 */
export function isRequestAllowed(rawUrl: string, devOrigin: string | null): boolean {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return false;
  }
  if (ALLOWED_PROTOCOLS.has(url.protocol)) {
    // app: 只有一个主机
    return url.protocol !== 'app:' || url.host === APP_HOST;
  }
  if (devOrigin) {
    const dev = new URL(devOrigin);
    if ((url.protocol === 'http:' || url.protocol === 'ws:') && url.host === dev.host) return true;
  }
  return false;
}

/** 日志里只记 origin 和截短的路径，不记查询参数 */
export function redactUrl(rawUrl: string): string {
  try {
    const url = new URL(rawUrl);
    if (url.protocol === 'data:') return 'data:…';
    const path = url.pathname.length > 80 ? `${url.pathname.slice(0, 80)}…` : url.pathname;
    return `${url.protocol}//${url.host}${path}`;
  } catch {
    return rawUrl.slice(0, 80);
  }
}

/** 渲染进程页面所属的 origin：生产是 app://renderer，开发是本机开发服务器 */
export function isTrustedPageUrl(rawUrl: string, devOrigin: string | null): boolean {
  try {
    const url = new URL(rawUrl);
    if (url.origin === APP_ORIGIN || `${url.protocol}//${url.host}` === APP_ORIGIN) return true;
    return devOrigin !== null && url.origin === new URL(devOrigin).origin;
  } catch {
    return false;
  }
}
