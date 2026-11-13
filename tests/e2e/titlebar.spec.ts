import { execFileSync } from 'node:child_process';
import { expect, test } from '@playwright/test';
import { launchApp, makeUserDataDir, removeUserDataDir, type Launched } from './helpers';

// T-UI-8：切换主题 → 窗口按钮区域的颜色随之更新；拖动区可拖动窗口。
// 测试在后台运行（窗口不显示、不抢焦点、不碰真实鼠标），所以：
// - 颜色：核对主进程实际交给系统按钮区（title bar overlay）的颜色，而不是截屏取色；
// - 拖动：向窗口发 WM_NCHITTEST，确认拖动区被系统当作标题栏（HTCAPTION）——这正是 Windows 拖动窗口的依据；
//   按钮是普通客户区，系统按钮区是最小化/最大化/关闭。
// 取舍见 docs/decisions.md“测试在后台运行”。

test.skip(process.platform !== 'win32', 'title bar overlay 与 WM_NCHITTEST 只在 Windows 上验证（v1 只做 Windows）');

let dir: string;
let launched: Launched;

test.beforeAll(async () => {
  dir = makeUserDataDir();
  launched = await launchApp(dir);
  // 记录主进程对 setTitleBarOverlay 的每一次调用（只包一层，原样转发）
  await launched.app.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows()[0]!;
    const calls: { color?: string; symbolColor?: string }[] = [];
    const original = win.setTitleBarOverlay.bind(win);
    win.setTitleBarOverlay = (options) => {
      calls.push({ color: options.color, symbolColor: options.symbolColor });
      original(options);
    };
    (globalThis as unknown as { __overlayCalls: typeof calls }).__overlayCalls = calls;
  });
});

test.afterAll(async () => {
  await launched.app.close();
  removeUserDataDir(dir);
});

async function lastOverlayColors(l: Launched): Promise<{ color?: string; symbolColor?: string } | null> {
  return l.app.evaluate(() => {
    const calls = (globalThis as unknown as { __overlayCalls: { color?: string; symbolColor?: string }[] }).__overlayCalls;
    return calls.at(-1) ?? null;
  });
}

test('T-UI-8 切换主题时窗口按钮区域的颜色随之更新', async () => {
  const { page } = launched;

  // 窗口确实是在后台：没显示、没拿焦点
  const state = await launched.app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows()[0]!;
    return { visible: w.isVisible(), focused: w.isFocused() };
  });
  expect(state).toEqual({ visible: false, focused: false });

  // 浅色：按钮区底色是 --surface-1（#FFFFFF），符号色是 --foreground（#141B24）
  await page.evaluate(() => window.allay.settings.set({ theme: 'light' }));
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await expect.poll(() => lastOverlayColors(launched)).toEqual({ color: '#FFFFFF', symbolColor: '#141B24' });

  // 深色：#14171D / #F2F4F6
  await page.evaluate(() => window.allay.settings.set({ theme: 'dark' }));
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await expect.poll(() => lastOverlayColors(launched)).toEqual({ color: '#14171D', symbolColor: '#F2F4F6' });

  // 颜色和顶栏实际渲染出来的底色一致（顶栏与按钮区连成一条）
  const topbar = await page.getByTestId('topbar').evaluate((el) => getComputedStyle(el).backgroundColor);
  expect(topbar).toBe('rgb(20, 23, 29)');
});

const HT = { CLIENT: 1, CAPTION: 2, CLOSE: 20 } as const;

/** 向窗口发 WM_NCHITTEST，返回系统对每个点（物理像素屏幕坐标）的命中结果。不移动鼠标、不改变焦点。 */
function hitTest(hwnd: string, points: readonly { x: number; y: number }[]): number[] {
  const script = `
Add-Type @"
using System;
using System.Runtime.InteropServices;
public static class AllayHitTest {
  [DllImport("user32.dll")] static extern bool SetProcessDPIAware();
  [DllImport("user32.dll")] static extern IntPtr SendMessage(IntPtr h, uint m, IntPtr w, IntPtr l);
  public static long Hit(long hwnd, int x, int y) {
    SetProcessDPIAware();
    return SendMessage(new IntPtr(hwnd), 0x0084, IntPtr.Zero, new IntPtr(((y & 0xFFFF) << 16) | (x & 0xFFFF))).ToInt64();
  }
}
"@
${points.map((p) => `[AllayHitTest]::Hit(${hwnd}, ${Math.round(p.x)}, ${Math.round(p.y)})`).join('\n')}
`;
  const out = execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-Command', script], {
    encoding: 'utf8',
    timeout: 30_000,
    windowsHide: true,
  });
  return out.trim().split(/\s+/).map(Number);
}

test('T-UI-8 拖动区被系统当作标题栏，可交互元素不是拖动区', async () => {
  const { app, page } = launched;

  // 页面结构：顶栏是 drag，上面的按钮是 no-drag
  const layout = await page.evaluate(() => {
    const region = (el: Element) => getComputedStyle(el).getPropertyValue('-webkit-app-region') || getComputedStyle(el).getPropertyValue('app-region');
    const center = (el: Element) => {
      const r = el.getBoundingClientRect();
      return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
    };
    const drag = document.querySelector('[data-testid="drag-region"]')!;
    const buttons = [...document.querySelectorAll('[data-testid="topbar"] button')];
    return {
      topbar: region(document.querySelector('[data-testid="topbar"]')!),
      buttonRegions: buttons.map(region),
      dragPoint: center(drag),
      buttonPoints: buttons.map(center),
      contentPoint: center(document.querySelector('[data-testid="panel-right"]')!),
      width: window.innerWidth,
    };
  });
  expect(layout.topbar).toBe('drag');
  expect(layout.buttonRegions.length).toBeGreaterThan(0);
  for (const r of layout.buttonRegions) expect(r).toBe('no-drag');

  // 把页面坐标换成物理像素的屏幕坐标
  const target = await app.evaluate(
    ({ BrowserWindow, screen }, l) => {
      const win = BrowserWindow.getAllWindows()[0]!;
      const c = win.getContentBounds();
      const toScreen = (p: { x: number; y: number }) => screen.dipToScreenPoint({ x: Math.round(c.x + p.x), y: Math.round(c.y + p.y) });
      return {
        hwnd: win.getNativeWindowHandle().readBigUInt64LE(0).toString(),
        drag: toScreen(l.dragPoint),
        buttons: l.buttonPoints.map(toScreen),
        content: toScreen(l.contentPoint),
        // 系统按钮区最右边是关闭按钮
        close: toScreen({ x: l.width - 20, y: 20 }),
      };
    },
    layout,
  );

  const [drag, content, close, ...buttons] = hitTest(target.hwnd, [target.drag, target.content, target.close, ...target.buttons]);
  expect(drag, '拖动区应该命中标题栏（HTCAPTION），按住它系统就会拖动窗口').toBe(HT.CAPTION);
  expect(content, '页面内容是客户区').toBe(HT.CLIENT);
  expect(close, '最右边是系统的关闭按钮').toBe(HT.CLOSE);
  for (const b of buttons) expect(b, '顶栏上的按钮不是拖动区').toBe(HT.CLIENT);
});
