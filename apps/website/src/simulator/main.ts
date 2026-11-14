// 仿真器的入口（在落地页的 iframe 里）：先装上浏览器版的 window.allay，再启动桌面版渲染进程的真实入口
// apps/desktop/src/renderer/main.tsx。之后的界面、Zustand 状态、引擎 Worker、模板装载、导出管线全是桌面版的代码。
import { declareMascotAssetsMissing } from '@allay/mascot';
import { z } from 'zod';
import { FromSimulatorSchema, SiteLanguageSchema, SiteThemeSchema, ToSimulatorSchema, readMessage, type FromSimulator } from '../host/bridge';
import { createBrowserHost, installBrowserHost } from '../host/browser-host';
import { hostMessages } from '../site/i18n';
import './simulator.css';

// 悦灵的烘焙图集不随官网分发，组件用 CSS 占位实现（docs/decisions.md 官网）
declareMascotAssetsMissing();

const params = new URLSearchParams(window.location.search);
const theme = SiteThemeSchema.catch('dark').parse(params.get('theme'));
const language = SiteLanguageSchema.catch('en').parse(params.get('lang'));
document.documentElement.dataset.theme = theme;

const embedded = window.parent !== window;
function toParent(msg: FromSimulator): void {
  // 发出去之前也过一遍 schema，免得两边对不上
  if (embedded) window.parent.postMessage(FromSimulatorSchema.parse(msg), window.location.origin);
}

const host = createBrowserHost({
  settings: { theme, language },
  messages: hostMessages(),
  testHooks: params.has('e2e'),
  onDesktopOnly: (feature) => toParent({ channel: 'allay-sim', type: 'desktop-only', feature }),
  onExportFinished: ({ frames, preset }) => toParent({ channel: 'allay-sim', type: 'export-finished', frames, preset }),
  onSettings: (s) => toParent({ channel: 'allay-sim', type: 'settings', theme: s.theme, language: s.language }),
});
installBrowserHost(host.api);

// Windows 上 titleBarOverlay 画的那三个系统按钮：浏览器里没有，自己画在同一个位置（只是样子，不可点）
function drawCaptionButtons(): void {
  const bar = document.createElement('div');
  bar.className = 'sim-caption';
  bar.setAttribute('aria-hidden', 'true');
  bar.innerHTML =
    '<span><svg width="10" height="10" viewBox="0 0 10 10"><path d="M0 5h10" stroke="currentColor"/></svg></span>' +
    '<span><svg width="10" height="10" viewBox="0 0 10 10"><rect x=".5" y=".5" width="9" height="9" fill="none" stroke="currentColor"/></svg></span>' +
    '<span><svg width="10" height="10" viewBox="0 0 10 10"><path d="M0 0l10 10M10 0L0 10" stroke="currentColor"/></svg></span>';
  document.body.appendChild(bar);
}

const SelectSchema = z.object({ id: z.string(), version: z.string() });

window.addEventListener('message', (event) => {
  if (event.source !== window.parent) return;
  const msg = readMessage(event, ToSimulatorSchema);
  if (!msg) return;
  if (msg.type === 'settings') {
    host.applySettings({ theme: msg.theme, language: msg.language, reducedMotion: msg.reducedMotion ? 'on' : 'system' });
  } else if (msg.type === 'select') {
    const ref = SelectSchema.parse(msg);
    void import('../../../desktop/src/renderer/features/templates/actions').then(async ({ selectTemplate }) => {
      const i18next = (await import('i18next')).default;
      await selectTemplate(ref.id, ref.version, i18next.language);
    });
  }
});

drawCaptionButtons();
// 桌面版渲染进程的入口：bootstrap() 读 window.allay，初始化 i18n，挂上 <App />
await import('../../../desktop/src/renderer/main');
// main.tsx 的 bootstrap 是异步的：等根节点有了内容再告诉落地页
const root = document.getElementById('root');
const announce = () => toParent({ channel: 'allay-sim', type: 'ready' });
if (root && root.childElementCount > 0) announce();
else if (root) {
  const mo = new MutationObserver(() => {
    if (root.childElementCount === 0) return;
    mo.disconnect();
    announce();
  });
  mo.observe(root, { childList: true });
}
