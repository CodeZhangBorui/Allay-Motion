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

// 本机复现 CI 的软件渲染（docs/decisions.md M8）：ALLAY_ENGINE_ANGLE=d3d11-warp 让 Chromium 走 WARP
// （CI 上的 Microsoft Basic Render Driver），swiftshader 走 SwiftShader。不设时用显卡，和以前一样
const ANGLE_BACKENDS = new Set(['d3d11-warp', 'swiftshader']);
if (ANGLE_BACKENDS.has(process.env.ALLAY_ENGINE_ANGLE ?? '')) {
  app.commandLine.appendSwitch('use-gl', 'angle');
  app.commandLine.appendSwitch('use-angle', process.env.ALLAY_ENGINE_ANGLE);
}
// 双显卡的机器上显式用高性能显卡（和应用里引擎请求的 powerPreference: 'high-performance' 一致），免得换一台机器悄悄落到核显上；
// ALLAY_ENGINE_GPU=low-power 改用核显，复现核显上的问题（docs/decisions.md“Intel 核显上渲染目标偶发被写坏”）。只有一块显卡时两个开关都不起作用
app.commandLine.appendSwitch(process.env.ALLAY_ENGINE_GPU === 'low-power' ? 'force_low_power_gpu' : 'force_high_performance_gpu');

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
  // 测试不发出可听见的声音（音频测试只用 OfflineAudioContext，这里再保险一次）
  win.webContents.setAudioMuted(true);
  void win.loadURL('harness://engine/index.html');
});
app.on('window-all-closed', () => app.quit());
