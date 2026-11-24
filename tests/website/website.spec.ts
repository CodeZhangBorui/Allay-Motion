// 官网精简冒烟测试（T-WEB-1 至 T-WEB-6）：在 Electron 自带的 Chromium 里打开 vite preview 起的构建产物，窗口不显示。
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { brandMessages } from '../../packages/ui/src/brand/messages';

const ROOT = resolve(import.meta.dirname, '../..');
const ELECTRON = createRequire(join(ROOT, 'apps/desktop/package.json'))('electron') as string;
const SITE = 'http://localhost:4180/';
const SHOWCASE_COUNT = 5;

const DISCLAIMER_EN = 'NOT AN OFFICIAL MINECRAFT PRODUCT. NOT APPROVED BY OR ASSOCIATED WITH MOJANG OR MICROSOFT.';
const DISCLAIMER_ZH = '本软件不是 Minecraft 官方产品，未经 Mojang 或 Microsoft 批准，也与它们无关。';

interface Session {
  app: ElectronApplication;
  page: Page;
  errors: string[];
  userData: string;
}

async function closeSession(session: Session | undefined): Promise<void> {
  if (!session) return;
  await session.app.close().catch(() => undefined);
  rmSync(session.userData, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
}

async function launch(width = 1440): Promise<Session> {
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) if (v !== undefined && k !== 'ELECTRON_RUN_AS_NODE' && k !== 'NODE_OPTIONS') env[k] = v;
  env.ALLAY_SITE_URL = SITE;
  env.ALLAY_SITE_WIDTH = String(width);
  const userData = mkdtempSync(join(tmpdir(), 'allay-website-test-'));
  env.ALLAY_SITE_USERDATA = userData;
  const app = await electron.launch({ executablePath: ELECTRON, args: [join(import.meta.dirname, 'electron-main.mjs')], env });
  const page = await app.firstWindow();
  const errors: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(`[console] ${m.text()}`);
  });
  page.on('pageerror', (e) => errors.push(`[pageerror] ${e.message}`));
  await page.reload();
  await expect(page.getByTestId('site-nav')).toBeVisible();
  return { app, page, errors, userData };
}

async function externalRequests(app: ElectronApplication): Promise<string[]> {
  return app.evaluate(() => (globalThis as unknown as { externalRequests: string[] }).externalRequests);
}

test.describe.configure({ mode: 'serial' });

let s: Session;

test.beforeAll(async () => {
  s = await launch();
});

test.afterAll(async () => {
  await closeSession(s);
});

test('T-WEB-1 页面加载：首屏实时预览与 5 个精选模板封面就绪，无报错、无外部请求', async () => {
  const { page } = s;
  const hero = page.getByTestId('hero-viewer');
  await expect(hero).toHaveAttribute('data-status', 'ready', { timeout: 60_000 });
  await expect(hero.getByTestId('live-chip')).toHaveCount(SHOWCASE_COUNT);
  await expect(page.getByTestId('template-card')).toHaveCount(SHOWCASE_COUNT);
  await expect(page.getByTestId('templates-more')).toHaveCount(1);

  await expect.poll(() => page.getByTestId('template-sheet').count(), { timeout: 60_000 }).toBe(SHOWCASE_COUNT);

  const mcIndex = join(ROOT, 'apps/website/public/mc/index.json');
  if (existsSync(mcIndex)) {
    const { gameVersion } = JSON.parse(readFileSync(mcIndex, 'utf8')) as { gameVersion: string };
    const note = hero.getByTestId('assets-note');
    await expect(note).toContainText('Mojang');
    await expect(note).toContainText(gameVersion);
  }
  expect(s.errors).toEqual([]);
  expect(await externalRequests(s.app)).toEqual([]);
});

test('T-WEB-2 交互链路：首屏切模板/拖时间轴、工作流调参、卡片载入顶部预览、特性卡交互全部响应正确', async () => {
  const { page } = s;
  const hero = page.getByTestId('hero-viewer');
  await expect(hero).toHaveAttribute('data-status', 'ready', { timeout: 60_000 });

  // 1. 首屏切换模板芯片
  const fallChip = hero.locator('[data-testid="live-chip"][data-template="allay.builtin.block-fall"]');
  await fallChip.click();
  await expect(fallChip).toHaveAttribute('aria-pressed', 'true');
  await expect(hero.getByTestId('live-template-name')).toHaveText(/方块坠落|Block fall/);

  // 2. 首屏时间轴拖动与键盘控制
  const timeline = hero.getByTestId('live-timeline');
  const box = (await timeline.boundingBox())!;
  await page.mouse.move(box.x + box.width * 0.25, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.72, box.y + box.height / 2, { steps: 4 });
  await page.mouse.up();
  await expect(hero.getByTestId('live-play')).toHaveAttribute('aria-label', /播放|Play/);
  const vAfterMouse = Number(await timeline.getAttribute('aria-valuenow'));
  expect(vAfterMouse).toBeGreaterThanOrEqual(55);
  await timeline.focus();
  await page.keyboard.press('Home');
  await expect(timeline).toHaveAttribute('aria-valuenow', '0');

  // 3. 工作流三步交互：选模板 → 调参数（滑块、图案、翻转）→ 导出预览
  const wf = page.getByTestId('workflow-tab-tune');
  await wf.scrollIntoViewIfNeeded();
  await expect(page.getByTestId('workflow-viewer')).toHaveAttribute('data-status', 'ready', { timeout: 60_000 });

  await wf.click();
  await expect(page.getByTestId('tune-controls')).toBeVisible();
  const sliderThumb = page.getByTestId('tune-cols').getByRole('slider');
  await sliderThumb.focus();
  const colsBefore = Number(await page.getByTestId('tune-cols-value').innerText());
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');
  expect(Number(await page.getByTestId('tune-cols-value').innerText())).toBeGreaterThan(colsBefore);

  const diagBtn = page.locator('[data-testid="tune-pattern"][data-value="diagonal"]');
  await diagBtn.click();
  await expect(diagBtn).toHaveAttribute('aria-pressed', 'true');

  const twistBtn = page.locator('[data-testid="tune-spin"][data-value="twist"]');
  await twistBtn.click();
  await expect(twistBtn).toHaveAttribute('aria-pressed', 'true');

  await page.getByTestId('workflow-tab-export').click();
  await expect(page.getByTestId('export-preview-panel')).toBeVisible();

  // 4. 特性卡交互：透明对比滑块 & 资源栈图层点击锁定
  const alphaSplit = page.getByTestId('alpha-split');
  await alphaSplit.scrollIntoViewIfNeeded();
  await alphaSplit.fill('24');
  await expect(alphaSplit).toHaveValue('24');

  const layerZero = page.locator('[data-testid="stack-layer"][data-layer="0"]');
  await layerZero.click();
  await expect(layerZero).toHaveAttribute('aria-pressed', 'true');

  // 5. 模板卡片点击「在顶部预览」切换首屏预览
  const pixelCardOpen = page.locator('[data-testid="template-card"][data-template="allay.builtin.pixel-dissolve"] [data-testid="template-open"]');
  await pixelCardOpen.scrollIntoViewIfNeeded();
  await pixelCardOpen.click();
  await expect(hero.getByTestId('live-template-name')).toHaveText(/像素溶解|Pixel dissolve/);
});

test('T-WEB-3 中英文和深浅色主题切换正常，无缺失文案键', async () => {
  const { page } = s;
  const lang0 = await page.evaluate(() => document.documentElement.lang);
  const title0 = await page.locator('h1').innerText();
  for (let round = 0; round < 2; round++) {
    await page.getByTestId('toggle-language').click();
    const lang = round === 0 ? (lang0 === 'en' ? 'zh-CN' : 'en') : lang0;
    await expect.poll(() => page.evaluate(() => document.documentElement.lang)).toBe(lang);
    if (round === 0) expect(await page.locator('h1').innerText()).not.toBe(title0);
  }
  expect(await page.evaluate(() => (window as unknown as { __siteMissingKeys: Set<string> }).__siteMissingKeys.size)).toBe(0);

  const theme0 = await page.evaluate(() => document.documentElement.dataset.theme);
  const bg0 = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  for (let round = 0; round < 2; round++) {
    await page.getByTestId('toggle-theme').click();
    const theme = round === 0 ? (theme0 === 'dark' ? 'light' : 'dark') : theme0;
    await expect.poll(() => page.evaluate(() => document.documentElement.dataset.theme)).toBe(theme);
    if (round === 0) expect(await page.evaluate(() => getComputedStyle(document.body).backgroundColor)).not.toBe(bg0);
  }
});

test('T-WEB-4 非官方声明逐字醒目、正文不写模板数量、开发者头像均为同源实图', async () => {
  const { page } = s;
  for (let round = 0; round < 2; round++) {
    const lang = (await page.evaluate(() => document.documentElement.lang)) as 'zh-CN' | 'en';
    const text = await page.locator('main').innerText();
    expect(text).not.toMatch(/\d+\s*个(内置)?模板|\d+\s+(built-in\s+)?templates/i);

    const box = page.getByTestId('disclaimer');
    await box.scrollIntoViewIfNeeded();
    await expect(box).toBeVisible();
    const disc = await box.innerText();
    expect(disc).toBe(brandMessages[lang].disclaimer);
    expect(disc).toContain(DISCLAIMER_EN);
    if (lang === 'zh-CN') expect(disc).toContain(DISCLAIMER_ZH);
    expect(await box.evaluate((el) => parseFloat(getComputedStyle(el).fontSize))).toBeGreaterThanOrEqual(13);

    await page.getByTestId('toggle-language').click();
    await expect.poll(() => page.evaluate(() => document.documentElement.lang)).not.toBe(lang);
  }

  const avatars = page.getByTestId('avatar');
  await expect(avatars).toHaveCount(3);
  await page.getByTestId('team').scrollIntoViewIfNeeded();
  for (const img of await avatars.all()) {
    await expect.poll(() => img.evaluate((el) => (el as HTMLImageElement).naturalWidth)).toBeGreaterThanOrEqual(128);
    expect(await img.evaluate((el) => new URL((el as HTMLImageElement).src).origin === location.origin)).toBe(true);
  }
});

test('T-WEB-5 窄屏（390px）无横向溢出，首屏预览与切换正常，无报错、无外部请求', async () => {
  const narrow = await launch(390);
  try {
    const { page } = narrow;
    const hero = page.getByTestId('hero-viewer');
    await expect(hero).toHaveAttribute('data-status', 'ready', { timeout: 60_000 });
    const chip = hero.locator('[data-testid="live-chip"][data-template="allay.builtin.item-stinger"]');
    await chip.click();
    await expect(chip).toHaveAttribute('aria-pressed', 'true');
    await page.getByTestId('site-footer').scrollIntoViewIfNeeded();
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
    expect(narrow.errors).toEqual([]);
    expect(await externalRequests(narrow.app)).toEqual([]);
  } finally {
    await closeSession(narrow);
  }
});

test('T-WEB-6 减少动效与字体拦截、rAF 停跑时，各级标题仍立即可见且不被遮挡', async () => {
  const bad = await launch();
  try {
    const { page } = bad;
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.route(/\.woff2?(\?|$)/, (r) => r.abort());
    await page.addInitScript(() => {
      window.requestAnimationFrame = () => 0;
    });
    await page.reload();
    await expect(page.getByTestId('site-nav')).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.dataset.reducedMotion)).toBe('true');

    await expect(page.locator('h1')).toBeVisible();
    for (const h of await page.locator('h1, h2').all()) {
      await h.scrollIntoViewIfNeeded();
      await expect(h).toBeVisible();
      const hidden = await h.evaluate((el) => {
        const cs = getComputedStyle(el);
        return cs.opacity === '0' || cs.visibility === 'hidden' || el.closest('[data-armed="true"][data-shown="false"]') !== null;
      });
      expect(hidden).toBe(false);
    }
    expect(bad.errors.filter((e) => !/woff2?|Failed to load resource|net::ERR_FAILED/.test(e))).toEqual([]);
  } finally {
    await closeSession(bad);
  }
});
