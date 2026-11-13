// test:engine 用的 Electron 主进程：在一个不显示的窗口里打开测试页（真实 Chromium、真实 WebGL2，不弹窗、不抢焦点）。
// 页面由自定义协议 harness:// 提供，并带上和应用完全相同的 CSP，这样 Worker、Blob URL 的模板装载走的是同样的限制。
import { readFileSync } from 'node:fs';
import { extname, join, normalize, resolve } from 'node:path';
import { app, BrowserWindow, protocol, session } from 'electron';

const ROOT = resolve(import.meta.dirname, 'out');
const policySrc = readFileSync(resolve(import.meta.dirname, '../../apps/desktop/src/main/security-policy.ts'), 'utf8');
// 取 CONTENT_SECURITY_POLICY = "..." + "..."; 里的字符串字面量拼起来
const start = policySrc.indexOf('CONTENT_SECURITY_POLICY =');
if (start < 0) throw new Error('cannot find CONTENT_SECURITY_POLICY in security-policy.ts');
const expr = policySrc.slice(start, policySrc.indexOf('export', start));
const CSP = [...expr.matchAll(/"([^"]*)"/g)].map((m) => m[1]).join('');
if (!CSP.startsWith("default-src 'none'")) throw new Error(`unexpected CSP: ${CSP}`);
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' };

protocol.registerSchemesAsPrivileged([{ scheme: 'harness', privileges: { standard: true, secure: true, supportFetchAPI: true } }]);
app.setPath('userData', join(app.getPath('temp'), `allay-engine-harness-${process.pid}`));

app.whenReady().then(() => {
  // 和应用一样：外部请求一律取消
  session.defaultSession.webRequest.onBeforeRequest((details, cb) => {
    const ok = /^(harness|blob|data|devtools):/.test(details.url);
    cb({ cancel: !ok });
  });
  protocol.handle('harness', (req) => {
    const url = new URL(req.url);
    const file = normalize(join(ROOT, decodeURIComponent(url.pathname)));
    if (!file.startsWith(ROOT)) return new Response('not found', { status: 404 });
    try {
      return new Response(readFileSync(file), {
        headers: { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream', 'content-security-policy': CSP },
      });
    } catch {
      return new Response('not found', { status: 404 });
    }
  });
  const win = new BrowserWindow({
    show: false,
    skipTaskbar: true,
    width: 800,
    height: 600,
    webPreferences: { contextIsolation: true, sandbox: true, nodeIntegration: false, backgroundThrottling: false },
  });
  void win.loadURL('harness://engine/index.html');
});
app.on('window-all-closed', () => app.quit());
