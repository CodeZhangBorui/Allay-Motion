import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type ElectronApplication, type Page } from '@playwright/test';
import type { TemplateEntry } from '../../apps/desktop/src/shared/templates';
import { requiredTextures } from '../../packages/assets/src/index';
import { catalogJarEntries, makeCatalogGame } from '../unit/helpers/resource-fixtures';
import { decodeAllRgba, probe } from '../export/ffmpeg';
import { launchApp, makeUserDataDir, removeUserDataDir, requirePinnedFfmpeg, ROOT } from './helpers';
import { makeTemplateLibrary } from './template-library';

// 模板库的端到端测试（docs/decisions.md“模板库撑到一百个模板”）：类别标签和分组筛选、搜索、键盘（T-GAL-9），
// “标题”类别从模板库走到导出（T-GAL-10），封面只为可见的卡片生成、快速滚过去的撤掉、资源栈变了只重画看得到的（T-GAL-12），
// 悬停停够了才生成预览、移开就停（T-GAL-13）。一百个模板时滚动没有长任务（T-GAL-11）在 gallery-perf.spec.ts。
// 窗口不显示、不抢焦点；假原版层是纯色色块；用到的模板都在测试时生成。

interface Ctx {
  app: ElectronApplication;
  page: Page;
  dir: string;
}

interface StartOptions {
  ui?: Record<string, unknown>;
  /** 用一百个模板的库（template-library.ts） */
  library?: boolean;
  /** 先写进用户模板文件夹的模板（id → 文件） */
  userTemplates?: Record<string, Record<string, string>>;
  env?: Record<string, string>;
}

async function start(opts: StartOptions = {}): Promise<Ctx> {
  const dir = makeUserDataDir();
  const appData = join(dir, 'appdata');
  const paths = requiredTextures().map((r) => ({ id: r.id, path: r.anyOf[0]! }));
  makeCatalogGame(join(appData, '.minecraft'), '9.9.9', '2030-01-01T00:00:00+00:00', catalogJarEntries(paths, {}));
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, 'settings.json'),
    JSON.stringify({
      formatVersion: 1,
      ui: { theme: 'dark', language: 'zh-CN', reducedMotion: 'off', onboardingCompleted: true, tourCompleted: true, layout: { left: { size: 280, collapsed: false }, right: { size: 320, collapsed: false } }, ...opts.ui },
      resources: { vanilla: { consent: true, enabled: true, dir: null }, packs: [] },
    }),
  );
  for (const [id, files] of Object.entries(opts.userTemplates ?? {})) {
    const folder = join(dir, 'templates', id, '1.0.0');
    mkdirSync(folder, { recursive: true });
    for (const [name, text] of Object.entries(files)) writeFileSync(join(folder, name), text);
  }
  const env: Record<string, string> = { ALLAY_E2E_GAME_APPDATA: appData, ...opts.env };
  if (opts.library) env.ALLAY_E2E_TEMPLATES_DIR = join(dir, 'library');
  if (opts.library) makeTemplateLibrary(join(dir, 'library'), 100);
  const { app, page } = await launchApp(dir, env);
  await upToDate(page);
  await expect.poll(() => page.evaluate(() => window.__allayTest!.resourceState()?.detecting === false && window.__allayTest!.resourceState()?.hasAssets === true)).toBe(true);
  await upToDate(page);
  return { app, page, dir };
}

async function stop(ctx: Ctx): Promise<void> {
  await ctx.app.close();
  removeUserDataDir(ctx.dir);
}

async function upToDate(page: Page): Promise<void> {
  await page.waitForFunction(() => window.__allayTest?.previewUpToDate() === true, undefined, { timeout: 60_000 });
}

/** 列表里现在有哪些卡片（模板 id，按界面上的先后） */
const shownIds = (page: Page) =>
  page.evaluate(() => [...document.querySelectorAll<HTMLElement>('[data-testid="template-list"] [data-card-key] [data-testid^="template-"]')].map((el) => el.dataset.testid!.slice('template-'.length)));

const stats = (page: Page) => page.evaluate(() => window.__allayTest!.coverStats());

/** 可见范围里的卡片都有了封面（或确定生成不了），加载编排也结束了 */
async function visibleCoversReady(page: Page): Promise<void> {
  await page.waitForFunction(
    () => {
      const scroller = document.querySelector<HTMLElement>('[data-testid="template-scroll"]');
      if (!scroller) return false;
      const view = scroller.getBoundingClientRect();
      for (const card of document.querySelectorAll<HTMLElement>('[data-testid="template-list"] [data-cover]')) {
        const r = card.getBoundingClientRect();
        if (r.bottom > view.top && r.top < view.bottom && card.dataset.cover === 'loading') return false;
      }
      return document.querySelector('[data-testid="gallery-loader"]')?.getAttribute('data-allay-loader-phase') === 'idle';
    },
    undefined,
    { timeout: 60_000 },
  );
}

/** 滚动容器里、此刻在可见范围里（或上下各一屏之内）的卡片 */
const cardsIn = (page: Page, margin: number) =>
  page.evaluate((m) => {
    const scroller = document.querySelector<HTMLElement>('[data-testid="template-scroll"]')!;
    const view = scroller.getBoundingClientRect();
    const out: string[] = [];
    for (const el of document.querySelectorAll<HTMLElement>('[data-testid="template-list"] [data-card-key]')) {
      const r = el.getBoundingClientRect();
      if (r.bottom > view.top - m * view.height && r.top < view.bottom + m * view.height) out.push(el.dataset.cardKey!);
    }
    return out;
  }, margin);

const coverKeyOf = (cardKey: string) => {
  const at = cardKey.lastIndexOf('@');
  return `cover_${`${cardKey.slice(0, at)}_${cardKey.slice(at + 1)}`.toLowerCase().replace(/[^a-z0-9_.~-]/g, '_')}`.slice(0, 190);
};

const OVERLAY_CODE = `export default {
  async setup(ctx) {
    const T = ctx.THREE;
    const m = new T.MeshBasicMaterial({ color: 0x6f55c8, transparent: true, opacity: 0 });
    const mesh = new T.Mesh(new T.PlaneGeometry(ctx.stage.width * 0.6, ctx.stage.height * 0.25), m);
    ctx.scene.add(mesh);
    const d = ctx.params.inDuration + ctx.params.hold + ctx.params.outDuration;
    const pad = 1 / ctx.stage.fps;
    return {
      duration: d,
      cutTime: null,
      update(t) {
        const a = Math.min(1, Math.max(0, (t - pad) / ctx.params.inDuration), Math.max(0, (d - pad - t) / ctx.params.outDuration));
        m.opacity = a;
        mesh.visible = a > 0;
      },
    };
  },
};`;

/** 现拼的“标题”模板：一块紫色的标题条淡入、停留、淡出，没有剪辑点 */
function titleTemplate(id: string, name: Record<string, string>, tags: string[] = ['text']): Record<string, string> {
  const duration = (key: string, label: string, value: number) => ({ key, type: 'duration', label, default: value, min: 0.1, max: 5 });
  return {
    'manifest.json': JSON.stringify({
      formatVersion: 1,
      id,
      version: '1.0.0',
      name,
      category: 'title',
      tags,
      params: [duration('inDuration', 'In', 0.4), duration('hold', 'Hold', 0.8), duration('outDuration', 'Out', 0.4)],
      timeline: { segments: [{ param: 'inDuration' }, { param: 'hold' }, { param: 'outDuration' }] },
    }),
    'template.js': OVERLAY_CODE,
  };
}

// T-GAL-9 的预期从 manifest 算，不写死数量和结果：内置模板会一批批加进来（docs/template-catalog.md），各组的数量、
// 搜索命中哪些模板都会变。下面照 docs/decisions.md“模板库撑到一百个模板”的规则独立算一遍，界面上的结果要和它一致。

/** 组的顺序（docs/template-catalog.md 的 A–H，最后是“其他”）：段头、分组菜单都按它排 */
const GROUP_ORDER = ['blocks', 'items', 'ui', 'particles', 'text', 'channel', 'shader', 'seasonal', 'other'] as const;
type Group = (typeof GROUP_ORDER)[number];

/** 模板所在的组：manifest 的 tags 里第一个组名；没有时归“其他”（这个测试里没有派生模板，不用随基模板） */
function groupOf(e: TemplateEntry): Group {
  return (e.manifest.tags ?? []).find((t): t is Group => t !== 'other' && (GROUP_ORDER as readonly string[]).includes(t)) ?? 'other';
}

/** 各组两种语言的名字（文案文件里的；搜组名用） */
const GROUP_LABELS: Record<Group, string[]> = (() => {
  const locales = ['zh-CN', 'en'].map((l) => JSON.parse(readFileSync(join(ROOT, 'apps/desktop/src/renderer/i18n/locales', `${l}.json`), 'utf8')) as { gallery: { groups: Record<Group, string> } });
  return Object.fromEntries(GROUP_ORDER.map((g) => [g, locales.map((m) => m.gallery.groups[g])])) as Record<Group, string[]>;
})();

const normalized = (s: string) => s.normalize('NFKC').toLowerCase();

/** 模板自己能被搜到的文字：两种语言的名称和说明、id、tags（不含组名） */
function ownText(e: TemplateEntry): string {
  const both = (v: TemplateEntry['manifest']['name'] | undefined) => (v === undefined ? [] : typeof v === 'string' ? [v] : Object.values(v));
  return normalized([...both(e.manifest.name), ...both(e.manifest.description), e.id, ...(e.manifest.tags ?? [])].join('\n'));
}

/** 搜索框里打 query 应该搜到的模板（按空白切成几个词，每个词都要出现在模板自己的文字或所在组的名字里） */
function expectedHits(all: readonly TemplateEntry[], query: string): string[] {
  const terms = normalized(query).split(/\s+/u).filter((t) => t.length > 0);
  return all.filter((e) => terms.every((t) => `${ownText(e)}\n${normalized(GROUP_LABELS[groupOf(e)].join('\n'))}`.includes(t))).map((e) => e.id);
}

/** 两组 id 一样（不管先后；先后另外按完整列表核对） */
const sameIds = (a: readonly string[], b: readonly string[]) => expect([...a].sort()).toEqual([...b].sort());

test('T-GAL-9 类别标签、分组筛选、搜索、键盘', async () => {
  const ctx = await start({ userTemplates: { 'user.e2e.title': titleTemplate('user.e2e.title', { 'zh-CN': '我的片头', en: 'My opener' }) } });
  const { page } = ctx;
  try {
    await visibleCoversReady(page);
    const all = await page.evaluate(() => window.__allayTest!.templates());
    const category = new Map(all.map((e) => [e.id, e.manifest.category]));
    const idsOf = (pick: (e: TemplateEntry) => boolean) => all.filter(pick).map((e) => e.id);
    await expect(page.getByTestId('gallery-count')).toHaveText(`${all.length} 个模板`);

    // ---- 类别 ----
    for (const tab of ['transition', 'overlay', 'title'] as const) {
      await page.getByTestId(`gallery-tab-${tab}`).click();
      const ids = await shownIds(page);
      expect(ids.length, tab).toBe(all.filter((e) => e.manifest.category === tab).length);
      expect(ids.every((id) => category.get(id) === tab), `${tab}: ${ids.join(', ')}`).toBe(true);
    }
    await page.getByTestId('gallery-tab-mine').click();
    expect(await shownIds(page)).toEqual(['user.e2e.title']);
    await page.getByTestId('gallery-tab-all').click();
    // 完整列表的先后：后面核对筛选和搜索的结果都是它的子序列（卡片不跳来跳去）
    const fullOrder = await shownIds(page);
    expect(fullOrder).toHaveLength(all.length);
    const inFullOrder = (ids: readonly string[]) => expect(ids).toEqual(fullOrder.filter((id) => ids.includes(id)));
    // 段头：有模板的组，按组的顺序；每段里正好是这一组的模板
    const groupCount = (g: Group) => all.filter((e) => groupOf(e) === g).length;
    const sections = await page.locator('[data-testid^="gallery-section-"]').evaluateAll((els) => els.map((el) => el.getAttribute('data-testid')!.slice('gallery-section-'.length)));
    expect(sections).toEqual(GROUP_ORDER.filter((g) => groupCount(g) > 0));
    expect(fullOrder.map((id) => groupOf(all.find((e) => e.id === id)!))).toEqual(sections.flatMap((g) => Array<string>(groupCount(g as Group)).fill(g)));

    // ---- 分组：菜单里每组带数量（没有模板的组不能选，“其他”没有模板时不列）；选了只剩这一组，段头收起 ----
    await page.getByTestId('gallery-group').click();
    for (const g of GROUP_ORDER) {
      const item = page.getByTestId(`gallery-group-${g}`);
      const n = groupCount(g);
      if (g === 'other' && n === 0) {
        await expect(item).toHaveCount(0);
        continue;
      }
      await expect(item.locator('.num'), g).toHaveText(String(n));
      if (n === 0) await expect(item, g).toHaveAttribute('data-disabled', '');
      else await expect(item, g).not.toHaveAttribute('data-disabled');
    }
    await page.getByTestId('gallery-group-ui').click();
    const ui = await shownIds(page);
    sameIds(ui, idsOf((e) => groupOf(e) === 'ui'));
    inFullOrder(ui);
    expect(ui).toContain('allay.builtin.loading-screen');
    expect(ui).toContain('allay.builtin.advancement-toast');
    await expect(page.locator('[data-testid^="gallery-section-"] h3')).toHaveCount(0);
    await expect(page.getByTestId('gallery-count')).toHaveText(`${ui.length} 个模板`);
    // 类别和分组一起：“标题”里没有界面组的模板 → 说明加出路（出路是放开分组，留在“标题”里）
    expect(idsOf((e) => groupOf(e) === 'ui' && e.manifest.category === 'title'), '前提：界面组里没有标题类模板').toEqual([]);
    await page.getByTestId('gallery-tab-title').click();
    await expect(page.getByTestId('gallery-filtered-empty')).toBeVisible();
    await page.getByTestId('gallery-filtered-empty').getByRole('button').click();
    const titles = await shownIds(page);
    sameIds(titles, idsOf((e) => e.manifest.category === 'title'));
    expect(titles).toContain('user.e2e.title');
    await page.getByTestId('gallery-tab-all').click();

    // ---- 搜索：两种语言的名称、组名、id；结果数；没有结果时的一句话 ----
    // 每个词的预期结果由 expectedHits 从 manifest 算；先确认这个词测得到它要测的东西
    await page.keyboard.press('Control+KeyF');
    const box = page.getByTestId('gallery-search');
    await expect(box).toBeFocused();
    const search = async (query: string, mustFind: string): Promise<string[]> => {
      const want = expectedHits(all, query);
      expect(want, `前提：“${query}”搜得到 ${mustFind}`).toContain(mustFind);
      await box.fill(query);
      const got = await shownIds(page);
      sameIds(got, want);
      inFullOrder(got);
      await expect(page.getByTestId('gallery-count')).toHaveText(`${want.length} 个结果`);
      return got;
    };
    // 英文名，两个词
    await search('block wipe', 'allay.builtin.block-wipe');
    // 组名：像素溶解自己的名称、说明、tags 里都没有“着色器”，只能经它所在组的名字（像素与着色器）搜到；同组的全部搜到
    const pixel = all.find((e) => e.id === 'allay.builtin.pixel-dissolve')!;
    expect(ownText(pixel), '前提：像素溶解自己的文字里没有“着色器”').not.toContain('着色器');
    const byGroupName = await search('着色器', pixel.id);
    for (const id of idsOf((e) => groupOf(e) === groupOf(pixel))) expect(byGroupName).toContain(id);
    // id
    await search('sound-subtitles', 'allay.builtin.sound-subtitles');
    expect(expectedHits(all, '末影龙'), '前提：“末影龙”什么也搜不到').toEqual([]);
    await box.fill('末影龙');
    await expect(page.getByTestId('gallery-no-results')).toContainText('没有找到“末影龙”');
    await expect(page.getByTestId('gallery-no-results')).toContainText('可以搜模板的中文名、英文名');
    await page.getByTestId('gallery-clear-search').click();
    await expect(box).toHaveValue('');
    // 别的类别里有：提示有几个，一键去全部模板里看
    const subtitles = expectedHits(all, 'subtitles');
    expect(subtitles, '前提：“subtitles”搜得到声音字幕').toContain('allay.builtin.sound-subtitles');
    expect(subtitles.filter((id) => category.get(id) === 'transition'), '前提：转场里没有“subtitles”').toEqual([]);
    await page.getByTestId('gallery-tab-transition').click();
    await box.fill('subtitles');
    await expect(page.getByTestId('gallery-no-results')).toContainText(`之外还有 ${subtitles.length} 个结果`);
    await page.getByTestId('gallery-show-everywhere').click();
    sameIds(await shownIds(page), subtitles);
    await expect(page.getByTestId('gallery-tab-all')).toHaveAttribute('aria-selected', 'true');
    await box.fill('');

    // ---- 键盘：卡片是一个 Tab 停靠点，方向键在卡片间走，回车选中；方向键不再拖动时间 ----
    const order = await shownIds(page);
    // 下方向键的去处按卡片在屏幕上的位置算：下一行的同一列，那一行短就是它的最后一张（每个组从新的一行开始）
    const below = (id: string) =>
      page.evaluate((from) => {
        const cards = [...document.querySelectorAll<HTMLElement>('[data-testid="template-list"] [data-card-key] [data-testid^="template-"]')].map((el) => ({ id: el.dataset.testid!.slice('template-'.length), r: el.getBoundingClientRect() }));
        const at = cards.find((c) => c.id === from)!;
        const nextTop = Math.min(...cards.filter((c) => c.r.top > at.r.bottom - 1).map((c) => c.r.top));
        const row = cards.filter((c) => Math.abs(c.r.top - nextTop) < 1);
        return (row.find((c) => Math.abs(c.r.left - at.r.left) < 1) ?? row.at(-1))?.id ?? from;
      }, id);
    await page.getByTestId(`template-${order[0]}`).focus();
    const t0 = await page.evaluate(() => window.__allayTest!.transport().time);
    await page.keyboard.press('ArrowRight');
    await expect(page.getByTestId(`template-${order[1]}`)).toBeFocused();
    const down = await below(order[1]!);
    expect(down, '前提：第二张卡片下面还有一行').not.toBe(order[1]);
    await page.keyboard.press('ArrowDown');
    await expect(page.getByTestId(`template-${down}`)).toBeFocused();
    await page.keyboard.press('End');
    await expect(page.getByTestId(`template-${order.at(-1)}`)).toBeFocused();
    await page.keyboard.press('Home');
    await expect(page.getByTestId(`template-${order[0]}`)).toBeFocused();
    expect(await page.evaluate(() => window.__allayTest!.transport().time)).toBe(t0);
    // 只有一张卡片在 Tab 顺序里
    expect(await page.locator('[data-testid="template-list"] button[tabindex="0"]').count()).toBe(1);
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('Enter');
    await expect.poll(() => page.evaluate(() => window.__allayTest!.project().ref?.id)).toBe(order[1]);
    // 搜索框里按下方向键：到第一张卡片
    await page.keyboard.press('Control+KeyF');
    const wipes = await search('擦除', 'allay.builtin.block-wipe');
    await box.press('ArrowDown');
    await expect(page.getByTestId(`template-${wipes[0]}`)).toBeFocused();
  } finally {
    await stop(ctx);
  }
});

test('T-GAL-10 “标题”类别：模板库、属性面板、时间轴、导出都走得通', async () => {
  test.setTimeout(180_000);
  const out = join(makeUserDataDir(), 'exports');
  mkdirSync(out, { recursive: true });
  const ctx = await start({
    userTemplates: { 'user.e2e.opener': titleTemplate('user.e2e.opener', { 'zh-CN': '片头标题', en: 'Opening title' }, ['channel']) },
    env: { ALLAY_E2E_EXPORT_TARGET: out, ALLAY_FFMPEG: requirePinnedFfmpeg() },
  });
  const { page } = ctx;
  try {
    // 模板库：“标题”标签里有它，卡片有封面，提示里写着类别和组
    await page.getByTestId('gallery-tab-title').click();
    const card = page.getByTestId('template-user.e2e.opener');
    await expect(card).toBeVisible();
    await expect(card.locator('img')).toBeVisible({ timeout: 30_000 });
    await expect(card).toHaveAttribute('title', /标题 · 频道包装/);
    await card.click();
    await expect.poll(() => page.evaluate(() => window.__allayTest!.project().ref?.id)).toBe('user.e2e.opener');
    await upToDate(page);
    // 属性面板的类别和时长；时间轴没有剪辑点那一轨
    await expect(page.getByTestId('params-panel')).toContainText('标题 · 1.60 s');
    expect(await page.evaluate(() => window.__allayTest!.transport().cutTime)).toBeNull();
    await expect(page.getByTestId('timeline-cut-lane')).toHaveCount(0);
    expect((await page.evaluate(() => window.__allayTest!.previewStats(0.8))).maxAlpha).toBeGreaterThan(0);
    // 导出对话框：没有剪辑点，不检查遮盖（文案不再说“叠加层”）
    await page.keyboard.press('Control+KeyE');
    await expect(page.getByTestId('export-cover')).toHaveAttribute('data-state', 'overlay', { timeout: 30_000 });
    await expect(page.getByTestId('export-cover')).toContainText('叠加层和标题都没有');
    await page.keyboard.press('Escape');
    // 导出一遍：帧数、首末帧透明、中间有画面、没有剪辑点的标记
    const r = await page.evaluate(() => window.__allayTest!.dispatch('exportTask.start', { preset: 'prores4444', quality: 'draft' }));
    expect(r.ok, JSON.stringify(r)).toBe(true);
    const taskId = (r as { ok: true; output: { taskId: string } }).output.taskId;
    await expect.poll(async () => ((await page.evaluate((id) => window.__allayTest!.dispatch('exportTask.get', { taskId: id }), taskId)) as { output?: { status?: string } }).output?.status, { timeout: 120_000 }).toMatch(/^(done|failed|canceled)$/);
    const task = ((await page.evaluate((id) => window.__allayTest!.dispatch('exportTask.get', { taskId: id }), taskId)) as { output: { status: string; result: { path: string; frames: number; cutFrame: number | null } } }).output;
    expect(task.status).toBe('done');
    expect(task.result.cutFrame).toBeNull();
    const info = probe(task.result.path, 'stream=nb_read_frames:format_tags=comment');
    expect(info['TAG:comment']).toBeUndefined();
    const alpha: number[] = [];
    await decodeAllRgba(task.result.path, 1920 * 1080 * 4, (frame) => {
      let max = 0;
      for (let i = 3; i < frame.length; i += 4) if (frame[i]! > max) max = frame[i]!;
      alpha.push(max);
    });
    expect(alpha).toHaveLength(task.result.frames);
    expect(alpha[0]).toBe(0);
    expect(alpha.at(-1)).toBe(0);
    expect(Math.max(...alpha)).toBeGreaterThan(0);
  } finally {
    await stop(ctx);
    rmSync(join(out, '..'), { recursive: true, force: true });
  }
});

test('T-GAL-12 封面只为可见的卡片生成；快速滚过去的撤掉；资源栈变了只重画看得到的', async () => {
  test.setTimeout(300_000);
  const ctx = await start({ library: true });
  const { page } = ctx;
  try {
    await visibleCoversReady(page);
    await page.waitForTimeout(1500);
    const first = await stats(page);
    const near = new Set((await cardsIn(page, 1.05)).map(coverKeyOf));
    // 启动后只生成了可见范围上下各一屏之内的
    expect(first.rendered.length, `rendered ${first.rendered.length}`).toBeGreaterThan(0);
    expect(first.rendered.length).toBeLessThan(40);
    expect(first.rendered.filter((k) => !near.has(k)), '只生成可见范围附近的').toEqual([]);
    expect(first.sheets, '没有悬停就没有悬停预览').toEqual([]);

    // 快速滚到底（甩一下：每帧跨过一大段）：滚过去的卡片大多没有生成，请求被撤掉
    const total = (await shownIds(page)).length;
    await page.evaluate(async () => {
      const el = document.querySelector<HTMLElement>('[data-testid="template-scroll"]')!;
      const max = el.scrollHeight - el.clientHeight;
      for (let i = 1; i <= 12; i++) {
        el.scrollTop = (max * i) / 12;
        await new Promise((r) => requestAnimationFrame(() => r(null)));
      }
    });
    await visibleCoversReady(page);
    await page.waitForTimeout(1500);
    const after = await stats(page);
    const bottom = new Set((await cardsIn(page, 1.05)).map(coverKeyOf));
    const passed = total - near.size - bottom.size;
    const skipped = after.rendered.slice(first.rendered.length).filter((k) => !bottom.has(k) && !near.has(k));
    expect(passed).toBeGreaterThan(30);
    expect(skipped.length, `滚过去的 ${passed} 张里生成了 ${skipped.length} 张：${skipped.join(', ')}`).toBeLessThan(passed / 2);
    expect(after.dropped.length, '滚过去的请求撤掉了').toBeGreaterThan(0);
    expect(after.queue).toEqual([]);

    // 资源栈变了：旧封面照常显示，只重画看得到的
    const visible = await cardsIn(page, 0);
    await page.evaluate(() => window.allay.resources.setVanilla({ enabled: false }));
    await expect.poll(() => page.evaluate(() => window.__allayTest!.resourceState()?.hasAssets)).toBe(false);
    for (const key of visible.slice(0, 4)) {
      const id = key.slice(0, key.lastIndexOf('@'));
      await expect(page.getByTestId(`template-${id}`)).not.toHaveAttribute('data-cover', 'loading');
    }
    await visibleCoversReady(page);
    await page.waitForTimeout(1500);
    const redraw = (await stats(page)).rendered.slice(after.rendered.length);
    const nearNow = new Set((await cardsIn(page, 1.05)).map(coverKeyOf));
    expect(redraw.length).toBeGreaterThan(0);
    expect(redraw.filter((k) => !nearNow.has(k)), '只重画可见范围附近的').toEqual([]);
  } finally {
    await stop(ctx);
  }
});

test('T-GAL-13 悬停预览：指针停够了才生成，移开就停，只生成停过的', async () => {
  test.setTimeout(180_000);
  const ctx = await start();
  const { page } = ctx;
  try {
    await visibleCoversReady(page);
    expect((await stats(page)).sheets).toEqual([]);
    const ids = await shownIds(page);
    const versions = new Map((await page.evaluate(() => window.__allayTest!.templates())).map((e) => [e.id, e.version]));
    const keyOf = (id: string) => coverKeyOf(`${id}@${versions.get(id)!}`);
    const cardA = page.getByTestId(`template-${ids[1]}`);
    const cardB = page.getByTestId(`template-${ids[2]}`);
    // 划过去（不到停留时长）：不生成
    for (const id of ids.slice(0, 6)) {
      await page.getByTestId(`template-${id}`).hover();
      await page.waitForTimeout(60);
    }
    await page.mouse.move(700, 880);
    await page.waitForTimeout(800);
    expect((await stats(page)).sheets, '划过去不生成').toEqual([]);
    expect((await stats(page)).aborted).toEqual([]);
    // 停住：生成，第一帧画好就开始播（边画边播），画完进缓存
    await cardA.hover();
    await expect(cardA.locator('canvas')).toBeVisible({ timeout: 60_000 });
    await expect.poll(async () => (await stats(page)).sheets, { timeout: 60_000 }).toEqual([keyOf(ids[1]!)]);
    const s1 = await stats(page);
    // 移开：画布撤掉
    await page.mouse.move(700, 880);
    await expect(cardA.locator('canvas')).toHaveCount(0);
    // 停在 B 上、生成到一半移开：中途停下，不算生成完（测试钩子把每帧放慢到 40 ms，保证移开时还在渲染）
    await page.evaluate(() => window.__allayTest!.setCoverFrameDelay(40));
    await cardB.hover();
    await expect.poll(async () => (await stats(page)).running ?? '', { timeout: 30_000 }).toBe(`sheet:${keyOf(ids[2]!)}`);
    await page.waitForTimeout(200);
    await page.mouse.move(700, 880);
    await expect.poll(async () => (await stats(page)).aborted, { timeout: 30_000 }).toEqual([keyOf(ids[2]!)]);
    await page.evaluate(() => window.__allayTest!.setCoverFrameDelay(0));
    const s2 = await stats(page);
    expect(s2.sheets).toEqual(s1.sheets);
    expect(s2.running).toBeNull();
    await expect(cardB.locator('canvas')).toHaveCount(0);
    // 再停回 A：这次从内存里取，不再渲染
    await cardA.hover();
    await expect(cardA.locator('canvas')).toBeVisible({ timeout: 30_000 });
    expect((await stats(page)).sheets).toEqual(s1.sheets);
  } finally {
    await stop(ctx);
  }
});
