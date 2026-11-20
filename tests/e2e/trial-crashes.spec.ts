import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { launchApp, makeUserDataDir, readMainLog, removeUserDataDir, ROOT, type Launched } from './helpers';

// 试用安装版时报的三个缺陷各一条复现（docs/decisions.md “试用版的三个崩溃”），以及错误边界、未捕获错误写日志。
// 修复前：缺陷 1、3 的那一步之后整棵界面卸载（黑屏、pageerror Base UI #31），缺陷 2 的预览报 unknown group。
// 窗口不显示、不抢焦点。

let launched: Launched | null = null;
let dir = '';

test.afterEach(async () => {
  await launched?.app.close();
  launched = null;
  if (dir) removeUserDataDir(dir);
  dir = '';
});

async function start(): Promise<{ page: Page; errors: string[] }> {
  dir = makeUserDataDir();
  launched = await launchApp(dir);
  const { page } = launched;
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  await page.waitForFunction(() => window.__allayTest?.previewUpToDate() === true, undefined, { timeout: 30_000 });
  return { page, errors };
}

async function expectAlive(page: Page): Promise<void> {
  await expect(page.getByTestId('topbar')).toBeVisible();
  await expect(page.getByTestId('error-boundary')).toHaveCount(0);
}

test('缺陷 1：没有用户预设时点开属性面板的“预设”下拉，界面不崩', async () => {
  const { page, errors } = await start();
  expect(await page.evaluate(() => window.__allayTest!.listPresets())).toEqual([]);
  await page.getByTestId('preset-menu').click();
  // 默认模板（方块擦除）自带预设（decisions.md“方块排列顺序”），所以列表里只有自带的那几项
  await expect(page.getByTestId('preset-builtin:rainbow-concrete-columns')).toBeVisible();
  await expect(page.getByTestId('preset-none')).toHaveCount(0);
  await expect(page.getByTestId('preset-save')).toBeVisible();
  await expectAlive(page);
  expect(errors).toEqual([]);
});

test('缺陷 3：文件菜单里悬停“最近的工程”（还没有最近的工程）、再新建工程，界面不崩', async () => {
  const { page, errors } = await start();
  await page.getByTestId('project-menu').click();
  await page.getByTestId('project-recents').hover();
  await expect(page.getByTestId('project-no-recents')).toBeVisible();
  await expectAlive(page);
  // 再去点“新建工程”（子菜单开着时 Base UI 让父菜单不接指针事件，Playwright 的指针是跳过去的，所以先关掉菜单再开）
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('project-new')).toBeHidden();
  await page.getByTestId('project-menu').click();
  await page.getByTestId('project-new').click();
  await expectAlive(page);
  // 有未保存的改动时：先确认，再新建
  await page.evaluate(() => window.__allayTest!.setParams({ cols: 20 }));
  await page.getByTestId('project-menu').click();
  await page.getByTestId('project-new').click();
  await page.getByTestId('confirm-ok').click();
  await page.waitForFunction(() => window.__allayTest!.project().params.cols !== 20);
  await expectAlive(page);
  expect(errors).toEqual([]);
});

test('缺陷 2：从 T1 另存出的派生模板能打开（预览就绪、属性面板按分组显示）', async () => {
  const { page, errors } = await start();
  const r = await page.evaluate(() =>
    window.allay.templates.saveDerived({ base: { id: 'allay.builtin.block-wipe', version: '1.0.0' }, name: '234', defaults: { cols: 12 }, hidden: [] }),
  );
  if (!r.ok) throw new Error(r.error);
  await page.evaluate(([id, v]) => window.__allayTest!.selectTemplate(id!, v!), [r.entry.id, r.entry.version]);
  await page.waitForFunction(() => ['ready', 'error', 'crashed'].includes(window.__allayTest!.status().kind), undefined, { timeout: 30_000 });
  expect(await page.evaluate(() => window.__allayTest!.status())).toMatchObject({ kind: 'ready' });
  await expect(page.getByTestId('preview-error')).toHaveCount(0);
  // 属性面板的分组标题来自基模板的 groups
  const base = JSON.parse(readFileSync(join(ROOT, 'packages/templates/block-wipe/manifest.json'), 'utf8')) as { groups: { label: Record<string, string> | string }[] };
  const firstGroup = base.groups[0]!.label;
  const lang = await page.evaluate(() => document.documentElement.lang);
  const text = typeof firstGroup === 'string' ? firstGroup : (firstGroup[lang] ?? firstGroup.en)!;
  await expect(page.getByTestId('params-panel').getByText(text, { exact: true }).first()).toBeVisible();
  expect(errors).toEqual([]);
});

test('装载失败的提示：校验错误整理成“哪个参数、什么问题”，原始 issue 在诊断信息里', async () => {
  const { page } = await start();
  const base = JSON.parse(readFileSync(join(ROOT, 'packages/templates/block-wipe/manifest.json'), 'utf8')) as Record<string, unknown>;
  // 修复前派生模板的生效 manifest 就是这样：参数引用了分组，分组本身没带过来
  const { groups: _g, ...broken } = base;
  await page.evaluate((m) => window.__allayTest!.loadUnchecked(m, 'export default { setup() { return { duration: 1, update() {} }; } };'), { ...broken, id: 'user.08ba8e.234' });
  const card = page.getByTestId('preview-error');
  await expect(card).toBeVisible({ timeout: 30_000 });
  const lines = page.getByTestId('preview-error-issues').locator('li');
  await expect(lines.first()).toContainText('group');
  const all = await lines.allTextContents();
  expect(all.length).toBeLessThanOrEqual(5);
  for (const l of all) expect(l).not.toMatch(/[{}[\]]|"code"|"path"/);
  // 原始 issue 进诊断信息
  await launched!.app.evaluate(({ clipboard }) => clipboard.writeText(''));
  await page.getByTestId('preview-copy-diagnostics').click();
  const copied = await launched!.app.evaluate(({ clipboard }) => clipboard.readText());
  const info = JSON.parse(copied) as { status: { issues: { path: unknown[]; message: string }[] } };
  expect(info.status.issues.length).toBeGreaterThan(all.length - 1);
  expect(info.status.issues[0]!.message).toMatch(/unknown group/);
});

test('错误边界：一块面板出错只换掉它（原因、重试、重新载入、复制诊断信息），写进日志；最外层出错显示整窗错误页', async () => {
  const { page } = await start();
  const app = launched!.app;
  // 面板：属性页
  await page.evaluate(() => window.__allayTest!.crashPanels(['right.props']));
  const panel = page.locator('[data-testid="error-boundary"][data-scope="right.props"]');
  await expect(panel).toBeVisible();
  await expect(page.getByTestId('topbar')).toBeVisible();
  await expect(page.getByTestId('gallery')).toBeVisible();
  await expect(panel.getByTestId('error-boundary-reason')).toHaveText('test crash in right.props');
  for (const id of ['error-boundary-retry', 'error-boundary-reload', 'error-boundary-copy']) await expect(panel.getByTestId(id)).toBeVisible();
  // 复制诊断信息
  await app.evaluate(({ clipboard }) => clipboard.writeText(''));
  await panel.getByTestId('error-boundary-copy').click();
  await expect(panel.getByTestId('error-boundary-copy-result')).toBeVisible();
  const info = JSON.parse(await app.evaluate(({ clipboard }) => clipboard.readText())) as Record<string, unknown>;
  expect(info).toMatchObject({ scope: 'right.props', error: { message: 'test crash in right.props' }, template: { id: 'allay.builtin.block-wipe' } });
  expect(String(info.componentStack)).toContain('CrashGate');
  // 写进了日志
  await expect.poll(() => readMainLog(dir)).toContain('[render-error] [right.props] Error: test crash in right.props');
  // 两种语言
  const zh = await panel.textContent();
  await page.evaluate(() => window.allay.settings.set({ language: document.documentElement.lang.startsWith('zh') ? 'en' : 'zh-CN' }));
  await expect.poll(() => panel.textContent()).not.toBe(zh);
  // 重试：恢复正常
  await page.evaluate(() => window.__allayTest!.crashPanels([]));
  await panel.getByTestId('error-boundary-retry').click();
  await expect(panel).toHaveCount(0);
  await expect(page.getByTestId('preset-menu')).toBeVisible();

  // 未捕获的 Promise 拒绝、异常也写进日志
  await page.evaluate(() => {
    setTimeout(() => void Promise.reject(new Error('smoke unhandled rejection')), 0);
    setTimeout(() => {
      throw new Error('smoke uncaught error');
    }, 0);
  });
  await expect.poll(() => readMainLog(dir)).toContain('[unhandled-rejection] Error: smoke unhandled rejection');
  await expect.poll(() => readMainLog(dir)).toContain('[uncaught] Error: smoke uncaught error');

  // 最外层：整窗错误页；“重新载入”回到正常界面
  await page.evaluate(() => window.__allayTest!.crashPanels(['app']));
  const full = page.locator('[data-testid="error-boundary"][data-scope="app"]');
  await expect(full).toBeVisible();
  await expect(page.getByTestId('topbar')).toHaveCount(0);
  await expect(full.getByTestId('error-boundary-retry')).toHaveCount(0);
  const bg = await full.evaluate((n) => getComputedStyle(n).backgroundColor);
  expect(bg).not.toBe('rgba(0, 0, 0, 0)');
  // 重新载入是整页导航：不等 Playwright 的导航完成判定，直接等界面回来
  await full.getByTestId('error-boundary-reload').click({ noWaitAfter: true });
  await page.waitForSelector('[data-testid="topbar"]', { timeout: 30_000 });
  await expect(page.getByTestId('error-boundary')).toHaveCount(0);
});
