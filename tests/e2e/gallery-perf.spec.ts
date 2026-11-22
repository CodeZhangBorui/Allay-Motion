import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { requiredTextures } from '../../packages/assets/src/index';
import { catalogJarEntries, makeCatalogGame } from '../unit/helpers/resource-fixtures';
import { launchApp, makeUserDataDir, readMainLog, removeUserDataDir, ROOT } from './helpers';
import { makeTemplateLibrary } from './template-library';

// 模板库撑到一百个模板（docs/decisions.md“模板库撑到一百个模板”）：测试时现拼一百个内置模板（template-library.ts），量
// 启动、打开模板库并滚动到底时主线程的长任务（量法同 m4.spec.ts 的 T-UI-7）、封面生成、封面生成期间切换模板的预览等待。
// 量出来的数写进测试的注释和 test-results/gallery-perf.json，判定只有 T-GAL-11 的两条：滚动时没有超过 50 ms 的长任务；
// 启动时主进程只读包、不解析模板代码（看主进程日志里模板列表就绪的时刻，和渲染进程装载的模板数）。

/** 量数时可以用 ALLAY_GAL_COUNT 换成别的个数（对照现有的 17 个）；判定按 100 个 */
const COUNT = Number(process.env.ALLAY_GAL_COUNT ?? 100);

interface Ctx {
  app: ElectronApplication;
  page: Page;
  dir: string;
}

async function upToDate(page: Page): Promise<void> {
  await page.waitForFunction(() => window.__allayTest?.previewUpToDate() === true, undefined, { timeout: 60_000 });
}

/** 主进程日志里某个启动标记的毫秒数（从主进程启动算起） */
function startupMark(dir: string, name: string): number | null {
  const m = new RegExp(`\\[startup\\] ${name} \\{"ms":(\\d+)\\}`).exec(readMainLog(dir));
  return m ? Number(m[1]) : null;
}

/** 模板列表所在的滚动容器（不依赖它的 testid：改动前后都能量） */
async function scrollInfo(page: Page): Promise<{ top: number; height: number; client: number }> {
  return page.evaluate(() => {
    let el = document.querySelector<HTMLElement>('[data-testid="template-list"]');
    while (el && !/(auto|scroll)/.test(getComputedStyle(el).overflowY)) el = el.parentElement;
    if (!el) throw new Error('no scroll container');
    return { top: el.scrollTop, height: el.scrollHeight, client: el.clientHeight };
  });
}

async function scrollTo(page: Page, top: number): Promise<void> {
  await page.evaluate((y) => {
    let el = document.querySelector<HTMLElement>('[data-testid="template-list"]');
    while (el && !/(auto|scroll)/.test(getComputedStyle(el).overflowY)) el = el.parentElement;
    el!.scrollTop = y;
  }, top);
}

/** 可见范围里的卡片：有几张、其中几张已经有封面 */
async function visibleCovers(page: Page): Promise<{ visible: number; ready: number }> {
  return page.evaluate(() => {
    let el = document.querySelector<HTMLElement>('[data-testid="template-list"]');
    while (el && !/(auto|scroll)/.test(getComputedStyle(el).overflowY)) el = el.parentElement;
    const view = el!.getBoundingClientRect();
    let visible = 0;
    let ready = 0;
    for (const card of document.querySelectorAll<HTMLElement>('[data-testid="template-list"] [data-testid^="template-"]')) {
      const r = card.getBoundingClientRect();
      if (r.bottom <= view.top || r.top >= view.bottom) continue;
      visible++;
      if (card.querySelector('img')) ready++;
    }
    return { visible, ready };
  });
}

async function startLongTasks(page: Page): Promise<void> {
  await page.evaluate(() => {
    const w = window as unknown as { __galLong: number[]; __galObs?: PerformanceObserver };
    w.__galObs?.disconnect();
    w.__galLong = [];
    w.__galObs = new PerformanceObserver((list) => {
      for (const e of list.getEntries()) w.__galLong.push(Math.round(e.duration));
    });
    w.__galObs.observe({ type: 'longtask' });
  });
}

async function takeLongTasks(page: Page): Promise<number[]> {
  return page.evaluate(() => {
    const w = window as unknown as { __galLong: number[] };
    const out = [...w.__galLong];
    w.__galLong = [];
    return out;
  });
}

/** 用滚轮把模板列表一路滚到底（每次 240 px，间隔 40 ms），返回用了多少次 */
async function wheelToBottom(page: Page): Promise<number> {
  const box = (await page.getByTestId('template-list').boundingBox())!;
  const panel = (await page.getByTestId('panel-left').boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, Math.min(panel.y + panel.height - 40, box.y + 200));
  let steps = 0;
  for (let i = 0; i < 400; i++) {
    const s = await scrollInfo(page);
    if (s.top + s.client >= s.height - 1) break;
    await page.mouse.wheel(0, 240);
    await page.waitForTimeout(40);
    steps++;
  }
  return steps;
}

/** 点一张卡片，量到预览装载好这个模板的毫秒数 */
async function switchLatency(page: Page, id: string): Promise<number> {
  const card = page.getByTestId(`template-${id}`);
  await card.scrollIntoViewIfNeeded();
  const t0 = Date.now();
  await card.click();
  await expect.poll(() => page.evaluate(() => window.__allayTest!.project().ref?.id), { timeout: 60_000 }).toBe(id);
  await upToDate(page);
  return Date.now() - t0;
}

/** 渲染进程和 GPU 进程的内存（工作集，MB） */
async function memory(app: ElectronApplication): Promise<Record<string, number>> {
  return app.evaluate(({ app: a }) => {
    const out: Record<string, number> = {};
    for (const m of a.getAppMetrics()) out[m.type] = Math.round(((out[m.type] ?? 0) * 1024 + m.memory.workingSetSize) / 1024);
    return out;
  });
}

async function start(): Promise<Ctx & { library: ReturnType<typeof makeTemplateLibrary>; launchMs: number }> {
  const dir = makeUserDataDir();
  const library = makeTemplateLibrary(join(dir, 'library'), COUNT);
  const appData = join(dir, 'appdata');
  const paths = requiredTextures().map((r) => ({ id: r.id, path: r.anyOf[0]! }));
  makeCatalogGame(join(appData, '.minecraft'), '9.9.9', '2030-01-01T00:00:00+00:00', catalogJarEntries(paths, {}));
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, 'settings.json'),
    JSON.stringify({
      formatVersion: 1,
      ui: { theme: 'dark', language: 'zh-CN', reducedMotion: 'off', onboardingCompleted: true, tourCompleted: true, layout: { left: { size: 280, collapsed: false }, right: { size: 320, collapsed: false } } },
      resources: { vanilla: { consent: true, enabled: true, dir: null }, packs: [] },
    }),
  );
  const t0 = Date.now();
  const { app, page } = await launchApp(dir, { ALLAY_E2E_GAME_APPDATA: appData, ALLAY_E2E_TEMPLATES_DIR: join(dir, 'library') });
  await upToDate(page);
  const launchMs = Date.now() - t0;
  return { app, page, dir, library, launchMs };
}

test('T-GAL-11 一百个模板：启动、打开模板库、滚动到底、封面生成、生成期间切换模板（量数，滚动时没有长任务）', async () => {
  test.setTimeout(20 * 60_000);
  const ctx = await start();
  const { app, page, dir, library } = ctx;
  const result: Record<string, unknown> = { count: COUNT };
  const note = (k: string, v: unknown) => {
    result[k] = v;
    test.info().annotations.push({ type: k, description: typeof v === 'string' ? v : JSON.stringify(v) });
  };
  try {
    // ---- 启动 ----
    await expect.poll(() => startupMark(dir, 'renderer-ready'), { timeout: 30_000 }).not.toBeNull();
    note('launchToPreviewMs', ctx.launchMs);
    note(
      'startupMarksMs',
      Object.fromEntries(['main-loaded', 'app-ready', 'settings-loaded', 'templates-ready', 'window-created', 'renderer-ready'].map((m) => [m, startupMark(dir, m)])),
    );
    const entries = await page.evaluate(() => window.__allayTest!.templates());
    expect(entries.length).toBe(COUNT);
    // 启动过程中的长任务（浏览器缓冲下来的那些；只记数，不判定：启动时本来就有引擎装载、字体解析之类）
    note(
      'startupLongTasks',
      await page.evaluate(
        () =>
          new Promise<number[]>((resolve) => {
            const obs = new PerformanceObserver((list) => {
              obs.disconnect();
              resolve(list.getEntries().map((e) => Math.round(e.duration)));
            });
            obs.observe({ type: 'longtask', buffered: true });
            setTimeout(() => resolve([]), 500);
          }),
      ),
    );
    // 原版层在后台探测，探测完资源栈变一次
    await expect.poll(() => page.evaluate(() => window.__allayTest!.resourceState()?.detecting === false && window.__allayTest!.resourceState()?.hasAssets === true), { timeout: 30_000 }).toBe(true);
    const tStable = Date.now();
    await expect(page.locator('[data-testid="template-list"] [data-testid^="template-"]')).toHaveCount(COUNT, { timeout: 30_000 });

    // ---- 冷：启动后马上打开模板库（从“预设”切回“模板”）、滚到底 ----
    await startLongTasks(page);
    await page.getByTestId('left-tab-presets').click();
    await page.waitForTimeout(300);
    const tOpen = Date.now();
    await page.getByTestId('left-tab-templates').click();
    await expect(page.locator('[data-testid="template-list"] [data-testid^="template-"]')).toHaveCount(COUNT);
    note('openLibraryMs', Date.now() - tOpen);
    await page.waitForTimeout(500);
    const openLong = await takeLongTasks(page);
    note('openLibraryLongTasks', openLong);
    const firstVisible = await visibleCovers(page);
    note('visibleCardsAtTop', firstVisible.visible);
    // 第一屏的封面：从资源栈稳定算起
    await expect.poll(async () => (await visibleCovers(page)).ready, { timeout: 120_000 }).toBe(firstVisible.visible);
    note('firstScreenCoversMs', Date.now() - tStable);
    await startLongTasks(page);
    const steps = await wheelToBottom(page);
    await page.waitForTimeout(1500);
    const coldScroll = await takeLongTasks(page);
    note('coldScroll', { steps, longTasks: coldScroll });

    // ---- 封面全部生成完：一屏一屏往下翻，每屏等可见的封面好了再翻 ----
    await scrollTo(page, 0);
    const tAll = Date.now();
    for (let guard = 0; guard < 200; guard++) {
      await expect.poll(async () => { const v = await visibleCovers(page); return v.ready === v.visible; }, { timeout: 120_000 }).toBe(true);
      const s = await scrollInfo(page);
      if (s.top + s.client >= s.height - 1) break;
      await scrollTo(page, s.top + s.client);
      await page.waitForTimeout(50);
    }
    note('allCoversByPagingMs', Date.now() - tAll);
    const everyCover = await page.locator('[data-testid="template-list"] img').count();
    note('coversInDom', everyCover);
    note('coverStats', await page.evaluate(() => (window.__allayTest as unknown as { coverStats?: () => unknown }).coverStats?.() ?? null));
    note('cacheUsage', await page.evaluate(() => window.allay.cache.usage()));
    note('memoryMB', await memory(app));

    // ---- 热：封面都有了，再从顶滚到底 ----
    await scrollTo(page, 0);
    await page.waitForTimeout(500);
    await startLongTasks(page);
    const warmSteps = await wheelToBottom(page);
    await page.waitForTimeout(1000);
    const warmScroll = await takeLongTasks(page);
    note('warmScroll', { steps: warmSteps, longTasks: warmScroll });

    // ---- 切换模板的预览等待：空闲时、资源栈变化后封面重画期间 ----
    await scrollTo(page, 0);
    // 启动时选中的是旗舰模板，不拿它量
    const builtins = library.filter((e) => e.copyOf === null && e.id !== 'allay.builtin.block-wipe').map((e) => e.id);
    const idle: number[] = [];
    for (const id of builtins.slice(1, 4)) idle.push(await switchLatency(page, id));
    note('switchIdleMs', idle);
    await page.evaluate(() => window.allay.resources.setVanilla({ enabled: false }));
    await expect.poll(() => page.evaluate(() => window.__allayTest!.resourceState()?.hasAssets), { timeout: 30_000 }).toBe(false);
    const busy: number[] = [];
    for (const id of builtins.slice(4, 7)) busy.push(await switchLatency(page, id));
    note('switchDuringRedrawMs', busy);

    // 悬停预览：指针停在一张卡片上，到它开始播放（卡片里出现画布）
    await scrollTo(page, 0);
    await page.mouse.move(0, 0);
    await page.waitForTimeout(300);
    const hoverCard = page.getByTestId(`template-${builtins[8]!}`);
    await hoverCard.scrollIntoViewIfNeeded();
    const tHover = Date.now();
    await hoverCard.hover();
    await expect(hoverCard.locator('canvas')).toBeVisible({ timeout: 60_000 });
    note('hoverPreviewMs', Date.now() - tHover);
    note('memoryEndMB', await memory(app));

    // 判定：滚动时没有超过 50 ms 的长任务（冷、热两遍）
    expect.soft(coldScroll, `冷滚动的长任务（ms）：${coldScroll.join(', ')}`).toEqual([]);
    expect.soft(warmScroll, `热滚动的长任务（ms）：${warmScroll.join(', ')}`).toEqual([]);
  } finally {
    mkdirSync(join(ROOT, 'test-results'), { recursive: true });
    writeFileSync(join(ROOT, 'test-results', 'gallery-perf.json'), JSON.stringify(result, null, 2));
    console.log(`[gallery-perf] ${JSON.stringify(result)}`);
    await app.close();
    removeUserDataDir(dir);
  }
});
