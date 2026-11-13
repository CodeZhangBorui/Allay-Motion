import { execFileSync } from 'node:child_process';
import { expect, test } from '@playwright/test';
import { launchApp, makeUserDataDir, removeUserDataDir, type Launched } from './helpers';

// T-UI-8：切换主题 → 窗口按钮区域的颜色随之更新；拖动区可拖动窗口。
// 两项都在真实的 Windows 窗口上验证：颜色从系统的窗口截图里取，拖动用系统级的鼠标输入。

test.skip(process.platform !== 'win32', 'title bar overlay 与系统鼠标输入只在 Windows 上验证（v1 只做 Windows）');

let dir: string;
let launched: Launched;

test.beforeAll(async () => {
  dir = makeUserDataDir();
  launched = await launchApp(dir);
  await launched.app.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows()[0]!;
    win.setBounds({ x: 80, y: 80, width: 1280, height: 800 });
    win.setAlwaysOnTop(true);
    win.focus();
  });
  await launched.page.waitForTimeout(500);
});

test.afterAll(async () => {
  await launched.app.close();
  removeUserDataDir(dir);
});

/** 截取窗口本身（含系统窗口按钮区），返回窗口按钮区内一个不落在图标上的像素的颜色 */
async function overlayPixel(l: Launched): Promise<string> {
  return l.app.evaluate(async ({ BrowserWindow, desktopCapturer, screen }) => {
    const win = BrowserWindow.getAllWindows()[0]!;
    const id = win.getMediaSourceId();
    const [w, h] = win.getSize() as [number, number];
    const sf = screen.getDisplayMatching(win.getBounds()).scaleFactor;
    const sources = await desktopCapturer.getSources({
      types: ['window'],
      thumbnailSize: { width: Math.round(w * sf), height: Math.round(h * sf) },
    });
    const img = sources.find((s) => s.id === id)?.thumbnail;
    if (!img || img.isEmpty()) return 'no capture';
    const size = img.getSize();
    const bmp = img.toBitmap(); // BGRA
    // 最右边“关闭”按钮的右上角附近：在按钮区内，避开图标
    const x = size.width - Math.round(4 * (size.width / w));
    const y = Math.round(4 * (size.height / h));
    const i = (y * size.width + x) * 4;
    const hex = (n: number | undefined) => (n ?? 0).toString(16).padStart(2, '0');
    return `#${hex(bmp[i + 2])}${hex(bmp[i + 1])}${hex(bmp[i])}`.toUpperCase();
  });
}

test('T-UI-8 切换主题时窗口按钮区域的颜色随之更新', async () => {
  const { app, page } = launched;
  // 鼠标移开，避免悬停高亮
  await page.mouse.move(400, 400);

  // 先确认截图里确实包含窗口按钮区：手动设一个醒目的颜色，应该能读到
  await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0]!.setTitleBarOverlay({ color: '#FF00FF', symbolColor: '#000000', height: 40 }),
  );
  await expect.poll(() => overlayPixel(launched), { timeout: 5000 }).toBe('#FF00FF');

  // 切到浅色：页面通过 window.allay.window.setTitleBarColors 把按钮区改成 --surface-1（#FFFFFF）
  await page.evaluate(() => window.allay.settings.set({ theme: 'light' }));
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await expect.poll(() => overlayPixel(launched), { timeout: 5000 }).toBe('#FFFFFF');

  // 切回深色：#14171D
  await page.evaluate(() => window.allay.settings.set({ theme: 'dark' }));
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await expect.poll(() => overlayPixel(launched), { timeout: 5000 }).toBe('#14171D');
});

/**
 * 用系统级的鼠标输入（user32）按住拖动区并移动；坐标是物理像素。
 * 返回按下之前光标所在位置的顶层窗口句柄，用来确认点到的确实是被测窗口（而不是盖在上面的别的置顶窗口）。
 */
function nativeDrag(from: { x: number; y: number }, to: { x: number; y: number }): bigint {
  const script = `
Add-Type @"
using System;
using System.Runtime.InteropServices;
using System.Threading;
public static class AllayNativeDrag {
  [DllImport("user32.dll")] static extern bool SetProcessDPIAware();
  [DllImport("user32.dll")] static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] static extern void mouse_event(uint f, uint dx, uint dy, uint d, UIntPtr e);
  [StructLayout(LayoutKind.Sequential)] public struct POINT { public int X; public int Y; }
  [DllImport("user32.dll")] static extern IntPtr WindowFromPoint(POINT p);
  [DllImport("user32.dll")] static extern IntPtr GetAncestor(IntPtr h, uint flags);
  public static long Drag(int x1, int y1, int x2, int y2) {
    SetProcessDPIAware();
    SetCursorPos(x1, y1); Thread.Sleep(150);
    POINT p; p.X = x1; p.Y = y1;
    long hit = GetAncestor(WindowFromPoint(p), 2).ToInt64();
    // 先单击一次把窗口激活（后台启动的窗口拿不到前台，第一次按下只会激活它）；间隔超过双击时间，免得触发最大化
    mouse_event(0x0002, 0, 0, 0, UIntPtr.Zero); Thread.Sleep(50);
    mouse_event(0x0004, 0, 0, 0, UIntPtr.Zero); Thread.Sleep(800);
    mouse_event(0x0002, 0, 0, 0, UIntPtr.Zero); Thread.Sleep(150);
    for (int i = 1; i <= 20; i++) { SetCursorPos(x1 + (x2 - x1) * i / 20, y1 + (y2 - y1) * i / 20); Thread.Sleep(25); }
    Thread.Sleep(150);
    mouse_event(0x0004, 0, 0, 0, UIntPtr.Zero); Thread.Sleep(150);
    return hit;
  }
}
"@
[AllayNativeDrag]::Drag(${Math.round(from.x)}, ${Math.round(from.y)}, ${Math.round(to.x)}, ${Math.round(to.y)})
`;
  const out = execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { encoding: 'utf8', timeout: 30_000 });
  return BigInt(out.trim().split(/s+/).pop() ?? '0');
}

test('T-UI-8 拖动区可以拖动窗口，可交互元素不是拖动区', async () => {
  const { app, page } = launched;

  // 结构：拖动区是 drag，上面的按钮是 no-drag
  const regions = await page.evaluate(() => {
    const region = (el: Element | null) => (el ? getComputedStyle(el).getPropertyValue('-webkit-app-region') || getComputedStyle(el).getPropertyValue('app-region') : null);
    const drag = document.querySelector('[data-testid="drag-region"]');
    const rect = drag!.getBoundingClientRect();
    const hit = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2);
    return {
      topbar: region(document.querySelector('[data-testid="topbar"]')),
      hitIsDragRegion: hit === drag,
      buttons: [...document.querySelectorAll('[data-testid="topbar"] button')].map((b) => region(b)),
      center: { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 },
    };
  });
  expect(regions.topbar).toBe('drag');
  expect(regions.hitIsDragRegion).toBe(true);
  expect(regions.buttons.length).toBeGreaterThan(0);
  for (const b of regions.buttons) expect(b).toBe('no-drag');

  // 真实拖动：在拖动区中点按下，往右下拖 120×60（DIP）
  const before = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.getBounds());
  const points = await app.evaluate(
    ({ BrowserWindow, screen }, c) => {
      const win = BrowserWindow.getAllWindows()[0]!;
      win.moveTop();
      win.focus();
      const content = win.getContentBounds();
      const from = { x: Math.round(content.x + c.x), y: Math.round(content.y + c.y) };
      const to = { x: from.x + 120, y: from.y + 60 };
      return {
        from: screen.dipToScreenPoint(from),
        to: screen.dipToScreenPoint(to),
        hwnd: win.getNativeWindowHandle().readBigUInt64LE(0).toString(),
      };
    },
    regions.center,
  );
  const hit = nativeDrag(points.from, points.to);
  expect(hit.toString(), '按下的位置上应该是被测窗口本身；不是的话说明有别的置顶窗口盖住了它').toBe(points.hwnd);

  // 系统的拖动阈值会吃掉开头几个像素，所以位移允许 ±15 DIP 的误差；窗口大小不变
  await expect(async () => {
    const after = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.getBounds());
    const dx = after.x - before.x;
    const dy = after.y - before.y;
    expect(Math.abs(dx - 120), `水平位移 ${dx}`).toBeLessThanOrEqual(15);
    expect(Math.abs(dy - 60), `垂直位移 ${dy}`).toBeLessThanOrEqual(15);
    expect([after.width, after.height]).toEqual([before.width, before.height]);
  }).toPass({ timeout: 5000 });
});
