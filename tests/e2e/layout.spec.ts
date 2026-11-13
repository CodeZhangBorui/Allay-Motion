import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { launchApp, makeUserDataDir, removeUserDataDir } from './helpers';

// T-UI-6：调整分栏、折叠左栏、重启 → 布局恢复。另外核对窗口位置和大小的记忆。

async function panelWidth(page: Page, side: 'left' | 'right'): Promise<number> {
  return page.getByTestId(`panel-${side}`).evaluate((el) => el.getBoundingClientRect().width);
}

/**
 * 用键盘调整分栏：分隔条可以聚焦，方向键按步长移动。
 * 不用合成的鼠标拖动：在有人正在用的桌面上，真实鼠标的移动会和 Playwright 合成的指针事件互相干扰，结果不稳定。
 */
async function resizeWithKeyboard(page: Page, side: 'left' | 'right', key: 'ArrowLeft' | 'ArrowRight', times: number): Promise<void> {
  const handle = page.getByTestId(`handle-${side}`);
  await handle.focus();
  await expect(handle).toBeFocused();
  for (let i = 0; i < times; i++) await page.keyboard.press(key);
}

test('T-UI-6 调整分栏、折叠左栏、重启后布局恢复', async () => {
  const dir = makeUserDataDir();
  try {
    let first = await launchApp(dir);
    let page = first.page;

    // 默认 280 / 320
    expect(Math.round(await panelWidth(page, 'left'))).toBe(280);
    expect(Math.round(await panelWidth(page, 'right'))).toBe(320);

    // 左栏加宽（左分隔条右移），右栏加宽（右分隔条左移）
    await resizeWithKeyboard(page, 'left', 'ArrowRight', 3);
    await resizeWithKeyboard(page, 'right', 'ArrowLeft', 3);
    // 分栏宽度按像素给，150% 缩放下布局会有 0.01 px 级的取整误差（分隔条变成 2 px 后出现），按整像素比
    const leftAfterDrag = Math.round(await panelWidth(page, 'left'));
    const rightAfterDrag = Math.round(await panelWidth(page, 'right'));
    expect(leftAfterDrag, 'left panel width after resize').toBeGreaterThan(300);
    expect(leftAfterDrag).toBeLessThanOrEqual(360);
    expect(rightAfterDrag, 'right panel width after resize').toBeGreaterThan(340);
    expect(rightAfterDrag).toBeLessThanOrEqual(420);

    // Ctrl+B 折叠左栏
    await page.keyboard.press('Control+KeyB');
    await expect.poll(() => panelWidth(page, 'left')).toBe(0);

    // 等设置写盘（分栏变化合并 150 ms 后写）
    const settingsFile = join(dir, 'settings.json');
    await expect
      .poll(() => {
        try {
          return JSON.parse(readFileSync(settingsFile, 'utf8')).ui.layout.left.collapsed as boolean;
        } catch {
          return null;
        }
      })
      .toBe(true);
    const saved = JSON.parse(readFileSync(settingsFile, 'utf8'));
    expect(saved.formatVersion).toBe(1);

    await first.app.close();

    // 重启
    first = await launchApp(dir);
    page = first.page;
    await expect.poll(() => panelWidth(page, 'left')).toBe(0);
    expect(Math.abs((await panelWidth(page, 'right')) - rightAfterDrag)).toBeLessThanOrEqual(1);

    // 展开左栏，回到折叠前的宽度
    await page.keyboard.press('Control+KeyB');
    await expect.poll(async () => Math.abs((await panelWidth(page, 'left')) - leftAfterDrag)).toBeLessThanOrEqual(1);

    await first.app.close();
  } finally {
    removeUserDataDir(dir);
  }
});

test('窗口位置和大小在重启后恢复', async () => {
  const dir = makeUserDataDir();
  try {
    const first = await launchApp(dir);
    const target = { x: 120, y: 90, width: 1200, height: 760 };
    await first.app.evaluate(({ BrowserWindow }, b) => BrowserWindow.getAllWindows()[0]!.setBounds(b), target);
    await first.page.waitForTimeout(800);
    await first.app.close();

    const second = await launchApp(dir);
    const restored = await second.app.evaluate(({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows()[0]!;
      const b = win.getBounds();
      const c = win.getContentBounds();
      return { x: b.x, y: b.y, width: c.width, height: c.height };
    });
    // 位置按外框比，大小按内容区比（setBounds 之后内容区正好是请求的尺寸）
    expect(restored).toEqual(target);

    // 小于最小尺寸的请求被钳制到 1120×700
    const min = await second.app.evaluate(({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows()[0]!;
      win.setBounds({ width: 800, height: 500 });
      return win.getBounds();
    });
    expect(min.width).toBeGreaterThanOrEqual(1120);
    expect(min.height).toBeGreaterThanOrEqual(700);
    await second.app.close();
  } finally {
    removeUserDataDir(dir);
  }
});
