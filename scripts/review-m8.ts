// pnpm review:m8：M8 的评审截图（docs/review/M8/README.md）。需要先 pnpm build。窗口不显示，用 capturePage 截页面。
// 悦灵用 CSS 占位（不把这台机器上烘焙的原版贴图派生图像放进提交的截图），没有原版素材。
// 1. m8-about-top-*.png：关于页的上半（版本、声明、悦灵图像的来源、准则链接、FFmpeg 许可）；m8-about-*.png：关于页（声明、悦灵图像的来源、准则链接、FFmpeg 的来源、第三方许可清单，展开 three 一项）。
// 2. m8-no-webgl-zh.png / m8-no-webgl-en.png：WebGL2 不可用时的说明页（关掉 GPU 和软件渲染模拟）。
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { _electron as electron, type ElectronApplication, type Page } from '@playwright/test';

const ROOT = resolve(import.meta.dirname, '..');
const DESKTOP = join(ROOT, 'apps/desktop');
const OUT = join(ROOT, 'docs/review/M8');

async function shot(app: ElectronApplication, file: string): Promise<void> {
  const png = await app.evaluate(async ({ BrowserWindow }) => (await BrowserWindow.getAllWindows()[0]!.webContents.capturePage()).toPNG().toString('base64'));
  writeFileSync(join(OUT, file), Buffer.from(png, 'base64'));
  console.log(`[review:m8] ${file}`);
}

async function session(language: 'zh-CN' | 'en', extraEnv: Record<string, string>, ready: string, run: (app: ElectronApplication, page: Page) => Promise<void>): Promise<void> {
  const userData = mkdtempSync(join(tmpdir(), 'allay-review-'));
  writeFileSync(join(userData, 'settings.json'), JSON.stringify({ formatVersion: 1, ui: { language, theme: 'dark' } }));
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) if (v !== undefined && k !== 'ELECTRON_RUN_AS_NODE' && k !== 'NODE_OPTIONS') env[k] = v;
  Object.assign(env, {
    ALLAY_USER_DATA_DIR: userData,
    ALLAY_E2E_HIDDEN: '1',
    ALLAY_E2E_HOOKS: '1',
    ALLAY_E2E_MOJANG_ORIGIN: 'http://127.0.0.1:9',
    ALLAY_E2E_GAME_APPDATA: join(userData, 'no-game'),
    ALLAY_E2E_MASCOT_DIR: join(userData, 'no-mascot'),
    ...extraEnv,
  });
  const electronPath = createRequire(join(DESKTOP, 'package.json'))('electron') as string;
  const app = await electron.launch({ executablePath: electronPath, args: [DESKTOP], env, cwd: DESKTOP });
  try {
    const page = await app.firstWindow();
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.waitForSelector(ready, { timeout: 30_000 });
    await page.waitForTimeout(500);
    await run(app, page);
  } finally {
    await app.close();
    rmSync(userData, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 });
  }
}

async function main(): Promise<void> {
  mkdirSync(OUT, { recursive: true });
  for (const [language, suffix] of [
    ['zh-CN', 'zh'],
    ['en', 'en'],
  ] as const) {
    await session(language, {}, '[data-testid="topbar"]', async (app, page) => {
      await page.evaluate(() => window.__allayTest!.dispatch('settings', { page: 'about' }));
      await page.waitForSelector('[data-testid="about-third-party-list"]');
      await page.waitForTimeout(300);
      await shot(app, `m8-about-top-${suffix}.png`);
      const three = page.getByTestId('about-third-party-list').locator('li', { hasText: 'three' }).first();
      await three.locator('summary').click();
      await page.getByTestId('about-third-party').scrollIntoViewIfNeeded();
      await page.waitForTimeout(300);
      await shot(app, `m8-about-${suffix}.png`);
    });
    await session(language, { ALLAY_E2E_NO_WEBGL: '1' }, '[data-testid="no-webgl"]', async (app) => {
      await shot(app, `m8-no-webgl-${suffix}.png`);
    });
  }
}

await main();
