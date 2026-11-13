import { app, type Session, type WebContents } from 'electron';
import type { Logger } from './logger';
import { devContentSecurityPolicy, isRequestAllowed, redactUrl } from './security-policy';

// 1.6 第 3、4 条：会话级网络拦截；拒绝新窗口、跳转、权限请求。

const hardenedSessions = new WeakSet<Session>();

export function hardenSession(session: Session, devOrigin: string | null, log: Logger): void {
  if (hardenedSessions.has(session)) return;
  hardenedSessions.add(session);

  // 不传过滤器：所有请求都经过这里，包括 Worker 和子资源发出的
  session.webRequest.onBeforeRequest((details, callback) => {
    if (isRequestAllowed(details.url, devOrigin)) {
      callback({});
      return;
    }
    log.warn('net', 'blocked request', {
      url: redactUrl(details.url),
      resourceType: details.resourceType,
      method: details.method,
    });
    callback({ cancel: true });
  });

  // 开发模式下页面来自 Vite 开发服务器，给它的响应补上同一份 CSP（只多放行开发服务器本身）
  if (devOrigin) {
    const csp = devContentSecurityPolicy(devOrigin);
    session.webRequest.onHeadersReceived((details, callback) => {
      const headers = { ...details.responseHeaders };
      if (details.url.startsWith(devOrigin)) {
        for (const key of Object.keys(headers)) {
          if (key.toLowerCase() === 'content-security-policy') delete headers[key];
        }
        headers['Content-Security-Policy'] = [csp];
      }
      callback({ responseHeaders: headers });
    });
  }

  session.setPermissionRequestHandler((_wc, permission, callback) => {
    log.warn('security', 'denied permission request', { permission });
    callback(false);
  });
  session.setPermissionCheckHandler(() => false);
  session.setDevicePermissionHandler(() => false);
  session.setDisplayMediaRequestHandler((_request, callback) => {
    log.warn('security', 'denied display media request');
    callback({});
  });
  session.on('will-download', (event, item) => {
    log.warn('security', 'blocked download', { url: redactUrl(item.getURL()) });
    event.preventDefault();
  });
}

export function hardenWebContents(contents: WebContents, log: Logger): void {
  contents.setWindowOpenHandler(({ url }) => {
    log.warn('security', 'denied window.open', { url: redactUrl(url) });
    return { action: 'deny' };
  });
  contents.on('will-navigate', (event, url) => {
    log.warn('security', 'blocked navigation', { url: redactUrl(url) });
    event.preventDefault();
  });
  contents.on('will-frame-navigate', (event) => {
    if (!event.isMainFrame) {
      log.warn('security', 'blocked subframe navigation', { url: redactUrl(event.url) });
      event.preventDefault();
    }
  });
  contents.on('will-redirect', (event, url) => {
    log.warn('security', 'blocked redirect', { url: redactUrl(url) });
    event.preventDefault();
  });
  contents.on('will-attach-webview', (event) => {
    log.warn('security', 'blocked webview');
    event.preventDefault();
  });
}

/** 对之后创建的所有 webContents 和 session 生效 */
export function installGlobalHardening(devOrigin: string | null, log: Logger): void {
  app.on('web-contents-created', (_event, contents) => hardenWebContents(contents, log));
  app.on('session-created', (session) => hardenSession(session, devOrigin, log));
}
