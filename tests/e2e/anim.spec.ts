import { expect, test, type Page } from '@playwright/test';
import { launchApp, makeUserDataDir, removeUserDataDir, type Launched } from './helpers';

// 2026-11 反馈：开发模式、内嵌代码编辑器、动画工作区（docs/animation-editor.md；docs/decisions.md“2026-11 反馈”）。
// 判定用状态轮询（预览是否就绪、热重载完成的次数、画面哈希），不依赖固定的等待时间。窗口不显示、不抢焦点。

let launched: Launched | null = null;
let dir = '';

test.afterEach(async () => {
  await launched?.app.close();
  launched = null;
  removeUserDataDir(dir);
});

const ready = (page: Page) => page.waitForFunction(() => window.__allayTest?.previewUpToDate() === true, undefined, { timeout: 30_000 });

async function dispatch(page: Page, id: string, input?: unknown): Promise<unknown> {
  const r = await page.evaluate(({ id, input }) => window.__allayTest!.dispatch(id, input), { id, input });
  if (!r.ok) throw new Error(`${id}: ${r.message}`);
  return r.output;
}

const hash = (page: Page, t: number) => page.evaluate((x) => window.__allayTest!.previewHash(x), t);

async function animText(page: Page): Promise<{ text: string; revision: number; valid: boolean }> {
  return (await dispatch(page, 'animGet')) as { text: string; revision: number; valid: boolean };
}

test('T-DEV-6 开发模式有固定的位置：视图菜单开关、状态栏指示、左栏“开发”页；代码编辑器随它启用，改用户模板的代码保存后热重载', async () => {
  dir = makeUserDataDir();
  launched = await launchApp(dir);
  const { page } = launched;
  await ready(page);
  // 关着时界面和以前一样
  await expect(page.getByTestId('status-dev-mode')).toHaveCount(0);
  await expect(page.getByTestId('left-tab-dev')).toHaveCount(0);
  expect((await page.evaluate(() => window.__allayTest!.optionalModules())).active).toEqual([]);

  await page.getByRole('button', { name: /^(视图|View)$/ }).click();
  await page.getByTestId('menu-dev-mode').click();
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('status-dev-mode')).toBeVisible();
  await expect(page.getByTestId('left-tab-dev')).toBeVisible();
  await expect(page.getByTestId('dev-panel')).toBeVisible();
  await page.waitForFunction(() => window.__allayTest!.optionalModules().active.includes('code-editor'), undefined, { timeout: 15_000 });
  await expect(page.getByTestId('dev-current-kind')).toHaveAttribute('data-kind', 'builtin');

  // 复制内置模板 → 在应用里打开代码 → 改一行保存 → 热重载
  await page.getByTestId('dev-action-copyBuiltinTemplate').click();
  await page.waitForFunction(() => window.__allayTest!.project().ref?.id.startsWith('user.') === true && window.__allayTest!.previewUpToDate(), undefined, { timeout: 30_000 });
  await page.getByTestId('dev-tool-code-editor.open').click();
  const panel = page.getByTestId('code-editor-panel');
  await expect(panel).toHaveAttribute('data-status', 'saved', { timeout: 15_000 });
  const before = await page.evaluate(() => window.__allayTest!.devState().reloads);
  await panel.locator('.cm-content').click();
  await page.keyboard.press('Control+End');
  await page.keyboard.type('\n// edited in app\n');
  await expect(panel).toHaveAttribute('data-status', 'unsaved');
  await page.keyboard.press('Control+s');
  await expect(panel).toHaveAttribute('data-status', 'saved', { timeout: 10_000 });
  await page.waitForFunction((n) => window.__allayTest!.devState().reloads > n && window.__allayTest!.devState().phase === 'idle', before, { timeout: 10_000 });
  expect((await page.evaluate(() => window.__allayTest!.devState())).last?.ok).toBe(true);

  // 关掉开发模式：模块停用，面板和指示都撤掉
  await page.getByRole('button', { name: /^(视图|View)$/ }).click();
  await page.getByTestId('menu-dev-mode').click();
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => window.__allayTest!.optionalModules().active.length === 0, undefined, { timeout: 10_000 });
  await expect(page.getByTestId('code-editor-panel')).toHaveCount(0);
  await expect(page.getByTestId('status-dev-mode')).toHaveCount(0);
});

test('T-ANIM-3 新建动画、加图层、打关键帧、预览更新、撤销；代码视图与可视化编辑双向一致，代码写错时预览保持上一份', async () => {
  dir = makeUserDataDir();
  launched = await launchApp(dir);
  const { page } = launched;
  await ready(page);
  await page.getByTestId('project-menu').click();
  await page.getByTestId('menu-anim-new').click();
  await expect(page.getByTestId('anim-timeline')).toBeVisible();
  await expect(page.getByTestId('anim-layer')).toHaveCount(1);
  await ready(page);
  const h0 = await hash(page, 0.8);

  // 加一个色块、给它打关键帧：画面变了
  const id = (await dispatch(page, 'animAddLayer', { type: 'rect' })) as string;
  await expect(page.getByTestId('anim-layer')).toHaveCount(2);
  await dispatch(page, 'animSetKeyframe', { layer: id, prop: 'x', t: 0, v: -600 });
  await dispatch(page, 'animSetKeyframe', { layer: id, prop: 'x', t: 1.5, v: 600, ease: 'cubicOut' });
  await ready(page);
  const h1 = await hash(page, 0.8);
  expect(h1).not.toBe(h0);
  // 同一时刻再取一次结果相同（画面是时间的纯函数）
  expect(await hash(page, 0.8)).toBe(h1);

  // 撤销三步回到起点
  for (let i = 0; i < 3; i++) await dispatch(page, 'undo');
  await ready(page);
  expect(await hash(page, 0.8)).toBe(h0);
  await dispatch(page, 'redo');
  await expect(page.getByTestId('anim-layer')).toHaveCount(2);

  // 代码视图（开发模式关着：普通文本框）：改时长，可视化这边跟着变
  await page.getByTestId('anim-toggle-code').click();
  const code = page.getByTestId('anim-code-plain');
  await expect(code).toBeVisible();
  const { text } = await animText(page);
  expect(await code.inputValue()).toBe(text);
  await code.fill(text.replace(/"duration": 2,/, '"duration": 3,'));
  await page.waitForFunction(() => window.__allayTest!.transport().duration === 3, undefined, { timeout: 10_000 });
  // 可视化编辑：文本框跟着换成新的文档
  await code.blur();
  await dispatch(page, 'animAddLayer', { type: 'text' });
  await expect.poll(async () => (await code.inputValue()).includes('"type": "text"')).toBe(true);

  // 写错：列出原因，预览保持
  await ready(page);
  const good = await hash(page, 0.5);
  await code.fill('{ "kind": "allay-animation", oops }');
  await expect(page.getByTestId('anim-code-issues')).toBeVisible({ timeout: 10_000 });
  expect((await animText(page)).valid).toBe(false);
  await ready(page);
  expect(await hash(page, 0.5)).toBe(good);
});

test('T-ANIM-4 转为模板：模板库里出现一个普通的用户模板，选中它渲染出的画面与动画相同', async () => {
  dir = makeUserDataDir();
  launched = await launchApp(dir);
  const { page } = launched;
  await ready(page);
  await dispatch(page, 'animNew', { name: 'Roundtrip' });
  await ready(page);
  const h = await hash(page, 0.6);
  const ref = (await dispatch(page, 'animConvertToTemplate')) as { id: string; version: string };
  expect(ref.id).toMatch(/^user\.[0-9a-f]{6}\.roundtrip$/);
  const entries = await page.evaluate(() => window.__allayTest!.templates());
  const entry = entries.find((e) => e.id === ref.id);
  expect(entry?.source).toBe('user');
  expect(await page.evaluate((r) => window.__allayTest!.selectTemplate(r.id, r.version), ref)).toBe(true);
  await ready(page);
  await expect(page.getByTestId('anim-timeline')).toHaveCount(0);
  expect(await hash(page, 0.6)).toBe(h);
});
