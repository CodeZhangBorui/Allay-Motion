import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { requiredTextures } from '../../packages/assets/src/index';
import { catalogJarEntries } from '../unit/helpers/resource-fixtures';
import { startFakeMojang, type FakeMojang } from './fake-mojang';
import { launchApp, makeUserDataDir, removeUserDataDir } from './helpers';

// 界面增强的端到端测试（docs/06-ui-design.md 6.10–6.13）：
// T-UX-5 首次启动引导的完整流程（选语言、主题立即生效，返回、跳过、完成后不再出现、设置里重新运行、跳过整个引导）；
// T-UX-6 引导里下载原版资源的分阶段进度（本机假服务器：取消、失败、成功）；
// T-UX-7 改快捷键后命令能被新按键触发（经 dispatcher），冲突、保留键、菜单里的显示、重启后保留、全部恢复默认；
// T-UX-8 默认文件夹（只经主进程的文件夹对话框；不存在、清除）。
// 全部在隐藏窗口里跑；下载只连本机假服务器，文件夹对话框由测试开关代替。

const REQUIRED = requiredTextures().map((r) => ({ id: r.id, path: r.anyOf[0]! }));

function readSettings(dir: string): { ui: { onboardingCompleted?: boolean; shortcuts?: Record<string, string | null>; theme?: string; language?: string }; project?: { folder: string | null }; export?: { folder: string | null } } {
  return JSON.parse(readFileSync(join(dir, 'settings.json'), 'utf8')) as ReturnType<typeof readSettings>;
}

/** 页面里未捕获的错误（例如 effect 的清理函数出错导致整页卸载） */
function watchErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  return errors;
}

async function htmlAttr(page: Page, name: 'lang' | 'data-theme'): Promise<string | null> {
  return page.evaluate((n) => document.documentElement.getAttribute(n), name);
}

test('T-UX-5 首次启动引导：完整流程、返回、跳过，完成后不再出现，设置里可以重新运行', async () => {
  const dir = makeUserDataDir();
  const picked = join(dir, 'picked-folder');
  mkdirSync(picked);
  try {
    let { app, page } = await launchApp(dir, { ALLAY_E2E_PICK_FOLDER: picked }, { firstRun: true, waitFor: '[data-testid="onboarding"]' });
    const errors = watchErrors(page);
    const ob = page.getByTestId('onboarding');
    await expect(ob).toHaveAttribute('data-step', 'language');
    await expect(page.getByTestId('onboarding-back')).toBeDisabled();
    // 主界面在下面但不可交互；主界面的快捷键不生效
    await page.keyboard.press('Control+KeyE');
    await expect(page.getByTestId('export-dialog')).toHaveCount(0);

    // 1 语言：选了立即生效
    await page.getByTestId('onboarding-language-en').click();
    await expect.poll(() => htmlAttr(page, 'lang')).toBe('en');
    await expect(page.getByTestId('onboarding-next')).toHaveText(/Continue/);
    await page.getByTestId('onboarding-language-zh-CN').click();
    await expect.poll(() => htmlAttr(page, 'lang')).toBe('zh-CN');
    await page.getByTestId('onboarding-next').click();

    // 2 外观：主题立即生效；返回再前进
    await expect(ob).toHaveAttribute('data-step', 'appearance');
    await page.getByTestId('onboarding-theme-light').click();
    await expect.poll(() => htmlAttr(page, 'data-theme')).toBe('light');
    await page.getByTestId('onboarding-motion-on').click();
    await expect.poll(() => page.evaluate(() => document.documentElement.dataset.reducedMotion)).toBe('true');
    await page.getByTestId('onboarding-back').click();
    await expect(ob).toHaveAttribute('data-step', 'language');
    // 走过的步骤可以从左边一列直接跳回去
    await page.getByTestId('onboarding-rail-appearance').click();
    await expect(ob).toHaveAttribute('data-step', 'appearance');
    await page.getByTestId('onboarding-skip').click();

    // 3 素材：“稍后再说”，不联网
    await expect(ob).toHaveAttribute('data-step', 'assets');
    await expect(ob.getByTestId('download-note')).toHaveCount(0);
    await page.getByTestId('onboarding-asset-download').getByRole('radio').click();
    // 选了“下载”也只显示说明和按钮，不会自己开始
    await expect(ob.getByTestId('download-note')).toContainText('piston-meta.mojang.com');
    await expect(ob.getByTestId('download-progress')).toHaveCount(0);
    await page.getByTestId('onboarding-asset-later').getByRole('radio').click();
    await page.getByTestId('onboarding-next').click();

    // 4 文件夹：只经主进程的文件夹对话框（测试开关代替）
    await expect(ob).toHaveAttribute('data-step', 'folders');
    await page.getByTestId('folder-project-choose').click();
    await expect(page.getByTestId('folder-project-path')).toHaveText(picked);
    await expect(page.getByTestId('folder-project-path')).toHaveAttribute('data-state', 'ok');
    await page.getByTestId('onboarding-next').click();

    // 5 完成：摘要，开始使用
    await expect(ob).toHaveAttribute('data-step', 'done');
    await expect(page.getByTestId('onboarding-summary-assets')).toHaveText('稍后再说');
    await expect(page.getByTestId('onboarding-summary-folders')).toContainText(picked);
    await page.getByTestId('onboarding-finish').click();
    await expect(ob).toHaveCount(0);
    await expect.poll(() => readSettings(dir).ui.onboardingCompleted).toBe(true);
    expect(readSettings(dir).ui.theme).toBe('light');
    expect(readSettings(dir).project?.folder).toBe(picked);
    // 主界面的快捷键恢复
    await page.keyboard.press('Control+Comma');
    await expect(page.getByTestId('settings-dialog')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('settings-dialog')).toHaveCount(0);
    expect(errors, '页面没有未捕获的错误').toEqual([]);
    await app.close();

    // 重启：不再出现
    ({ app, page } = await launchApp(dir, {}, { firstRun: true }));
    await page.waitForTimeout(500);
    await expect(page.getByTestId('onboarding')).toHaveCount(0);
    // 设置里重新运行；“跳过引导”直接结束
    await page.keyboard.press('Control+Comma');
    await page.getByTestId('settings-tab-general').click();
    await page.getByTestId('settings-rerun-onboarding').click();
    await expect(page.getByTestId('settings-dialog')).toHaveCount(0);
    await expect(page.getByTestId('onboarding')).toHaveAttribute('data-step', 'language');
    // 已经做过的选择保留着
    await expect(page.getByTestId('onboarding-language-zh-CN')).toHaveAttribute('aria-checked', 'true');
    await page.getByTestId('onboarding-skip-all').click();
    await expect(page.getByTestId('onboarding')).toHaveCount(0);
    expect(readSettings(dir).ui.onboardingCompleted).toBe(true);
    await app.close();
  } finally {
    removeUserDataDir(dir);
  }
});

test.describe('T-UX-6 引导里下载原版资源（本机假服务器）', () => {
  let server: FakeMojang;
  test.beforeAll(async () => {
    server = await startFakeMojang('9.9.9', catalogJarEntries(REQUIRED, {}));
  });
  test.afterAll(async () => {
    await server.close();
  });

  test('分阶段的进度：取消、失败（指明停在哪一步、可以重试）、成功', async () => {
    const dir = makeUserDataDir();
    try {
      const { app, page } = await launchApp(dir, { ALLAY_E2E_MOJANG_ORIGIN: server.origin }, { firstRun: true, waitFor: '[data-testid="onboarding"]' });
      const ob = page.getByTestId('onboarding');
      await page.getByTestId('onboarding-rail-language').waitFor();
      await page.getByTestId('onboarding-next').click();
      await page.getByTestId('onboarding-next').click();
      await expect(page.getByTestId('onboarding')).toHaveAttribute('data-step', 'assets');
      await page.getByTestId('onboarding-asset-download').getByRole('radio').click();
      // 点“开始下载”之前一个请求都没有
      expect(server.requests).toEqual([]);

      // 取消：jar 发了一半停住
      server.jarMode = 'hold';
      await ob.getByTestId('vanilla-download').click();
      const progress = ob.getByTestId('download-progress');
      await expect(progress).toHaveAttribute('data-status', 'running');
      await expect.poll(() => server.holding(), { timeout: 15_000 }).toBe(true);
      await expect(progress).toHaveAttribute('data-stage', 'jar');
      await expect(ob.getByTestId('download-stage-manifest')).toHaveAttribute('data-status', 'done');
      await expect(ob.getByTestId('download-stage-jar')).toHaveAttribute('data-status', 'active');
      await expect(ob.getByTestId('download-stage-sounds')).toHaveAttribute('data-status', 'pending');
      // 读数：已下载 / 总大小、百分比、当前在做什么
      await expect(ob.getByTestId('download-numbers')).toContainText('/');
      await expect(ob.getByTestId('download-activity')).toContainText('9.9.9');
      await expect.poll(async () => Number(await progress.getAttribute('data-fraction'))).toBeGreaterThan(0.2);
      // 悦灵捧着方块飞（全应用只此一只）
      await expect(page.getByTestId('allay-progress')).toBeVisible();
      await ob.getByTestId('download-cancel').click();
      await expect(progress).toHaveAttribute('data-status', 'canceled');
      await expect(ob.getByTestId('download-stage-jar')).toHaveAttribute('data-status', 'canceled');
      await expect(ob.getByTestId('download-canceled')).toBeVisible();

      // 失败：服务器返回 500，停在 jar
      server.jarMode = 'fail';
      await ob.getByTestId('download-retry').click();
      await expect(progress).toHaveAttribute('data-status', 'failed');
      await expect(ob.getByTestId('download-error')).toHaveAttribute('data-error', 'network');
      await expect(ob.getByTestId('download-stage-jar')).toHaveAttribute('data-status', 'failed');
      await expect(ob.getByTestId('download-stopped')).toBeVisible();

      // 成功：五个阶段都完成，100%
      server.jarMode = 'ok';
      await ob.getByTestId('download-retry').click();
      await expect(progress).toHaveAttribute('data-status', 'done', { timeout: 20_000 });
      for (const s of ['manifest', 'jar', 'extract', 'sounds', 'finalize']) await expect(page.getByTestId(`download-stage-${s}`)).toHaveAttribute('data-status', 'done');
      await expect(ob.getByTestId('download-percent')).toHaveText('100%');
      await expect(page.getByTestId('onboarding-assets-active')).toContainText('9.9.9');
      // 任意时刻全身悦灵最多一只（7.2）
      expect(await page.locator('[data-testid="allay-progress-bird"], [data-testid="allay-flyer-bird"]').count()).toBeLessThanOrEqual(1);
      await page.getByTestId('onboarding-next').click();
      await page.getByTestId('onboarding-next').click();
      await expect(page.getByTestId('onboarding-summary-assets')).toContainText('9.9.9');
      await page.getByTestId('onboarding-finish').click();
      await expect(page.getByTestId('onboarding')).toHaveCount(0);
      // 刚在引导里决定过素材：这次启动不再弹询问
      await expect(page.getByTestId('vanilla-discovery')).toHaveCount(0);
      await app.close();
    } finally {
      removeUserDataDir(dir);
    }
  });
});

test('T-UX-7 改快捷键：新按键经 dispatcher 触发命令；冲突、保留键、菜单显示、重启后保留、全部恢复默认', async () => {
  const dir = makeUserDataDir();
  try {
    let { app, page } = await launchApp(dir);
    const errors = watchErrors(page);
    const guides = async () => (await page.evaluate(() => window.allay.settings.get())).editor.guides;
    await page.keyboard.press('Control+Comma');
    await page.getByTestId('settings-tab-shortcuts').click();
    await expect(page.getByTestId('shortcut-row-loop')).toHaveAttribute('data-shortcut', 'L');
    // 搜索
    await page.getByTestId('shortcut-search').fill('Ctrl+K');
    await expect(page.locator('[data-testid^="shortcut-row-"]')).toHaveCount(1);
    await page.getByTestId('shortcut-search').fill('');

    // 安全框参考线本来没有快捷键：录一个 G
    await expect(page.getByTestId('shortcut-row-guides')).toHaveAttribute('data-shortcut', '');
    await page.getByTestId('shortcut-edit-guides').click();
    await page.keyboard.press('KeyG');
    await expect(page.getByTestId('shortcut-row-guides')).toHaveAttribute('data-shortcut', 'G');

    // 保留键：不允许
    await page.getByTestId('shortcut-edit-guides').click();
    await page.keyboard.press('Control+KeyV');
    await expect(page.getByTestId('shortcut-reserved')).toBeVisible();
    await expect(page.getByTestId('shortcut-row-guides')).toHaveAttribute('data-shortcut', 'G');

    // 冲突：L 已经是“循环开关”的；先取消，再替换
    await page.getByTestId('shortcut-edit-guides').click();
    await page.keyboard.press('KeyL');
    await expect(page.getByTestId('shortcut-conflict-prompt')).toBeVisible();
    await page.getByTestId('shortcut-conflict-cancel').click();
    await expect(page.getByTestId('shortcut-row-guides')).toHaveAttribute('data-shortcut', 'G');
    await expect(page.getByTestId('shortcut-row-loop')).toHaveAttribute('data-shortcut', 'L');
    // 录制时按 Esc 只取消录制，不关对话框
    await page.getByTestId('shortcut-edit-guides').click();
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('settings-dialog')).toBeVisible();
    await expect(page.getByTestId('shortcut-row-guides')).toHaveAttribute('data-shortcut', 'G');
    // 改“设置”自己的快捷键：Ctrl+Shift+P
    await page.getByTestId('shortcut-edit-settings').click();
    await page.keyboard.press('Control+Shift+KeyP');
    await expect(page.getByTestId('shortcut-row-settings')).toHaveAttribute('data-shortcut', 'Ctrl+Shift+P');
    await expect.poll(() => readSettings(dir).ui.shortcuts).toEqual({ guides: 'G', settings: 'Ctrl+Shift+P' });
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('settings-dialog')).toHaveCount(0);

    // 新按键触发命令；旧的默认键不再触发
    await page.mouse.click(5, 300);
    const before = await guides();
    await page.keyboard.press('KeyG');
    await expect.poll(guides).toBe(!before);
    await page.keyboard.press('Control+Comma');
    await page.waitForTimeout(300);
    await expect(page.getByTestId('settings-dialog')).toHaveCount(0);
    await page.keyboard.press('Control+Shift+KeyP');
    await expect(page.getByTestId('settings-dialog')).toBeVisible();
    await page.keyboard.press('Escape');

    // 菜单里显示的是新快捷键
    await page.getByRole('button', { name: '视图' }).click();
    await expect(page.getByRole('menuitem', { name: /安全框参考线/ })).toContainText('G');
    await page.keyboard.press('Escape');
    await app.close();

    // 重启后保留
    ({ app, page } = await launchApp(dir));
    await page.mouse.click(5, 300);
    const b2 = await guides();
    await page.keyboard.press('KeyG');
    await expect.poll(guides).toBe(!b2);
    // 全部恢复默认
    await page.keyboard.press('Control+Shift+KeyP');
    await page.getByTestId('settings-tab-shortcuts').click();
    await page.getByTestId('shortcut-reset-all').click();
    await expect(page.getByTestId('shortcut-row-settings')).toHaveAttribute('data-shortcut', 'Ctrl+,');
    await expect(page.getByTestId('shortcut-row-guides')).toHaveAttribute('data-shortcut', '');
    await expect.poll(() => readSettings(dir).ui.shortcuts).toEqual({});
    expect(errors, '页面没有未捕获的错误').toEqual([]);
    await app.close();
  } finally {
    removeUserDataDir(dir);
  }
});

test('T-UX-8 默认文件夹：经主进程对话框选择；导出对话框用同一个；不存在时标出来；可以清除', async () => {
  const dir = makeUserDataDir();
  const picked = join(dir, 'out-folder');
  mkdirSync(picked);
  try {
    const { app, page } = await launchApp(dir, { ALLAY_E2E_PICK_FOLDER: picked });
    await page.keyboard.press('Control+Comma');
    await page.getByTestId('settings-tab-folders').click();
    await expect(page.getByTestId('folder-project-path')).toHaveAttribute('data-state', 'unset');
    await expect(page.getByTestId('folder-export-path')).toHaveAttribute('data-state', 'unset');
    await page.getByTestId('folder-export-choose').click();
    await expect(page.getByTestId('folder-export-path')).toHaveText(picked);
    await page.getByTestId('folder-project-choose').click();
    await expect(page.getByTestId('folder-project-path')).toHaveAttribute('data-state', 'ok');
    await expect.poll(() => readSettings(dir).export?.folder).toBe(picked);
    expect(readSettings(dir).project?.folder).toBe(picked);
    await page.keyboard.press('Escape');

    // 导出对话框显示同一个文件夹
    await expect.poll(() => page.evaluate(() => window.__allayTest!.status().kind), { timeout: 20_000 }).toBe('ready');
    await page.keyboard.press('Control+KeyE');
    await expect(page.getByTestId('export-folder')).toHaveText(picked);
    await page.keyboard.press('Escape');

    // 文件夹被删掉：标出来（设置里的值不动）
    rmSync(picked, { recursive: true, force: true });
    expect(existsSync(picked)).toBe(false);
    await page.keyboard.press('Control+Comma');
    await page.getByTestId('settings-tab-folders').click();
    await expect(page.getByTestId('folder-export-path')).toHaveAttribute('data-state', 'missing');
    await expect(page.getByTestId('folder-export-problem')).toBeVisible();
    expect(readSettings(dir).export?.folder).toBe(picked);
    // 对话框“选中”一个不存在的文件夹：不记进设置
    await page.getByTestId('folder-project-reset').click();
    await expect(page.getByTestId('folder-project-path')).toHaveAttribute('data-state', 'unset');
    await page.getByTestId('folder-project-choose').click();
    await expect(page.getByTestId('folder-project-path')).toHaveAttribute('data-state', 'unset');
    await expect.poll(() => readSettings(dir).project?.folder).toBeNull();
    // 清除
    await page.getByTestId('folder-export-reset').click();
    await expect(page.getByTestId('folder-export-path')).toHaveAttribute('data-state', 'unset');
    await expect.poll(() => readSettings(dir).export?.folder).toBeNull();
    await app.close();
  } finally {
    removeUserDataDir(dir);
  }
});
