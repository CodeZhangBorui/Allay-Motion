// pnpm review:m5b：M5 后半的评审录屏（docs/review/M5b/README.md）。需要先 pnpm build，以及本机 pnpm mascot:bake 的真实产物。
//
// 用真实烘焙的悦灵（原版贴图的派生图像）录四段编排的 APNG：A 骨架屏上的飞舞、B 导出进度、C 启动画面、D 拖放接收。
// 资源栈里只有测试数据生成的假原版层（纯色色块），模板画面里没有 Mojang 素材；但悦灵本身来自原版贴图，
// 所以产物只写进被 git 忽略的 docs/review/M5b/out/，不提交。窗口不显示，用 capturePage 截页面。
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { _electron as electron, type ElectronApplication, type Page } from '@playwright/test';
import { requiredTextures } from '../packages/assets/src/index';
import { catalogJarEntries, makeCatalogGame } from '../tests/unit/helpers/resource-fixtures';
import { decodePng, encodeApng, type Rgba } from './mascot-bake/png';

const ROOT = resolve(import.meta.dirname, '..');
const DESKTOP = join(ROOT, 'apps/desktop');
const OUT = join(ROOT, 'docs/review/M5b/out');
const GENERATED = join(ROOT, 'packages/mascot/generated');
const FPS = 15;
const reduced = process.argv.includes('--reduced');

interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

async function launch(dir: string, extra: Record<string, string> = {}): Promise<{ app: ElectronApplication; page: Page }> {
  const appData = join(dir, 'appdata');
  const paths = requiredTextures().map((r) => ({ id: r.id, path: r.anyOf[0]! }));
  makeCatalogGame(join(appData, '.minecraft'), '9.9.9', '2030-01-01T00:00:00+00:00', catalogJarEntries(paths, {}));
  writeFileSync(
    join(dir, 'settings.json'),
    JSON.stringify({
      formatVersion: 1,
      ui: { theme: 'dark', language: 'zh-CN', reducedMotion: reduced ? 'on' : 'off', layout: { left: { size: 280, collapsed: false }, right: { size: 320, collapsed: false } } },
      resources: { vanilla: { consent: true, enabled: true, dir: null }, packs: [] },
    }),
  );
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) if (v !== undefined && k !== 'ELECTRON_RUN_AS_NODE' && k !== 'NODE_OPTIONS') env[k] = v;
  Object.assign(env, { ALLAY_USER_DATA_DIR: dir, ALLAY_E2E_HIDDEN: '1', ALLAY_E2E_HOOKS: '1', ALLAY_E2E_MOJANG_ORIGIN: 'http://127.0.0.1:9', ALLAY_E2E_GAME_APPDATA: appData, ALLAY_E2E_MASCOT_DIR: GENERATED, ...extra });
  const electronPath = createRequire(join(DESKTOP, 'package.json'))('electron') as string;
  const app = await electron.launch({ executablePath: electronPath, args: [DESKTOP], env, cwd: DESKTOP });
  const page = await app.firstWindow();
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setContentSize(1440, 900));
  await page.waitForFunction(() => window.__allayTest?.previewUpToDate() === true, undefined, { timeout: 30_000 });
  await page.waitForFunction(() => window.__allayTest?.resourceState()?.detecting === false, undefined, { timeout: 30_000 });
  await page.waitForTimeout(3000);
  await page.waitForFunction(() => window.__allayTest?.previewUpToDate() === true, undefined, { timeout: 30_000 });
  return { app, page };
}

/** 按 FPS 截 ms 毫秒（rect 为 null 时整窗缩到一半），写成 APNG */
async function record(app: ElectronApplication, name: string, ms: number, rect: Rect | null, urlPart = 'index.html', during?: () => Promise<void>): Promise<void> {
  const frames: Rgba[] = [];
  const t0 = Date.now();
  const task = during?.();
  while (Date.now() - t0 < ms) {
    const next = t0 + frames.length * (1000 / FPS);
    const wait = next - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    const b64 = await app.evaluate(
      async ({ BrowserWindow }, a) => {
        const w = BrowserWindow.getAllWindows().find((x) => x.webContents.getURL().includes(a.urlPart));
        if (!w) return '';
        let img = a.rect ? await w.webContents.capturePage(a.rect) : await w.webContents.capturePage();
        if (!a.rect) img = img.resize({ width: Math.round(img.getSize().width / 2) });
        return img.toPNG().toString('base64');
      },
      { rect, urlPart },
    );
    if (b64) frames.push(decodePng(Buffer.from(b64, 'base64')));
  }
  await task;
  // 尺寸不一的帧（截到窗口变化时）丢掉
  const w = frames[0]?.width;
  const h = frames[0]?.height;
  const same = frames.filter((f) => f.width === w && f.height === h);
  const file = join(OUT, `${name}${reduced ? '-reduced' : ''}.apng`);
  writeFileSync(file, encodeApng(same, FPS));
  console.log(`[review:m5b] ${file}（${same.length} 帧）`);
}

async function rectOf(page: Page, testId: string, pad = 0): Promise<Rect> {
  const b = (await page.getByTestId(testId).boundingBox())!;
  return { x: Math.max(0, Math.floor(b.x - pad)), y: Math.max(0, Math.floor(b.y - pad)), width: Math.ceil(b.width + pad * 2), height: Math.ceil(b.height + pad * 2) };
}

async function main(): Promise<void> {
  if (!existsSync(join(GENERATED, 'allay.atlas.json'))) throw new Error('没有烘焙产物：先运行 pnpm mascot:bake。');
  mkdirSync(OUT, { recursive: true });
  const dir = mkdtempSync(join(tmpdir(), 'allay-review-m5b-'));
  const out = join(dir, 'exports');
  mkdirSync(out);
  const { app, page } = await launch(dir, { ALLAY_E2E_EXPORT_TARGET: out, ALLAY_FFMPEG: join(ROOT, 'resources/ffmpeg/win32-x64/ffmpeg.exe') });
  try {
    // A：预览视口的骨架屏飞舞（3 秒加载，然后退场）
    const preview = await rectOf(page, 'preview-loading-layer');
    await record(app, 'A-skeleton-flight', 4200, preview, 'index.html', async () => {
      await page.evaluate(() => window.__allayTest!.simulateLoading(true));
      await new Promise((r) => setTimeout(r, 3200));
      await page.evaluate(() => window.__allayTest!.simulateLoading(false));
    });

    // B：导出（渲染、封装、完成后的舞蹈）。导出很快，用测试钩子在若干帧上停一下，进度看得清
    await page.getByTestId('topbar-export').click();
    await page.getByTestId('export-dialog').waitFor();
    const dialog = await rectOf(page, 'export-dialog', 8);
    await record(app, 'B-export', 7500, { ...dialog, y: Math.max(0, dialog.y - 40), height: dialog.height + 80 }, 'index.html', async () => {
      await page.evaluate(() => window.__allayTest!.pauseExportAfter(10));
      await page.getByTestId('export-start').click();
      for (const n of [25, 40, 55]) {
        await page.waitForFunction(() => window.__allayTest!.exportPausedAt() !== null, undefined, { timeout: 30_000 });
        await new Promise((r) => setTimeout(r, 500));
        await page.evaluate((x) => {
          window.__allayTest!.pauseExportAfter(x);
          window.__allayTest!.resumeExport();
        }, n);
      }
      await page.waitForFunction(() => window.__allayTest!.exportPausedAt() !== null, undefined, { timeout: 30_000 });
      await page.evaluate(() => {
        window.__allayTest!.pauseExportAfter(null);
        window.__allayTest!.resumeExport();
      });
    });
    await page.getByTestId('export-close').click();

    // D：拖放接收（拖进来停 1 秒，放下 zip，送到素材按钮）
    await record(app, 'D-drop', 2600, null, 'index.html', async () => {
      await page.evaluate(async () => {
        const dt = new DataTransfer();
        dt.items.add(new File(['x'], 'pack.zip'));
        window.dispatchEvent(new DragEvent('dragenter', { dataTransfer: dt, bubbles: true, cancelable: true }));
        await new Promise((r) => setTimeout(r, 1000));
        window.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }));
      });
    });

    // C：启动画面。真实启动时它只停到主窗口就绪；这里在同一应用里另开一个同样设置的窗口加载同一页面，录 3 秒
    await app.evaluate(async ({ BrowserWindow }, frag) => {
      const w = new BrowserWindow({ width: 420, height: 260, useContentSize: true, frame: false, transparent: true, backgroundColor: '#00000000', show: false, skipTaskbar: true, webPreferences: { contextIsolation: true, sandbox: true, nodeIntegration: false } });
      await w.loadURL(`app://renderer/splash/zh-CN-dark.html${frag}`);
    }, reduced ? '#s' : '');
    await record(app, 'C-splash', 3000, { x: 0, y: 0, width: 420, height: 260 }, '/splash/');
  } finally {
    await app.close();
    rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  }
}

await main();
