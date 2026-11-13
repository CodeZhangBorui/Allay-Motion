// pnpm review:ui-redesign：界面重设计的改前改后评审图（docs/review/ui-redesign/README.md）。需要先 pnpm build。
// 窗口不显示，用 capturePage 截页面；资源栈里只有测试脚本生成的假原版层（纯色色块），不含任何 Mojang 素材。
//
//   --shots=<目录>   只截图，把每个场景的 PNG 写进这个目录（改前用旧代码跑一次，改后再跑一次）
//   --compose=<改前目录>,<改后目录>   把两组截图左右并排拼成 docs/review/ui-redesign/<场景>.png（左改前、右改后）
//   --design=<定稿图>,<截图>   把定稿图（按截图的高度放大）和实际界面左右并排，写成 docs/review/ui-redesign/design-vs-app.png
//   --only=<名字片段>   只处理名字含这个片段的场景
// 新界面独有的场景（菜单、预设页、输出页）在旧界面上用最接近的东西代替：工程菜单、预设下拉、输出规格弹层。
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { crc32, deflateSync, inflateSync } from 'node:zlib';
import { _electron as electron, type ElectronApplication, type Page } from '@playwright/test';
import { requiredTextures } from '../packages/assets/src/index';
import { decodePng } from '../packages/assets/src/png-decode';
import { catalogJarEntries, makeCatalogGame } from '../tests/unit/helpers/resource-fixtures';

const ROOT = resolve(import.meta.dirname, '..');
const DESKTOP = join(ROOT, 'apps/desktop');
const REVIEW = join(ROOT, 'docs/review/ui-redesign');
const arg = (name: string) => process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const only = arg('only') ?? '';

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

function seed(userData: string, ui: Record<string, unknown>): void {
  mkdirSync(userData, { recursive: true });
  writeFileSync(
    join(userData, 'settings.json'),
    JSON.stringify({
      formatVersion: 1,
      ui: { theme: 'dark', language: 'zh-CN', reducedMotion: 'off', layout: { left: { size: 280, collapsed: false }, right: { size: 320, collapsed: false } }, ...ui },
      resources: { vanilla: { consent: true, enabled: true, dir: null }, packs: [] },
    }),
  );
}

interface Scene {
  name: string;
  theme: 'dark' | 'light';
  language: 'zh-CN' | 'en';
  fakeGame?: boolean;
  size?: { width: number; height: number };
  act?(page: Page): Promise<void>;
}

const at = (p: Page) => p.evaluate(() => window.__allayTest!.setTime(0.55));

const SCENES: Scene[] = [
  { name: 'main-dark-zh', theme: 'dark', language: 'zh-CN', act: at },
  { name: 'main-dark-en', theme: 'dark', language: 'en', act: at },
  { name: 'main-light-zh', theme: 'light', language: 'zh-CN', act: at },
  { name: 'main-light-en', theme: 'light', language: 'en', act: at },
  {
    name: 'block-picker-dark-en',
    theme: 'dark',
    language: 'en',
    act: async (p) => {
      await p.getByTestId('param-blocks').getByRole('button').first().click();
      await p.waitForTimeout(1200);
    },
  },
  {
    name: 'easing-light-zh',
    theme: 'light',
    language: 'zh-CN',
    act: async (p) => {
      await p.evaluate(() => window.__allayTest!.setParams({ easing: [0.2, 1.4, 0.3, 1] }));
      await p.waitForTimeout(500);
    },
  },
  {
    name: 'palette-dark-zh',
    theme: 'dark',
    language: 'zh-CN',
    act: async (p) => {
      await p.keyboard.press('Control+KeyK');
      await p.waitForTimeout(400);
    },
  },
  {
    name: 'settings-light-en',
    theme: 'light',
    language: 'en',
    act: async (p) => {
      await p.keyboard.press('Control+Comma');
      await p.waitForTimeout(400);
    },
  },
  {
    name: 'resources-dark-zh',
    theme: 'dark',
    language: 'zh-CN',
    act: async (p) => {
      await p.getByTestId('resources-button').click();
      await p.waitForTimeout(400);
    },
  },
  {
    name: 'error-dark-en',
    theme: 'dark',
    language: 'en',
    act: async (p) => {
      await p.evaluate(() => window.__allayTest!.loadTemplate('export default { setup() { throw new Error("demo: setup failed on purpose"); }, update() {} };'));
      await p.waitForSelector('[data-testid="preview-error"]');
    },
  },
  { name: 'no-assets-light-zh', theme: 'light', language: 'zh-CN', fakeGame: false },
  {
    name: 'mine-empty-dark-zh',
    theme: 'dark',
    language: 'zh-CN',
    act: async (p) => {
      await p.getByTestId('gallery-tab-mine').click();
      await p.waitForTimeout(400);
    },
  },
  {
    name: 'loading-dark-en',
    theme: 'dark',
    language: 'en',
    act: async (p) => {
      await p.evaluate(() => window.__allayTest!.simulateLoading(true));
      await p.waitForTimeout(900);
    },
  },
  { name: 'min-size-light-en', theme: 'light', language: 'en', size: { width: 1120, height: 700 } },
  {
    name: 'export-dark-zh',
    theme: 'dark',
    language: 'zh-CN',
    act: async (p) => {
      await p.keyboard.press('Control+KeyE');
      await p.waitForTimeout(600);
    },
  },
  {
    name: 'menu-dark-zh',
    theme: 'dark',
    language: 'zh-CN',
    act: async (p) => {
      await p.getByTestId('project-menu').click();
      await p.waitForTimeout(400);
    },
  },
  {
    name: 'presets-dark-en',
    theme: 'dark',
    language: 'en',
    act: async (p) => {
      if (await p.getByTestId('left-tab-presets').count()) await p.getByTestId('left-tab-presets').click();
      else await p.getByTestId('preset-menu').click();
      await p.waitForTimeout(400);
    },
  },
  {
    name: 'output-light-zh',
    theme: 'light',
    language: 'zh-CN',
    act: async (p) => {
      if (await p.getByTestId('right-tab-output').count()) await p.getByTestId('right-tab-output').click();
      else await p.getByTestId('output-badge').click();
      await p.waitForTimeout(400);
    },
  },
  {
    name: 'export-light-en',
    theme: 'light',
    language: 'en',
    act: async (p) => {
      await p.keyboard.press('Control+KeyE');
      await p.waitForTimeout(600);
    },
  },
];

async function shoot(outDir: string): Promise<void> {
  mkdirSync(outDir, { recursive: true });
  const work = mkdtempSync(join(tmpdir(), 'allay-review-ui-'));
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
        const png = await app.evaluate(async ({ BrowserWindow }) => (await BrowserWindow.getAllWindows()[0]!.webContents.capturePage()).toPNG().toString('base64'));
        writeFileSync(join(outDir, `${scene.name}.png`), Buffer.from(png, 'base64'));
        console.log(`[review:ui-redesign] ${join(outDir, scene.name)}.png`);
      } finally {
        await app.close();
      }
    }
  } finally {
    rmSync(work, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 });
  }
}

// ---- 拼图：左改前、右改后；上方一条 8 px 的色条（左灰、右青）标明哪边是哪边 ----

interface Rgba {
  width: number;
  height: number;
  data: Uint8Array;
}

async function readPng(file: string): Promise<Rgba> {
  const img = await decodePng(new Uint8Array(readFileSync(file)), async (z) => new Uint8Array(inflateSync(z)));
  return { width: img.width, height: img.height, data: img.data };
}

function encodePng({ width, height, data }: Rgba): Buffer {
  const chunk = (type: string, body: Buffer) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(body.length);
    const tb = Buffer.concat([Buffer.from(type, 'ascii'), body]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(tb));
    return Buffer.concat([len, tb, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) Buffer.from(data.buffer, data.byteOffset + y * width * 4, width * 4).copy(raw, y * (width * 4 + 1) + 1);
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}

async function compose(beforeDir: string, afterDir: string): Promise<void> {
  mkdirSync(REVIEW, { recursive: true });
  const GAP = 16;
  const BAR = 8;
  for (const scene of SCENES.filter((s) => s.name.includes(only))) {
    const a = await readPng(join(beforeDir, `${scene.name}.png`));
    const b = await readPng(join(afterDir, `${scene.name}.png`));
    const width = a.width + GAP + b.width;
    const height = BAR + Math.max(a.height, b.height);
    const out = new Uint8Array(width * height * 4);
    for (let i = 0; i < out.length; i += 4) out.set([24, 24, 24, 255], i);
    const fill = (x0: number, w: number, rgb: [number, number, number]) => {
      for (let y = 0; y < BAR; y++) for (let x = x0; x < x0 + w; x++) out.set([...rgb, 255], (y * width + x) * 4);
    };
    fill(0, a.width, [128, 128, 128]);
    fill(a.width + GAP, b.width, [67, 211, 234]);
    const blit = (img: Rgba, x0: number) => {
      for (let y = 0; y < img.height; y++) out.set(img.data.subarray(y * img.width * 4, (y + 1) * img.width * 4), ((y + BAR) * width + x0) * 4);
    };
    blit(a, 0);
    blit(b, a.width + GAP);
    const file = join(REVIEW, `${scene.name}.png`);
    writeFileSync(file, encodePng({ width, height, data: out }));
    console.log(`[review:ui-redesign] ${file}`);
  }
}

/** 定稿图与实际界面并排：定稿图按最近邻放大到截图的高度 */
async function designVsApp(designFile: string, appFile: string): Promise<void> {
  const d = await readPng(designFile);
  const a = await readPng(appFile);
  const k = a.height / d.height;
  const dw = Math.round(d.width * k);
  const scaled = new Uint8Array(dw * a.height * 4);
  for (let y = 0; y < a.height; y++) {
    const sy = Math.min(d.height - 1, Math.floor(y / k));
    for (let x = 0; x < dw; x++) {
      const sx = Math.min(d.width - 1, Math.floor(x / k));
      scaled.set(d.data.subarray((sy * d.width + sx) * 4, (sy * d.width + sx) * 4 + 4), (y * dw + x) * 4);
    }
  }
  const GAP = 16;
  const BAR = 8;
  const width = dw + GAP + a.width;
  const height = BAR + a.height;
  const out = new Uint8Array(width * height * 4);
  for (let i = 0; i < out.length; i += 4) out.set([24, 24, 24, 255], i);
  for (let y = 0; y < BAR; y++) {
    for (let x = 0; x < dw; x++) out.set([242, 169, 59, 255], (y * width + x) * 4);
    for (let x = dw + GAP; x < width; x++) out.set([67, 211, 234, 255], (y * width + x) * 4);
  }
  for (let y = 0; y < a.height; y++) {
    out.set(scaled.subarray(y * dw * 4, (y + 1) * dw * 4), ((y + BAR) * width) * 4);
    out.set(a.data.subarray(y * a.width * 4, (y + 1) * a.width * 4), ((y + BAR) * width + dw + GAP) * 4);
  }
  mkdirSync(REVIEW, { recursive: true });
  const file = join(REVIEW, 'design-vs-app.png');
  writeFileSync(file, encodePng({ width, height, data: out }));
  console.log(`[review:ui-redesign] ${file}`);
}

const shots = arg('shots');
const comp = arg('compose');
const design = arg('design');
if (shots) await shoot(resolve(shots));
else if (design) {
  const [d, a] = design.split(',');
  await designVsApp(resolve(d!), resolve(a!));
}
else if (comp) {
  const [before, after] = comp.split(',');
  await compose(resolve(before!), resolve(after!));
} else {
  console.error('用法：--shots=<目录>、--compose=<改前目录>,<改后目录> 或 --design=<定稿图>,<截图>');
  process.exit(1);
}
