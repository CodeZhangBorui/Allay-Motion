// pnpm review:m2b：M2b 的评审截图（docs/review/M2b/README.md）。需要先 pnpm build。窗口不显示，用 capturePage 截页面。
//
// 1. 提交进仓库的截图：资源栈里只有测试脚本生成的假原版层（纯色色块）和一个假资源包，
//    分别截“没有素材时的引导状态”“假原版层下的预览”“资源栈弹层”。这些画面里没有任何 Mojang 素材。
// 2. 加 --real：手动冒烟。用这台机器上真装的游戏（%APPDATA%\.minecraft）或已有的下载缓存作原版层，
//    截一张预览，写到 docs/review/M2b/out/（被 .gitignore 忽略）。**含原版贴图的截图属于 Mojang 素材的画面，不提交。**
//    不会联网：不点“下载”。
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { _electron as electron, type ElectronApplication, type Page } from '@playwright/test';
import { requiredTextures } from '../packages/assets/src/index';
import { catalogJarEntries, makeCatalogGame, packMcmeta, solidPng, tex, writeZip } from '../tests/unit/helpers/resource-fixtures';

const ROOT = resolve(import.meta.dirname, '..');
const DESKTOP = join(ROOT, 'apps/desktop');
const REVIEW = join(ROOT, 'docs/review/M2b');
const OUT = join(REVIEW, 'out');
const real = process.argv.includes('--real');

async function launch(userData: string, extra: Record<string, string>): Promise<{ app: ElectronApplication; page: Page }> {
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) if (v !== undefined && k !== 'ELECTRON_RUN_AS_NODE' && k !== 'NODE_OPTIONS') env[k] = v;
  Object.assign(env, { ALLAY_USER_DATA_DIR: userData, ALLAY_E2E_HIDDEN: '1', ALLAY_E2E_HOOKS: '1', ALLAY_E2E_MOJANG_ORIGIN: 'http://127.0.0.1:9', ...extra });
  const electronPath = createRequire(join(DESKTOP, 'package.json'))('electron') as string;
  const app = await electron.launch({ executablePath: electronPath, args: [DESKTOP], env, cwd: DESKTOP });
  const page = await app.firstWindow();
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.waitForFunction(() => window.__allayTest?.status().kind === 'ready', undefined, { timeout: 30_000 });
  await page.evaluate(() => window.__allayTest!.setTime(0.55));
  await page.waitForTimeout(1500);
  return { app, page };
}

async function shot(app: ElectronApplication, file: string): Promise<void> {
  const png = await app.evaluate(async ({ BrowserWindow }) => (await BrowserWindow.getAllWindows()[0]!.webContents.capturePage()).toPNG().toString('base64'));
  writeFileSync(file, Buffer.from(png, 'base64'));
  console.log(`[review:m2b] ${file}`);
}

function seed(userData: string): void {
  mkdirSync(userData, { recursive: true });
  writeFileSync(join(userData, 'settings.json'), JSON.stringify({ formatVersion: 1, resources: { vanilla: { consent: true, enabled: true, dir: null }, packs: [] } }));
}

async function fakeScreens(): Promise<void> {
  const work = mkdtempSync(join(tmpdir(), 'allay-review-m2b-'));
  try {
    // 没有素材：引导状态
    {
      const { app } = await launch(join(work, 'empty'), { ALLAY_E2E_GAME_APPDATA: join(work, 'no-game') });
      await shot(app, join(REVIEW, 'm2b-onboarding.png'));
      await app.close();
    }
    // 假原版层（纯色色块）+ 一个假资源包
    const appData = join(work, 'appdata');
    const paths = requiredTextures().map((r) => ({ id: r.id, path: r.anyOf[0]! }));
    makeCatalogGame(join(appData, '.minecraft'), '9.9.9', '2030-01-01T00:00:00+00:00', catalogJarEntries(paths, { 'minecraft:block/diamond_block': '#3fbfa0' }));
    const userData = join(work, 'fake');
    seed(userData);
    const { app, page } = await launch(userData, { ALLAY_E2E_GAME_APPDATA: appData });
    await shot(app, join(REVIEW, 'm2b-fake-vanilla.png'));
    const pack = join(work, 'Test Pack.zip');
    writeZip(pack, [{ name: 'pack.mcmeta', data: packMcmeta('纯色测试资源包 / solid-colour test pack') }, { name: 'pack.png', data: solidPng('#d0a020') }, { name: tex('diamond_block'), data: solidPng('#c04040') }]);
    await page.evaluate(() => {
      const input = document.createElement('input');
      input.type = 'file';
      input.id = '__drop';
      input.style.display = 'none';
      document.body.append(input);
    });
    await page.setInputFiles('#__drop', pack);
    await page.evaluate(async () => {
      const f = (document.getElementById('__drop') as HTMLInputElement).files![0]!;
      await window.allay.resources.addDroppedPack(f);
    });
    await page.waitForTimeout(1500);
    await page.getByTestId('resources-button').click();
    await page.waitForTimeout(500);
    await shot(app, join(REVIEW, 'm2b-resource-stack.png'));
    await app.close();
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

async function realSmoke(): Promise<void> {
  mkdirSync(OUT, { recursive: true });
  const userData = mkdtempSync(join(tmpdir(), 'allay-smoke-m2b-'));
  try {
    seed(userData);
    // 不设 ALLAY_E2E_GAME_APPDATA：用这台机器上真装的游戏（只读）
    const { app, page } = await launch(userData, {});
    // 原版层在后台探测、打开：等它进了资源栈、预览按新的资源栈重新装载完
    await page.waitForFunction(() => window.__allayTest!.resourceState()?.detecting === false, undefined, { timeout: 60_000 });
    await page.waitForFunction(() => window.__allayTest!.status().kind === 'ready', undefined, { timeout: 30_000 });
    await page.waitForTimeout(1500);
    const state = await page.evaluate(() => window.__allayTest!.resourceState());
    console.log(`[review:m2b] 原版层：${JSON.stringify(state?.vanilla)}`);
    console.log(`[review:m2b] 预览状态：${JSON.stringify(await page.evaluate(() => window.__allayTest!.status()))}`);
    await shot(app, join(OUT, 'm2b-real-vanilla.png'));
    // 关掉原版层再截一张：开关原版层时预览会变
    await page.evaluate(() => window.allay.resources.setEnabled('vanilla', false));
    await page.waitForTimeout(2000);
    await shot(app, join(OUT, 'm2b-real-vanilla-off.png'));
    await app.close();
  } finally {
    rmSync(userData, { recursive: true, force: true });
  }
}

await (real ? realSmoke() : fakeScreens());
