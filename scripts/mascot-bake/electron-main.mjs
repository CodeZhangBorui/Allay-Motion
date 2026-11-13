// pnpm mascot:bake 的 Electron 主进程：在不显示的窗口里打开渲染页（不弹窗、不抢焦点、不进任务栏）。
// 页面由 bake:// 协议提供，带与应用相同的 CSP；外部请求一律取消（烘焙本身不联网）。
// 渲染页的目录由环境变量 ALLAY_BAKE_PAGE_DIR 给出（每次烘焙一个临时目录，可以并行）。
import { readFileSync } from 'node:fs';
import { extname, join, normalize, resolve } from 'node:path';
import { app, BrowserWindow, protocol, session } from 'electron';

const ROOT = resolve(process.env.ALLAY_BAKE_PAGE_DIR ?? '');
if (!process.env.ALLAY_BAKE_PAGE_DIR) throw new Error('ALLAY_BAKE_PAGE_DIR is not set');
const policySrc = readFileSync(resolve(import.meta.dirname, '../../apps/desktop/src/main/security-policy.ts'), 'utf8');
const start = policySrc.indexOf('CONTENT_SECURITY_POLICY =');
if (start < 0) throw new Error('cannot find CONTENT_SECURITY_POLICY in security-policy.ts');
const expr = policySrc.slice(start, policySrc.indexOf('export', start));
const CSP = [...expr.matchAll(/"([^"]*)"/g)].map((m) => m[1]).join('');
if (!CSP.startsWith("default-src 'none'")) throw new Error(`unexpected CSP: ${CSP}`);
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' };

protocol.registerSchemesAsPrivileged([{ scheme: 'bake', privileges: { standard: true, secure: true, supportFetchAPI: true } }]);
app.setPath('userData', join(app.getPath('temp'), `allay-mascot-bake-${process.pid}`));

app.whenReady().then(() => {
  session.defaultSession.webRequest.onBeforeRequest((details, cb) => {
    cb({ cancel: !/^(bake|blob|data|devtools):/.test(details.url) });
  });
  protocol.handle('bake', (req) => {
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
    width: 400,
    height: 300,
    webPreferences: { contextIsolation: true, sandbox: true, nodeIntegration: false, backgroundThrottling: false },
  });
  void win.loadURL('bake://mascot/index.html');
});
app.on('window-all-closed', () => app.quit());
