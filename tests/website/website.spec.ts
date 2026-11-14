// 官网的冒烟测试（T-WEB-*，docs/decisions.md 官网）。在 Electron 自带的 Chromium 里打开 vite preview 起的构建产物，窗口不显示。
// 仿真器 iframe 带 ?e2e，里面装着桌面版同一套测试钩子（window.__allayTest），用它读预览画布的像素。
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';
import { _electron as electron, expect, test, type ElectronApplication, type Frame, type Page } from '@playwright/test';
import { brandMessages } from '../../packages/ui/src/brand/messages';

const ROOT = resolve(import.meta.dirname, '../..');
const ELECTRON = createRequire(join(ROOT, 'apps/desktop/package.json'))('electron') as string;
const SITE = 'http://localhost:4180/?e2e';
/** docs/09-compliance.md 9.5 的原文 */
const DISCLAIMER_EN = 'NOT AN OFFICIAL MINECRAFT PRODUCT. NOT APPROVED BY OR ASSOCIATED WITH MOJANG OR MICROSOFT.';
const DISCLAIMER_ZH = '本软件不是 Minecraft 官方产品，未经 Mojang 或 Microsoft 批准，也与它们无关。';

/** packages/templates 下的内置模板个数（官网应该一个不少地列出来） */
const TEMPLATE_COUNT = readdirSync(join(ROOT, 'packages/templates')).filter((d) => existsSync(join(ROOT, 'packages/templates', d, 'manifest.json'))).length;

interface Session {
  app: ElectronApplication;
  page: Page;
  errors: string[];
}

async function launch(width = 1440): Promise<Session> {
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) if (v !== undefined && k !== 'ELECTRON_RUN_AS_NODE' && k !== 'NODE_OPTIONS') env[k] = v;
  env.ALLAY_SITE_URL = SITE;
  env.ALLAY_SITE_WIDTH = String(width);
  const app = await electron.launch({ executablePath: ELECTRON, args: [join(import.meta.dirname, 'electron-main.mjs')], env });
  const page = await app.firstWindow();
  const errors: string[] = [];
  // 页面和 iframe 里的报错都算（Worker 里的错误会经 EngineHost 变成页面上的报错或警告）
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(`[console] ${m.text()}`);
  });
  page.on('pageerror', (e) => errors.push(`[pageerror] ${e.message}`));
  // 监听装上之后从头再载一次，开头的报错也收得到
  await page.reload();
  await expect(page.getByTestId('site-nav')).toBeVisible();
  return { app, page, errors };
}

async function externalRequests(app: ElectronApplication): Promise<string[]> {
  return app.evaluate(() => (globalThis as unknown as { externalRequests: string[] }).externalRequests);
}

/** 慢慢滚到页底（让懒加载的部分、过场、出场都走一遍） */
async function scrollThrough(page: Page): Promise<void> {
  await page.evaluate(async () => {
    const step = Math.round(window.innerHeight * 0.6);
    for (let y = 0; y <= document.documentElement.scrollHeight; y += step) {
      window.scrollTo({ top: y, behavior: 'instant' });
      await new Promise((r) => setTimeout(r, 180));
    }
  });
}

async function simulator(page: Page): Promise<Frame> {
  await page.evaluate(() => document.getElementById('try')?.scrollIntoView({ behavior: 'instant' }));
  await expect(page.getByTestId('sim-frame')).toBeVisible({ timeout: 30_000 });
  let frame: Frame | undefined;
  await expect.poll(() => (frame = page.frames().find((f) => f.url().includes('simulator.html'))) !== undefined).toBe(true);
  await expect.poll(() => frame!.evaluate(() => window.__allayTest?.status().kind ?? 'none'), { timeout: 60_000 }).toBe('ready');
  // iframe 里的元素 Playwright 只会在 iframe 内滚动：先把整个窗口外框滚到视口中间
  await page.getByTestId('sim-window').evaluate((el) => el.scrollIntoView({ block: 'center', behavior: 'instant' }));
  return frame!;
}

async function upToDate(frame: Frame): Promise<void> {
  await expect.poll(() => frame.evaluate(() => window.__allayTest!.previewUpToDate() && window.__allayTest!.status().kind === 'ready'), { timeout: 30_000 }).toBe(true);
}

/** 预览画布在整段里几个时刻的像素摘要 */
async function sample(frame: Frame): Promise<string> {
  const tr = await frame.evaluate(() => window.__allayTest!.transport());
  const times = [0.2, 0.35, 0.5, 0.65, 0.8].map((k) => k * tr.duration);
  return frame.evaluate(async (ts) => (await Promise.all(ts.map((t) => window.__allayTest!.previewHash(t)))).join(','), times);
}

test.describe.configure({ mode: 'serial' });

let s: Session;

test.beforeAll(async () => {
  s = await launch();
});

test.afterAll(async () => {
  await s?.app.close();
});

test('T-WEB-1 页面能加载：首屏实时预览就绪，模板一个不少，滚完全页无报错、无外部请求', async () => {
  const { page } = s;
  await expect(page.getByTestId('hero-viewer')).toHaveAttribute('data-status', 'ready', { timeout: 60_000 });
  await expect(page.getByTestId('template-card')).toHaveCount(TEMPLATE_COUNT);
  await expect(page.getByTestId('live-chip')).toHaveCount(TEMPLATE_COUNT);
  await scrollThrough(page);
  // 模板卡片里的帧都由封面服务渲染出来了（不是截图）
  await expect(page.getByTestId('template-sheet')).toHaveCount(TEMPLATE_COUNT, { timeout: 90_000 });
  // 用了官网专用的原版贴图时，页面上写明来源和版权（docs/decisions.md 官网 · 原版素材）
  const mcIndex = join(ROOT, 'apps/website/public/mc/index.json');
  if (existsSync(mcIndex)) {
    const { gameVersion } = JSON.parse(readFileSync(mcIndex, 'utf8')) as { gameVersion: string };
    const note = page.getByTestId('assets-note').first();
    await expect(note).toContainText('Mojang');
    await expect(note).toContainText(gameVersion);
  }
  expect(s.errors).toEqual([]);
  expect(await externalRequests(s.app)).toEqual([]);
});

test('T-WEB-2 仿真器挂载桌面版编辑器，预览画布由真实引擎渲染出非空画面', async () => {
  const frame = await simulator(s.page);
  await upToDate(frame);
  // 桌面版的界面：顶栏、模板库、属性面板、时间轴都在
  for (const id of ['topbar', 'param-panel', 'topbar-export']) await expect(frame.getByTestId(id)).toBeVisible();
  const tr = await frame.evaluate(() => window.__allayTest!.transport());
  let maxAlpha = 0;
  for (const k of [0.25, 0.5, 0.75]) maxAlpha = Math.max(maxAlpha, (await frame.evaluate((t) => window.__allayTest!.previewStats(t), k * tr.duration)).maxAlpha);
  expect(maxAlpha).toBeGreaterThan(0);
  // 模板库里也是全部内置模板
  const builtins = (await frame.evaluate(() => window.__allayTest!.templates())).filter((e) => e.source === 'builtin');
  expect(builtins).toHaveLength(TEMPLATE_COUNT);
});

test('T-WEB-3 切换模板、拖动参数后画面变化（仿真器与首屏预览）', async () => {
  const { page } = s;
  const frame = await simulator(page);
  await upToDate(frame);
  const before = await sample(frame);

  // 在模板库里点另一个模板
  const target = 'allay.builtin.pixel-dissolve';
  await frame.getByTestId(`template-${target}`).click();
  await expect.poll(() => frame.evaluate(() => window.__allayTest!.project().ref?.id)).toBe(target);
  await upToDate(frame);
  const switched = await sample(frame);
  expect(switched).not.toBe(before);

  // 在属性面板里按住一个数值框往右拖（数值框即滑块）
  const inputs = frame.locator('[data-testid="param-panel"] input[inputmode]');
  expect(await inputs.count()).toBeGreaterThan(0);
  let changed = false;
  for (let i = 0; i < Math.min(await inputs.count(), 4) && !changed; i++) {
    const input = inputs.nth(i);
    await input.scrollIntoViewIfNeeded();
    const box = await input.boundingBox();
    if (!box) continue;
    const rev = await frame.evaluate(() => window.__allayTest!.project().revision);
    const y = box.y + box.height / 2;
    await page.mouse.move(box.x + box.width * 0.3, y);
    await page.mouse.down();
    for (let k = 1; k <= 8; k++) await page.mouse.move(box.x + box.width * 0.3 + k * 12, y);
    await page.mouse.up();
    await expect.poll(() => frame.evaluate(() => window.__allayTest!.project().revision)).toBeGreaterThan(rev);
    await upToDate(frame);
    changed = (await sample(frame)) !== switched;
  }
  expect(changed).toBe(true);

  // 首屏的实时预览：点模板按钮，换成那个模板
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
  const chip = page.locator(`[data-testid="live-chip"][data-template="allay.builtin.block-fall"]`).first();
  await chip.click();
  await expect(chip).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('live-template-name').first()).toHaveText(/方块坠落|Block fall/);
});

test('T-WEB-4 两种语言、两种主题都能切换，仿真器跟着变，没有缺失的文案', async () => {
  const { page } = s;
  const frame = await simulator(page);
  const lang0 = await page.evaluate(() => document.documentElement.lang);
  const title0 = await page.locator('h1').innerText();
  for (let round = 0; round < 2; round++) {
    await page.getByTestId('toggle-language').click();
    const lang = round === 0 ? (lang0 === 'en' ? 'zh-CN' : 'en') : lang0;
    await expect.poll(() => page.evaluate(() => document.documentElement.lang)).toBe(lang);
    if (round === 0) expect(await page.locator('h1').innerText()).not.toBe(title0);
    // 仿真器里桌面版的界面也换了语言
    await expect(frame.getByTestId('topbar-export')).toHaveText(lang === 'en' ? /Export/ : /导出/);
  }
  expect(await page.evaluate(() => (window as unknown as { __siteMissingKeys: Set<string> }).__siteMissingKeys.size)).toBe(0);
  expect(await frame.evaluate(() => window.__allayTest!.missingKeys())).toEqual([]);

  const theme0 = await page.evaluate(() => document.documentElement.dataset.theme);
  const bg0 = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  for (let round = 0; round < 2; round++) {
    await page.getByTestId('toggle-theme').click();
    const theme = round === 0 ? (theme0 === 'dark' ? 'light' : 'dark') : theme0;
    await expect.poll(() => page.evaluate(() => document.documentElement.dataset.theme)).toBe(theme);
    await expect.poll(() => frame.evaluate(() => document.documentElement.dataset.theme)).toBe(theme);
    if (round === 0) expect(await page.evaluate(() => getComputedStyle(document.body).backgroundColor)).not.toBe(bg0);
  }
});

test('T-WEB-5 非官方声明逐字、醒目地出现（两种语言）', async () => {
  const { page } = s;
  for (let round = 0; round < 2; round++) {
    const lang = (await page.evaluate(() => document.documentElement.lang)) as 'zh-CN' | 'en';
    const box = page.getByTestId('disclaimer');
    await box.scrollIntoViewIfNeeded();
    await expect(box).toBeVisible();
    const text = await box.innerText();
    expect(text).toBe(brandMessages[lang].disclaimer);
    expect(text).toContain(DISCLAIMER_EN);
    if (lang === 'zh-CN') expect(text).toContain(DISCLAIMER_ZH);
    // 醒目：不是缩成很小的字
    expect(await box.evaluate((el) => parseFloat(getComputedStyle(el).fontSize))).toBeGreaterThanOrEqual(13);
    await page.getByTestId('toggle-language').click();
    await expect.poll(() => page.evaluate(() => document.documentElement.lang)).not.toBe(lang);
  }
});

test('T-WEB-6 仿真导出：走一遍真实的导出对话框和进度，结束时给出下载桌面版的引导', async () => {
  const { page } = s;
  const frame = await simulator(page);
  await upToDate(frame);
  await frame.getByTestId('topbar-export').click();
  await frame.getByTestId('export-start').click();
  const card = page.getByTestId('sim-export-done');
  await expect(card).toBeVisible({ timeout: 60_000 });
  await expect(card.locator('a[href="https://github.com/Mystic-Stars/Allay-Motion"]')).toBeVisible();
  // 应用自己的完成页如实说明没有写出文件
  await expect(frame.getByTestId('export-path')).toBeVisible();
  await card.getByRole('button').first().click();
  await expect(card).toBeHidden();
});

test('T-WEB-7 窄屏降级：不加载完整编辑器，留实时预览和模板切换，没有横向溢出', async () => {
  const narrow = await launch(390);
  try {
    const { page } = narrow;
    await page.evaluate(() => document.getElementById('try')?.scrollIntoView({ behavior: 'instant' }));
    const viewer = page.getByTestId('compact-viewer');
    await expect(viewer).toHaveAttribute('data-status', 'ready', { timeout: 60_000 });
    await expect(page.getByTestId('sim-window')).toHaveCount(0);
    expect(page.frames().some((f) => f.url().includes('simulator.html'))).toBe(false);
    const chip = viewer.locator('[data-testid="live-chip"][data-template="allay.builtin.item-stinger"]');
    await chip.click();
    await expect(chip).toHaveAttribute('aria-pressed', 'true');
    await scrollThrough(page);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
    expect(narrow.errors).toEqual([]);
    expect(await externalRequests(narrow.app)).toEqual([]);
  } finally {
    await narrow.app.close();
  }
});

test('T-WEB-8 减少动效：没有出场盖层，内容一开始就完整可读，过场停成静止的分界', async () => {
  const { page } = s;
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.reload();
  await expect(page.getByTestId('site-nav')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.dataset.reducedMotion)).toBe('true');
  await scrollThrough(page);
  // 任何时刻都没有盖在内容上的像素层
  await expect(page.locator('canvas[data-reveal]')).toHaveCount(0);
  for (const h of await page.locator('h1, h2').all()) await expect(h).toBeVisible();
  await page.emulateMedia({ reducedMotion: 'no-preference' });
});

test('T-WEB-10 标题在任何情况下都很快可见：字体请求全部被拦、requestAnimationFrame 不跑（像后台标签页）', async () => {
  const bad = await launch();
  try {
    const { page } = bad;
    await page.route(/\.woff2(\?|$)/, (r) => r.abort());
    // 后台标签页里 requestAnimationFrame 不回调：出场动画走不动，盖层必须靠保底计时器撤掉
    await page.addInitScript(() => {
      window.requestAnimationFrame = () => 0;
    });
    await page.reload();
    /** 有没有出场盖层压在这个元素上 */
    const covered = (selector: string) =>
      page.evaluate((sel) => {
        const el = document.querySelector(sel);
        if (!el) return true;
        const r = el.getBoundingClientRect();
        return [...document.querySelectorAll('canvas[data-reveal]')].some((c) => {
          const b = c.getBoundingClientRect();
          return b.left < r.right && b.right > r.left && b.top < r.bottom && b.bottom > r.top;
        });
      }, selector);
    const t0 = Date.now();
    await expect(page.locator('h1')).toBeVisible();
    await expect.poll(() => covered('h1'), { timeout: 2500 }).toBe(false);
    test.info().annotations.push({ type: 'T-WEB-10', description: `首屏标题 ${Date.now() - t0} ms 内可见（字体被拦、rAF 不跑）` });
    // 滚到页面中段的节标题也一样
    await page.evaluate(() => document.getElementById('features')?.scrollIntoView({ behavior: 'instant' }));
    await expect.poll(() => covered('#features h2'), { timeout: 3500 }).toBe(false);
    expect(bad.errors.filter((e) => !/woff2|Failed to load resource|net::ERR_FAILED/.test(e))).toEqual([]);
  } finally {
    await bad.app.close();
  }
});

test('T-WEB-9 以上全部操作之后：控制台没有报错，没有外部请求', async () => {
  expect(s.errors).toEqual([]);
  expect(await externalRequests(s.app)).toEqual([]);
});
