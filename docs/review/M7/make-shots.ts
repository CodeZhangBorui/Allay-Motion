// M7 评审截图：导出对话框的设置页、进度页、完成页（以及失败页），深色中文、浅色英文。
// 运行：pnpm build 之后 `pnpm exec tsx docs/review/M7/make-shots.ts`。窗口不显示，用 capturePage 截页面。
// 资源栈里只有生成的假原版层（每张贴图一个纯色色块，测试数据，不是产品素材），画面里没有任何 Mojang 素材。
// 导出写到临时目录，截完即删；进度页用测试钩子让导出停在第 30 帧。
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { _electron as electron, type ElectronApplication, type Page } from '@playwright/test';
import { requiredTextures } from '../../../packages/assets/src/index';
import { catalogJarEntries, makeCatalogGame } from '../../../tests/unit/helpers/resource-fixtures';

const ROOT = resolve(import.meta.dirname, '../../..');
const DESKTOP = join(ROOT, 'apps/desktop');
const OUT = import.meta.dirname;
const FFMPEG = join(ROOT, 'resources', 'ffmpeg', `${process.platform}-${process.arch}`, process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg');

async function launch(userData: string, extra: Record<string, string>): Promise<{ app: ElectronApplication; page: Page }> {
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) if (v !== undefined && k !== 'ELECTRON_RUN_AS_NODE' && k !== 'NODE_OPTIONS') env[k] = v;
  Object.assign(env, { ALLAY_USER_DATA_DIR: userData, ALLAY_E2E_HIDDEN: '1', ALLAY_E2E_HOOKS: '1', ALLAY_E2E_MOJANG_ORIGIN: 'http://127.0.0.1:9', ALLAY_FFMPEG: FFMPEG, ...extra });
  const electronPath = createRequire(join(DESKTOP, 'package.json'))('electron') as string;
  const app = await electron.launch({ executablePath: electronPath, args: [DESKTOP], env, cwd: DESKTOP });
  const page = await app.firstWindow();
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setContentSize(1440, 900));
  await page.waitForFunction(() => window.__allayTest?.previewUpToDate() === true, undefined, { timeout: 30_000 });
  await page.waitForTimeout(1500);
  return { app, page };
}

async function shot(app: ElectronApplication, name: string): Promise<void> {
  const png = await app.evaluate(async ({ BrowserWindow }) => (await BrowserWindow.getAllWindows()[0]!.webContents.capturePage()).toPNG().toString('base64'));
  const file = join(OUT, `${name}.png`);
  writeFileSync(file, Buffer.from(png, 'base64'));
  console.log(`[review:m7] ${file}`);
}

function seed(userData: string, theme: string, language: string): void {
  mkdirSync(userData, { recursive: true });
  writeFileSync(
    join(userData, 'settings.json'),
    JSON.stringify({ formatVersion: 1, ui: { theme, language, reducedMotion: 'off', layout: { left: { size: 280, collapsed: false }, right: { size: 320, collapsed: false } } }, resources: { vanilla: { consent: true, enabled: true, dir: null }, packs: [] } }),
  );
}

const work = mkdtempSync(join(tmpdir(), 'allay-review-m7-'));
try {
  const appData = join(work, 'appdata');
  const paths = requiredTextures().map((r) => ({ id: r.id, path: r.anyOf[0]! }));
  makeCatalogGame(join(appData, '.minecraft'), '9.9.9', '2030-01-01T00:00:00+00:00', catalogJarEntries(paths, { 'minecraft:block/diamond_block': '#3fbfa0' }));
  for (const [theme, language, tag] of [
    ['dark', 'zh-CN', 'dark-zh'],
    ['light', 'en', 'light-en'],
  ] as const) {
    const data = join(work, tag);
    const exportsDir = join(work, `${tag}-exports`);
    mkdirSync(exportsDir);
    seed(data, theme, language);
    const { app, page } = await launch(data, { ALLAY_E2E_GAME_APPDATA: appData, ALLAY_E2E_EXPORT_TARGET: exportsDir });
    try {
      // 设置页（浅色英文的那张选绿幕，显示底色一行）
      await page.getByTestId('topbar-export').click();
      if (tag === 'light-en') await page.getByTestId('export-preset-greenscreen-mp4').click();
      await page.waitForFunction(() => document.querySelector('[data-testid="export-cover"]')?.getAttribute('data-state') === 'ok', undefined, { timeout: 30_000 });
      await page.waitForFunction(() => document.querySelector('[data-testid="export-preset-greenscreen-mp4"]')?.getAttribute('data-state') === 'ok', undefined, { timeout: 30_000 });
      await shot(app, `settings-${tag}`);
      // 进度页：停在第 30 帧
      await page.evaluate(() => window.__allayTest!.pauseExportAfter(30));
      await page.getByTestId('export-start').click();
      await page.waitForFunction(() => window.__allayTest!.exportPausedAt() === 30, undefined, { timeout: 30_000 });
      await page.waitForTimeout(600);
      await shot(app, `progress-${tag}`);
      // 完成页
      await page.evaluate(() => window.__allayTest!.resumeExport());
      await page.waitForFunction(() => document.querySelector('[data-testid="export-result"]')?.getAttribute('data-kind') === 'done', undefined, { timeout: 60_000 });
      await page.waitForTimeout(400);
      await shot(app, `done-${tag}`);
      await page.evaluate(() => window.__allayTest!.pauseExportAfter(null));
    } finally {
      await app.close();
    }
  }
  // 失败页：输出位置不可写
  const data = join(work, 'failed');
  seed(data, 'dark', 'zh-CN');
  const file = join(work, 'a-file');
  writeFileSync(file, 'x');
  const { app, page } = await launch(data, { ALLAY_E2E_GAME_APPDATA: appData, ALLAY_E2E_EXPORT_TARGET: join(file, 'sub') });
  try {
    await page.getByTestId('topbar-export').click();
    await page.getByTestId('export-start').click();
    await page.waitForFunction(() => document.querySelector('[data-testid="export-result"]')?.getAttribute('data-kind') === 'failed', undefined, { timeout: 30_000 });
    await page.waitForTimeout(400);
    await shot(app, 'failed-dark-zh');
  } finally {
    await app.close();
  }
} finally {
  rmSync(work, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 });
}
