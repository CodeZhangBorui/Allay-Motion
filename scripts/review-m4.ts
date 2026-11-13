// pnpm review:m4：M4 的评审截图（docs/review/M4/README.md）。需要先 pnpm build。窗口不显示，用 capturePage 截页面。
//
// 资源栈里只有测试脚本生成的假原版层（纯色色块），截深色、浅色、两种语言和主要状态。这些画面里没有任何 Mojang 素材，
// 悦灵是 M4 的 CSS 占位图形。加 --only=<名字片段> 只截名字含这个片段的几张（开发时看效果用）。
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { _electron as electron, type ElectronApplication, type Page } from '@playwright/test';
import { requiredTextures } from '../packages/assets/src/index';
import { catalogJarEntries, makeCatalogGame } from '../tests/unit/helpers/resource-fixtures';

const ROOT = resolve(import.meta.dirname, '..');
const DESKTOP = join(ROOT, 'apps/desktop');
const REVIEW = join(ROOT, 'docs/review/M4');
const only = process.argv.find((a) => a.startsWith('--only='))?.slice(7) ?? '';
const outDir = process.argv.find((a) => a.startsWith('--out='))?.slice(6) ?? REVIEW;

async function launch(userData: string, extra: Record<string, string>, size = { width: 1440, height: 900 }): Promise<{ app: ElectronApplication; page: Page }> {
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) if (v !== undefined && k !== 'ELECTRON_RUN_AS_NODE' && k !== 'NODE_OPTIONS') env[k] = v;
  Object.assign(env, { ALLAY_USER_DATA_DIR: userData, ALLAY_E2E_HIDDEN: '1', ALLAY_E2E_HOOKS: '1', ALLAY_E2E_MOJANG_ORIGIN: 'http://127.0.0.1:9', ...extra });
  const electronPath = createRequire(join(DESKTOP, 'package.json'))('electron') as string;
  const app = await electron.launch({ executablePath: electronPath, args: [DESKTOP], env, cwd: DESKTOP });
  const page = await app.firstWindow();
  await app.evaluate(({ BrowserWindow }, s) => BrowserWindow.getAllWindows()[0]!.setContentSize(s.width, s.height), size);
  await page.waitForFunction(() => window.__allayTest?.previewUpToDate() === true, undefined, { timeout: 30_000 });
  await page.waitForTimeout(1500);
  await page.waitForFunction(() => window.__allayTest?.previewUpToDate() === true, undefined, { timeout: 30_000 });
  return { app, page };
}

async function shot(app: ElectronApplication, name: string): Promise<void> {
  const png = await app.evaluate(async ({ BrowserWindow }) => (await BrowserWindow.getAllWindows()[0]!.webContents.capturePage()).toPNG().toString('base64'));
  const file = join(outDir, `${name}.png`);
  writeFileSync(file, Buffer.from(png, 'base64'));
  console.log(`[review:m4] ${file}`);
}

function seed(userData: string, ui: Record<string, unknown>): void {
  mkdirSync(userData, { recursive: true });
  writeFileSync(join(userData, 'settings.json'), JSON.stringify({ formatVersion: 1, ui: { theme: 'dark', language: 'zh-CN', reducedMotion: 'off', layout: { left: { size: 280, collapsed: false }, right: { size: 320, collapsed: false } }, ...ui }, resources: { vanilla: { consent: true, enabled: true, dir: null }, packs: [] } }));
}

interface Scene {
  name: string;
  theme: 'dark' | 'light';
  language: 'zh-CN' | 'en';
  fakeGame?: boolean;
  size?: { width: number; height: number };
  act?(page: Page): Promise<void>;
}

const SCENES: Scene[] = [
  { name: 'm4-dark-zh', theme: 'dark', language: 'zh-CN', act: (p) => p.evaluate(() => window.__allayTest!.setTime(0.55)) },
  { name: 'm4-light-en', theme: 'light', language: 'en', act: (p) => p.evaluate(() => window.__allayTest!.setTime(0.55)) },
  {
    name: 'm4-dark-en-block-picker',
    theme: 'dark',
    language: 'en',
    act: async (p) => {
      await p.getByTestId('param-blocks').getByRole('button').first().click();
      await p.waitForTimeout(1200);
    },
  },
  {
    name: 'm4-light-zh-easing',
    theme: 'light',
    language: 'zh-CN',
    act: async (p) => {
      await p.evaluate(() => window.__allayTest!.setParams({ inEase: [0.2, 1.4, 0.3, 1] }));
      await p.waitForTimeout(500);
    },
  },
  {
    name: 'm4-dark-zh-palette',
    theme: 'dark',
    language: 'zh-CN',
    act: async (p) => {
      await p.keyboard.press('Control+KeyK');
      await p.waitForTimeout(400);
    },
  },
  {
    name: 'm4-light-en-settings',
    theme: 'light',
    language: 'en',
    act: async (p) => {
      await p.keyboard.press('Control+Comma');
      await p.waitForTimeout(400);
    },
  },
  {
    name: 'm4-dark-zh-resources',
    theme: 'dark',
    language: 'zh-CN',
    act: async (p) => {
      await p.getByTestId('resources-button').click();
      await p.waitForTimeout(400);
    },
  },
  {
    name: 'm4-dark-en-error',
    theme: 'dark',
    language: 'en',
    act: async (p) => {
      await p.evaluate(() =>
        window.__allayTest!.loadTemplate('export default { setup() { throw new Error("demo: setup failed on purpose"); }, update() {} };'),
      );
      await p.waitForSelector('[data-testid="preview-error"]');
    },
  },
  { name: 'm4-light-zh-no-assets', theme: 'light', language: 'zh-CN', fakeGame: false },
  {
    name: 'm4-dark-zh-mine-empty',
    theme: 'dark',
    language: 'zh-CN',
    act: async (p) => {
      await p.getByTestId('gallery-tab-mine').click();
      await p.waitForTimeout(400);
    },
  },
  {
    name: 'm4-dark-en-loading',
    theme: 'dark',
    language: 'en',
    act: async (p) => {
      await p.evaluate(() => window.__allayTest!.simulateLoading(true));
      await p.waitForTimeout(900);
    },
  },
  { name: 'm4-light-en-min-size', theme: 'light', language: 'en', size: { width: 1120, height: 700 } },
];

mkdirSync(outDir, { recursive: true });
const work = mkdtempSync(join(tmpdir(), 'allay-review-m4-'));
try {
  // 假原版层：目录里每张贴图一个纯色色块（测试数据，不是产品素材）
  const appData = join(work, 'appdata');
  const paths = requiredTextures().map((r) => ({ id: r.id, path: r.anyOf[0]! }));
  makeCatalogGame(join(appData, '.minecraft'), '9.9.9', '2030-01-01T00:00:00+00:00', catalogJarEntries(paths, { 'minecraft:block/diamond_block': '#3fbfa0' }));
  const empty = join(work, 'no-game');
  mkdirSync(empty);
  for (const scene of SCENES.filter((s) => s.name.includes(only))) {
    const data = join(work, scene.name);
    seed(data, { theme: scene.theme, language: scene.language });
    const { app, page } = await launch(data, { ALLAY_E2E_GAME_APPDATA: scene.fakeGame === false ? empty : appData }, scene.size);
    try {
      await page.waitForTimeout(800);
      await scene.act?.(page);
      await page.waitForTimeout(300);
      await shot(app, scene.name);
    } finally {
      await app.close();
    }
  }
} finally {
  rmSync(work, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 });
}
