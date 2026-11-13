// pnpm review:md-b：MD-b 的评审截图（docs/review/MD-b/README.md）。需要先 pnpm build。窗口不显示，用 capturePage 截页面。
// 画面全是假数据：复制一个内置模板，再把它换成一块纯色的测试模板；没有原版素材（资源栈里没有原版层）。
// 1. md-b-watch-zh.png：状态栏的监视提示（上一次重载成功）。
// 2. md-b-overlay-zh.png / md-b-overlay-en.png：语法错误、update 抛错时的错误浮层，预览保留上一帧。
// 3. md-b-still.png：统一的静帧接口（H4）渲染的一帧（最长边 640）。
import { mkdirSync, mkdtempSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { _electron as electron, type ElectronApplication, type Page } from '@playwright/test';

const ROOT = resolve(import.meta.dirname, '..');
const DESKTOP = join(ROOT, 'apps/desktop');
const OUT = join(ROOT, 'docs/review/MD-b');

const SOLID = (color: string) => `export default {
  setup(ctx) {
    const { THREE, scene, stage } = ctx;
    const quad = new THREE.Mesh(new THREE.PlaneGeometry(stage.width * 0.6, stage.height * 0.6), new THREE.MeshBasicMaterial({ color: '${color}' }));
    scene.add(quad);
    return { duration: 2, cutTime: 1, update(t) { quad.rotation.z = t * 0.5; } };
  },
};
`;
const SYNTAX = `export default {
  setup() {
    return {
      duration: 1,
      update(t) { void t); },
    };
  },
};
`;
const UPDATE_THROWS = `export default {
  setup() {
    const state = { box: null };
    return {
      duration: 2,
      update(t) {
        return state.box.width * t;
      },
    };
  },
};
`;

function save(path: string, text: string): void {
  writeFileSync(`${path}.tmp`, text);
  renameSync(`${path}.tmp`, path);
}

async function shot(app: ElectronApplication, file: string): Promise<void> {
  const png = await app.evaluate(async ({ BrowserWindow }) => (await BrowserWindow.getAllWindows()[0]!.webContents.capturePage()).toPNG().toString('base64'));
  writeFileSync(join(OUT, file), Buffer.from(png, 'base64'));
  console.log(`[review:md-b] ${file}`);
}

async function waitReload(page: Page, before: number): Promise<void> {
  await page.waitForFunction((n) => window.__allayTest!.devState().reloads > n && window.__allayTest!.devState().phase === 'idle', before, { timeout: 15_000 });
  await page.waitForTimeout(400);
}

async function session(language: 'zh-CN' | 'en', run: (app: ElectronApplication, page: Page, folder: string) => Promise<void>): Promise<void> {
  const userData = mkdtempSync(join(tmpdir(), 'allay-review-'));
  writeFileSync(join(userData, 'settings.json'), JSON.stringify({ formatVersion: 1, ui: { language, theme: 'dark' } }));
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) if (v !== undefined && k !== 'ELECTRON_RUN_AS_NODE' && k !== 'NODE_OPTIONS') env[k] = v;
  Object.assign(env, { ALLAY_USER_DATA_DIR: userData, ALLAY_E2E_HIDDEN: '1', ALLAY_E2E_HOOKS: '1', ALLAY_E2E_MOJANG_ORIGIN: 'http://127.0.0.1:9', ALLAY_E2E_GAME_APPDATA: join(userData, 'no-game') });
  const electronPath = createRequire(join(DESKTOP, 'package.json'))('electron') as string;
  const app = await electron.launch({ executablePath: electronPath, args: [DESKTOP], env, cwd: DESKTOP });
  try {
    const page = await app.firstWindow();
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.waitForFunction(() => window.__allayTest?.previewUpToDate() === true, undefined, { timeout: 30_000 });
    await page.evaluate(() => window.__allayTest!.dispatch('copyBuiltinTemplate'));
    await page.waitForFunction(() => window.__allayTest!.project().ref?.id.startsWith('user.') === true && window.__allayTest!.previewUpToDate(), undefined, { timeout: 30_000 });
    const ref = await page.evaluate(() => window.__allayTest!.project().ref!);
    const folder = join(userData, 'templates', ref.id, ref.version);
    const before = (await page.evaluate(() => window.__allayTest!.devState())).reloads;
    save(join(folder, 'manifest.json'), JSON.stringify({ formatVersion: 1, id: ref.id, version: ref.version, name: { 'zh-CN': '纯色测试', en: 'Solid test' }, category: 'transition', params: [{ key: 'size', type: 'number', label: { 'zh-CN': '大小', en: 'Size' }, default: 1, min: 0.1, max: 1 }] }));
    save(join(folder, 'template.js'), SOLID('#3B82C4'));
    await waitReload(page, before);
    await page.waitForFunction(() => window.__allayTest!.previewUpToDate(), undefined, { timeout: 15_000 });
    await page.evaluate(() => window.__allayTest!.setTime(0.8));
    await page.waitForTimeout(500);
    await run(app, page, folder);
  } finally {
    await app.close();
    rmSync(userData, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 });
  }
}

async function main(): Promise<void> {
  mkdirSync(OUT, { recursive: true });
  await session('zh-CN', async (app, page, folder) => {
    await shot(app, 'md-b-watch-zh.png');
    const n = (await page.evaluate(() => window.__allayTest!.devState())).reloads;
    save(join(folder, 'template.js'), SYNTAX);
    await waitReload(page, n);
    await shot(app, 'md-b-overlay-zh.png');
    const still = await page.evaluate(() => window.__allayTest!.renderStill(0.8, 640));
    writeFileSync(join(OUT, 'md-b-still.png'), Buffer.from(still.pngBase64, 'base64'));
    console.log(`[review:md-b] md-b-still.png ${still.width}×${still.height}`);
  });
  await session('en', async (app, page, folder) => {
    const n = (await page.evaluate(() => window.__allayTest!.devState())).reloads;
    save(join(folder, 'template.js'), UPDATE_THROWS);
    await waitReload(page, n);
    await shot(app, 'md-b-overlay-en.png');
  });
}

await main();
