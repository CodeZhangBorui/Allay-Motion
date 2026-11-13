// pnpm review:m3：M3 的评审截图（docs/review/M3/README.md）。需要先 pnpm build。窗口不显示，用 capturePage 截页面。
//
// 1. 提交进仓库的截图：资源栈里只有测试脚本生成的假原版层（纯色色块），截 T1 默认参数的进入阶段、剪辑点，
//    以及改过参数（平面样式、对角线、多种方块）的一帧。这些画面里没有任何 Mojang 素材。
// 2. 加 --real：手动冒烟。用这台机器上真装的游戏作原版层截同样的画面，写到 docs/review/M3/out/（被 .gitignore 忽略）。
//    **含原版贴图的截图不提交。**不会联网。
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { _electron as electron, type ElectronApplication, type Page } from '@playwright/test';
import { requiredTextures } from '../packages/assets/src/index';
import { catalogJarEntries, makeCatalogGame } from '../tests/unit/helpers/resource-fixtures';

const ROOT = resolve(import.meta.dirname, '..');
const DESKTOP = join(ROOT, 'apps/desktop');
const REVIEW = join(ROOT, 'docs/review/M3');
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
  await settle(page);
  return { app, page };
}

/** 等预览装载了当前工程，再等原版层探测完、重新装载 */
async function settle(page: Page): Promise<void> {
  await page.waitForFunction(() => window.__allayTest?.previewUpToDate() === true, undefined, { timeout: 30_000 });
  await page.waitForTimeout(1500);
  await page.waitForFunction(() => window.__allayTest?.previewUpToDate() === true, undefined, { timeout: 30_000 });
}

async function shotAt(app: ElectronApplication, page: Page, t: number, file: string): Promise<void> {
  await page.evaluate((x) => window.__allayTest!.setTime(x), t);
  await page.waitForTimeout(800);
  const png = await app.evaluate(async ({ BrowserWindow }) => (await BrowserWindow.getAllWindows()[0]!.webContents.capturePage()).toPNG().toString('base64'));
  writeFileSync(file, Buffer.from(png, 'base64'));
  console.log(`[review:m3] ${file}`);
}

function seed(userData: string): void {
  mkdirSync(userData, { recursive: true });
  writeFileSync(join(userData, 'settings.json'), JSON.stringify({ formatVersion: 1, resources: { vanilla: { consent: true, enabled: true, dir: null }, packs: [] } }));
}

async function screens(dir: string, extra: Record<string, string>, userData: string): Promise<void> {
  mkdirSync(dir, { recursive: true });
  const { app, page } = await launch(userData, extra);
  try {
    await shotAt(app, page, 0.3, join(dir, 'm3-t1-in.png'));
    await shotAt(app, page, 0.55, join(dir, 'm3-t1-cut.png'));
    await page.evaluate(() =>
      window.__allayTest!.setParams({
        style: 'flat',
        inPattern: 'diagonal',
        cols: 16,
        blocks: [
          { id: 'minecraft:diamond_block', weight: 2 },
          { id: 'minecraft:gold_block', weight: 1 },
          { id: 'minecraft:emerald_block', weight: 1 },
        ],
      }),
    );
    await settle(page);
    await shotAt(app, page, 0.35, join(dir, 'm3-t1-flat-diagonal.png'));
  } finally {
    await app.close();
  }
}

const work = mkdtempSync(join(tmpdir(), 'allay-review-m3-'));
try {
  // 假原版层：目录里每张贴图一个纯色色块（测试数据，不是产品素材）
  const appData = join(work, 'appdata');
  const paths = requiredTextures().map((r) => ({ id: r.id, path: r.anyOf[0]! }));
  makeCatalogGame(join(appData, '.minecraft'), '9.9.9', '2030-01-01T00:00:00+00:00', catalogJarEntries(paths, { 'minecraft:block/diamond_block': '#3fbfa0' }));
  const fake = join(work, 'fake');
  seed(fake);
  await screens(REVIEW, { ALLAY_E2E_GAME_APPDATA: appData }, fake);
  if (real) {
    // 本机真装的游戏（只读，不联网）。含原版贴图，只写进被忽略的 out/
    const realData = join(work, 'real');
    seed(realData);
    await screens(OUT, {}, realData);
  }
} finally {
  rmSync(work, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 });
}
