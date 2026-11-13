import { expect, test } from '@playwright/test';
import { CONTENT_SECURITY_POLICY } from '../../apps/desktop/src/main/security-policy';
import { launchApp, makeUserDataDir, readMainLog, removeUserDataDir, type Launched } from './helpers';

// 1.6 安全基线在真实 Electron 里的表现。

let dir: string;
let launched: Launched;

test.beforeAll(async () => {
  dir = makeUserDataDir();
  launched = await launchApp(dir);
});

test.afterAll(async () => {
  await launched.app.close();
  removeUserDataDir(dir);
});

test('T-ARC-2 渲染进程里没有 require 和 process（开发态，未打包）', async () => {
  const { page } = launched;
  const globals = await page.evaluate(() => {
    const g = globalThis as Record<string, unknown>;
    return {
      require: typeof g.require,
      process: typeof g.process,
      module: typeof g.module,
      Buffer: typeof g.Buffer,
      allay: typeof g.allay,
    };
  });
  expect(globals).toEqual({ require: 'undefined', process: 'undefined', module: 'undefined', Buffer: 'undefined', allay: 'object' });

  // window.allay 被冻结在隔离世界之外，页面改不了它
  const tampered = await page.evaluate(() => {
    try {
      (window.allay as unknown as Record<string, unknown>).app = null;
    } catch {
      // 严格模式下会抛
    }
    return typeof window.allay.app.info;
  });
  expect(tampered).toBe('function');
});

test('T-ARC-2 主窗口的 webPreferences 与 1.6 第 1 条一致', async () => {
  const prefs = await launched.app.evaluate(({ BrowserWindow }) => {
    // getLastWebPreferences 不在 Electron 的公开类型里，只用于测试里核对
    const wc = BrowserWindow.getAllWindows()[0]?.webContents as unknown as { getLastWebPreferences(): Record<string, unknown> } | undefined;
    const p = wc?.getLastWebPreferences();
    return p
      ? {
          contextIsolation: p.contextIsolation,
          sandbox: p.sandbox,
          nodeIntegration: p.nodeIntegration,
          nodeIntegrationInWorker: p.nodeIntegrationInWorker,
          nodeIntegrationInSubFrames: p.nodeIntegrationInSubFrames,
          webSecurity: p.webSecurity,
        }
      : null;
  });
  expect(prefs).toEqual({
    contextIsolation: true,
    sandbox: true,
    nodeIntegration: false,
    nodeIntegrationInWorker: false,
    nodeIntegrationInSubFrames: false,
    webSecurity: true,
  });
});

test('页面由 app:// 提供，响应带 1.6 第 2 条的 CSP', async () => {
  const { page } = launched;
  expect(page.url()).toBe('app://renderer/index.html');
  const csp = await page.evaluate(async () => (await fetch('app://renderer/index.html')).headers.get('content-security-policy'));
  expect(csp).toBe(CONTENT_SECURITY_POLICY);
  // 越出根目录的路径拿不到
  const traversal = await page.evaluate(async () => (await fetch('app://renderer/..%2f..%2fpackage.json')).status);
  expect(traversal).toBe(404);
});

test('T-ARC-3 渲染进程主线程对外部地址的请求失败，主进程日志有拦截记录', async () => {
  const { page } = launched;
  const target = 'https://example.com/allay-t-arc-3';

  // 第一层：CSP 的 connect-src 'self' 在渲染进程里就挡住
  const withCsp = await page.evaluate(async (url) => {
    try {
      await fetch(url);
      return 'succeeded';
    } catch (e) {
      return `failed: ${String(e)}`;
    }
  }, target);
  expect(withCsp).toMatch(/^failed/);

  // 第二层（真正的保证）：即使 CSP 不在了，会话级拦截也取消请求并记日志。
  // 用 DevTools 协议关掉 CSP 后重新加载页面，再发一次。
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Page.setBypassCSP', { enabled: true });
  await page.reload();
  await page.waitForSelector('[data-testid="topbar"]');

  const bypassed = await page.evaluate(async (url) => {
    const results: string[] = [];
    for (const attempt of [
      () => fetch(url),
      () => fetch(`${url}?image`, { mode: 'no-cors' }),
      () =>
        new Promise<void>((resolve, reject) => {
          const img = new Image();
          img.onload = () => resolve();
          img.onerror = () => reject(new Error('image failed'));
          img.src = `${url}.png`;
        }),
    ]) {
      try {
        await attempt();
        results.push('succeeded');
      } catch {
        results.push('failed');
      }
    }
    return results;
  }, target);
  expect(bypassed).toEqual(['failed', 'failed', 'failed']);
  await cdp.send('Page.setBypassCSP', { enabled: false });

  await expect.poll(() => readMainLog(dir)).toContain('blocked request');
  const log = readMainLog(dir);
  expect(log).toMatch(/blocked request .*https:\/\/example\.com\/allay-t-arc-3/);
  // 查询参数不进日志
  expect(log).not.toContain('?image');
});

test('拒绝新窗口、页面跳转和权限请求（1.6 第 4 条）', async () => {
  const { app, page } = launched;
  const opened = await page.evaluate(() => window.open('https://example.com/') === null);
  expect(opened).toBe(true);
  expect(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length)).toBe(1);

  await page.evaluate(() => {
    window.location.href = 'https://example.com/navigate';
  });
  await page.waitForTimeout(300);
  expect(page.url()).toBe('app://renderer/index.html');

  const permission = await page.evaluate(() => Notification.requestPermission());
  expect(permission).toBe('denied');

  const log = readMainLog(dir);
  expect(log).toContain('denied window.open');
  expect(log).toContain('blocked navigation');
});
