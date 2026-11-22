// pnpm review:gallery：模板库（docs/decisions.md“模板库撑到一百个模板”）的评审截图。需要先 pnpm build。窗口不显示，用 capturePage 截页面。
//
// 默认用测试脚本生成的假原版层（纯色色块），截图写进 docs/review/gallery/（可以提交，里面没有任何 Mojang 素材）。
// 给了本机游戏目录时用游戏文件里的原版贴图，截图只写进 docs/review/gallery/out/（被 git 忽略）：
//   pnpm review:gallery --game "E:\Plain Craft Launcher 2\.minecraft" --version 26.2
//   --only=<名字片段>   只截名字含这个片段的场景
// 一百个模板的场景用 tests/e2e/template-library.ts 现拼（复制内置模板、改 id 和名字），不提交生成的包。
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { _electron as electron, type ElectronApplication, type Page } from '@playwright/test';
import { requiredTextures, vanillaLayerId } from '../packages/assets/src/index';
import { makeTemplateLibrary } from '../tests/e2e/template-library';
import { catalogJarEntries, makeCatalogGame } from '../tests/unit/helpers/resource-fixtures';

const ROOT = resolve(import.meta.dirname, '..');
const DESKTOP = join(ROOT, 'apps/desktop');
const arg = (name: string) => {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
};
const only = process.argv.find((a) => a.startsWith('--only='))?.slice('--only='.length) ?? '';
const game = arg('--game');
const version = arg('--version');
const OUT = join(ROOT, 'docs/review/gallery', game ? 'out' : '');

type Theme = 'dark' | 'light';
type Lang = 'zh-CN' | 'en';

interface Scene {
  name: string;
  theme: Theme;
  language: Lang;
  /** 左栏宽度（缺省 280） */
  left?: number;
  /** 用一百个模板的库 */
  library?: boolean;
  /** 额外装几个用户模板：会出错的、有警告的、基模板缺失的 */
  broken?: boolean;
  act?(page: Page): Promise<void>;
}

/** 可见范围里的卡片都有封面了（或者确定生成不了） */
async function coversSettled(page: Page): Promise<void> {
  await page.waitForFunction(
    () => {
      const scroller = document.querySelector<HTMLElement>('[data-testid="template-scroll"]');
      if (!scroller) return false;
      const view = scroller.getBoundingClientRect();
      for (const card of document.querySelectorAll<HTMLElement>('[data-testid="template-list"] [data-cover]')) {
        const r = card.getBoundingClientRect();
        if (r.bottom <= view.top || r.top >= view.bottom) continue;
        if (card.dataset.cover === 'loading') return false;
      }
      return document.querySelector('[data-testid="gallery-loader"]')?.getAttribute('data-allay-loader-phase') === 'idle';
    },
    undefined,
    { timeout: 120_000 },
  );
}

async function scrollGallery(page: Page, fraction: number): Promise<void> {
  await page.evaluate((f) => {
    const el = document.querySelector<HTMLElement>('[data-testid="template-scroll"]')!;
    el.scrollTop = (el.scrollHeight - el.clientHeight) * f;
  }, fraction);
  await page.waitForTimeout(300);
  await coversSettled(page);
}

async function search(page: Page, text: string): Promise<void> {
  await page.keyboard.press('Control+KeyF');
  await page.getByTestId('gallery-search').fill(text);
  await page.waitForTimeout(300);
}

const SCENES: Scene[] = [
  { name: 'gallery-dark-zh', theme: 'dark', language: 'zh-CN' },
  { name: 'gallery-light-zh', theme: 'light', language: 'zh-CN' },
  { name: 'gallery-dark-en-narrow', theme: 'dark', language: 'en', left: 240 },
  { name: 'gallery-light-en-narrow', theme: 'light', language: 'en', left: 240 },
  { name: 'search-none-dark-zh', theme: 'dark', language: 'zh-CN', act: (p) => search(p, '末影龙') },
  {
    name: 'search-elsewhere-light-zh',
    theme: 'light',
    language: 'zh-CN',
    act: async (p) => {
      await p.getByTestId('gallery-tab-transition').click();
      await search(p, '字幕');
    },
  },
  { name: 'search-results-dark-en', theme: 'dark', language: 'en', act: (p) => search(p, 'block') },
  {
    name: 'group-menu-dark-zh',
    theme: 'dark',
    language: 'zh-CN',
    library: true,
    act: async (p) => {
      await p.getByTestId('gallery-group').click();
      await p.waitForTimeout(300);
    },
  },
  { name: 'library100-middle-dark-zh', theme: 'dark', language: 'zh-CN', library: true, act: (p) => scrollGallery(p, 0.5) },
  { name: 'library100-middle-light-en', theme: 'light', language: 'en', library: true, act: (p) => scrollGallery(p, 0.5) },
  {
    name: 'library100-title-dark-zh',
    theme: 'dark',
    language: 'zh-CN',
    library: true,
    act: async (p) => {
      await p.getByTestId('gallery-tab-title').click();
      await p.waitForTimeout(300);
      await coversSettled(p);
    },
  },
  {
    name: 'library100-group-light-zh',
    theme: 'light',
    language: 'zh-CN',
    library: true,
    act: async (p) => {
      await p.getByTestId('gallery-group').click();
      await p.getByTestId('gallery-group-channel').click();
      await p.waitForTimeout(300);
      await coversSettled(p);
    },
  },
  {
    name: 'hover-preview-dark-zh',
    theme: 'dark',
    language: 'zh-CN',
    act: async (p) => {
      const card = p.getByTestId('template-allay.builtin.pixel-dissolve');
      await card.scrollIntoViewIfNeeded();
      await card.hover();
      await card.locator('canvas').waitFor({ timeout: 60_000 });
      await p.waitForTimeout(700);
    },
  },
  {
    name: 'keyboard-focus-light-zh',
    theme: 'light',
    language: 'zh-CN',
    act: async (p) => {
      await p.getByTestId('template-allay.builtin.block-wipe').focus();
      await p.keyboard.press('ArrowRight');
      await p.keyboard.press('ArrowDown');
      await p.waitForTimeout(400);
    },
  },
  { name: 'states-dark-zh', theme: 'dark', language: 'zh-CN', broken: true, act: (p) => p.getByTestId('gallery-tab-mine').click() },
  { name: 'states-light-en', theme: 'light', language: 'en', broken: true, act: (p) => p.getByTestId('gallery-tab-mine').click() },
];

/** 会出错的、有试运行警告的、基模板缺失的用户模板（直接写进用户模板文件夹） */
function writeBrokenTemplates(userData: string): void {
  const write = (id: string, files: Record<string, string>, meta: Record<string, unknown> = {}) => {
    const dir = join(userData, 'templates', id, '1.0.0');
    mkdirSync(dir, { recursive: true });
    for (const [name, text] of Object.entries(files)) writeFileSync(join(dir, name), text);
    writeFileSync(join(userData, 'templates', id, '1.0.0.meta.json'), JSON.stringify({ formatVersion: 1, installedAt: '2026-11-22T00:00:00.000Z', trialWarnings: [], ...meta }));
  };
  const manifest = (id: string, name: Record<string, string>, extra: Record<string, unknown> = {}) =>
    JSON.stringify({ formatVersion: 1, id, version: '1.0.0', name, category: 'overlay', params: [{ key: 'size', type: 'number', label: 'Size', default: 1, min: 0, max: 2 }], ...extra });
  const ok = `export default { async setup(ctx) { const g = new ctx.THREE.PlaneGeometry(ctx.stage.width * 0.6, ctx.stage.height * 0.3); const m = new ctx.THREE.MeshBasicMaterial({ color: 0x6f55c8, transparent: true }); const mesh = new ctx.THREE.Mesh(g, m); ctx.scene.add(mesh); return { duration: 2, cutTime: null, update(t) { m.opacity = Math.sin(Math.PI * t / 2); } }; } };`;
  write('user.review.throws', { 'manifest.json': manifest('user.review.throws', { 'zh-CN': '会出错的模板', en: 'Throws on setup' }), 'template.js': 'export default { async setup() { throw new Error("broken on purpose"); } };' });
  write('user.review.warns', { 'manifest.json': manifest('user.review.warns', { 'zh-CN': '有警告的模板', en: 'Has warnings' }, { tags: ['text'] }), 'template.js': ok }, { trialWarnings: ['nondeterministic'] });
  write('user.review.orphan', {
    'manifest.json': JSON.stringify({ formatVersion: 1, id: 'user.review.orphan', version: '1.0.0', name: { 'zh-CN': '基模板缺失', en: 'Base missing' }, category: 'overlay', extends: { id: 'user.review.gone', version: '^1.0.0' }, overrides: { defaults: {} } }),
  });
  write('user.review.fine', { 'manifest.json': manifest('user.review.fine', { 'zh-CN': '我的叠加层', en: 'My overlay' }, { tags: ['channel'] }), 'template.js': ok });
}

async function launch(userData: string, extra: Record<string, string>): Promise<{ app: ElectronApplication; page: Page }> {
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) if (v !== undefined && k !== 'ELECTRON_RUN_AS_NODE' && k !== 'NODE_OPTIONS') env[k] = v;
  Object.assign(env, { ALLAY_USER_DATA_DIR: userData, ALLAY_E2E_HIDDEN: '1', ALLAY_E2E_HOOKS: '1', ALLAY_E2E_MASCOT_DIR: join(userData, 'no-mascot'), ...extra });
  const electronPath = createRequire(join(DESKTOP, 'package.json'))('electron') as string;
  const app = await electron.launch({ executablePath: electronPath, args: [DESKTOP], env, cwd: DESKTOP });
  const page = await app.firstWindow();
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setContentSize(1440, 900));
  await page.waitForFunction(() => window.__allayTest?.previewUpToDate() === true, undefined, { timeout: 60_000 });
  // 原版层在后台探测，探测完资源栈变一次
  await page.waitForFunction(() => window.__allayTest?.resourceState()?.detecting === false, undefined, { timeout: 60_000 });
  await page.waitForTimeout(300);
  await coversSettled(page);
  return { app, page };
}

async function main(): Promise<void> {
  if (game && !version) throw new Error('--game 要和 --version 一起给');
  mkdirSync(OUT, { recursive: true });
  const work = mkdtempSync(join(tmpdir(), 'allay-review-gallery-'));
  try {
    const paths = requiredTextures().map((r) => ({ id: r.id, path: r.anyOf[0]! }));
    const appData = join(work, 'appdata');
    makeCatalogGame(join(appData, '.minecraft'), '9.9.9', '2030-01-01T00:00:00+00:00', catalogJarEntries(paths, { 'minecraft:block/diamond_block': '#3fbfa0' }));
    const library = join(work, 'library');
    makeTemplateLibrary(library, 100);
    for (const scene of SCENES.filter((s) => s.name.includes(only))) {
      const data = join(work, scene.name);
      mkdirSync(data, { recursive: true });
      const ui = { theme: scene.theme, language: scene.language, reducedMotion: 'off', onboardingCompleted: true, tourCompleted: true, layout: { left: { size: scene.left ?? 280, collapsed: false }, right: { size: 320, collapsed: false } } };
      const resources = game
        ? { vanilla: { consent: true, enabled: true, dir: game }, packs: [], vanillaSources: [{ id: vanillaLayerId({ kind: 'local', gameDir: game, versionId: version! }), source: { kind: 'local', gameDir: game, versionId: version! }, enabled: true }] }
        : { vanilla: { consent: true, enabled: true, dir: null }, packs: [] };
      writeFileSync(join(data, 'settings.json'), JSON.stringify({ formatVersion: 1, ui, resources }));
      if (scene.broken) writeBrokenTemplates(data);
      const extra: Record<string, string> = { ALLAY_E2E_GAME_APPDATA: game ? join(work, 'no-game') : appData };
      if (scene.library) extra.ALLAY_E2E_TEMPLATES_DIR = library;
      const { app, page } = await launch(data, extra);
      try {
        await page.mouse.move(700, 880);
        await scene.act?.(page);
        if (!scene.name.startsWith('hover')) await page.waitForTimeout(400);
        const png = await app.evaluate(async ({ BrowserWindow }) => (await BrowserWindow.getAllWindows()[0]!.webContents.capturePage()).toPNG().toString('base64'));
        writeFileSync(join(OUT, `${scene.name}.png`), Buffer.from(png, 'base64'));
        // 左栏的细节（原尺寸）
        const panel = await page.getByTestId('panel-left').boundingBox();
        if (panel) {
          const rect = { x: Math.floor(panel.x), y: Math.floor(panel.y), width: Math.ceil(panel.width), height: Math.ceil(panel.height) };
          const crop = await app.evaluate(async ({ BrowserWindow }, r) => (await BrowserWindow.getAllWindows()[0]!.webContents.capturePage(r)).toPNG().toString('base64'), rect);
          writeFileSync(join(OUT, `${scene.name}.left.png`), Buffer.from(crop, 'base64'));
        }
        console.log(`[review:gallery] ${scene.name}.png`);
      } finally {
        await app.close();
      }
    }
  } finally {
    rmSync(work, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 });
  }
}

void main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
