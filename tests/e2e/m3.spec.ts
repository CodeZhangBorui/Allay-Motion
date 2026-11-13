import { mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { writeZip } from '../../apps/desktop/src/main/templates/zip-writer';
import { solidPng } from '../unit/helpers/resource-fixtures';
import { launchApp, makeUserDataDir, removeUserDataDir, type Launched } from './helpers';

// M3 模板系统的端到端测试：内置模板从 resources/templates/ 装载；安装（含试运行）、派生模板的自带图片、
// 预设的保存与套用都走真实的界面路径和 IPC。窗口不显示、不抢焦点。模板包和图片都在测试时生成（纯色色块）。

type Entries = Record<string, Uint8Array | string>;

/** 用模板的 texture 参数画一张铺满舞台的图 */
const SPRITE_CODE = `export default {
  async setup(ctx) {
    if (ctx.params.logo) {
      const s = ctx.sprite.create(await ctx.resources.texture(ctx.params.logo), { pixelSize: 1 });
      s.setSize(ctx.stage.width, ctx.stage.height);
      ctx.scene.add(s.object);
    }
    return { duration: 1, cutTime: null, update() {} };
  },
};`;

const BASE: Entries = {
  'manifest.json': JSON.stringify({
    formatVersion: 1,
    id: 'user.e2e.sprite',
    version: '1.0.0',
    name: 'Sprite',
    category: 'overlay',
    params: [
      { key: 'logo', type: 'texture', label: 'Logo', default: '' },
      { key: 'size', type: 'number', label: 'Size', default: 1, min: 0, max: 10 },
    ],
  }),
  'template.js': SPRITE_CODE,
};

const DERIVED: Entries = {
  'manifest.json': JSON.stringify({
    formatVersion: 1,
    id: 'user.e2e.logo',
    version: '1.0.0',
    name: 'Logo',
    category: 'overlay',
    extends: { id: 'user.e2e.sprite', version: '^1.0.0' },
    overrides: { defaults: { logo: 'asset:logo.png', size: 99 }, hidden: ['size'] },
  }),
  'assets/logo.png': solidPng('#ff0000'),
};

let launched: Launched;
let dir: string;

function pkg(name: string, entries: Entries): string {
  const file = join(dir, 'packages', name);
  mkdirSync(join(dir, 'packages'), { recursive: true });
  writeFileSync(file, writeZip(Object.entries(entries).map(([path, data]) => ({ path, data: typeof data === 'string' ? Buffer.from(data) : data }))));
  return file;
}

/** 用真实的文件输入框拿到带本机路径的 File，交给测试钩子的 installFile（与拖放同一条路） */
async function install(page: Page, file: string) {
  await page.evaluate(() => {
    if (document.getElementById('__e2e_tpl')) return;
    const input = document.createElement('input');
    input.type = 'file';
    input.id = '__e2e_tpl';
    input.style.display = 'none';
    document.body.append(input);
  });
  await page.setInputFiles('#__e2e_tpl', file);
  return page.evaluate(() => window.__allayTest!.installFile((document.getElementById('__e2e_tpl') as HTMLInputElement).files![0]!));
}

/** 预览装载了当前工程的最新一版并就绪（不只是“状态是就绪”：改参数之后，旧的就绪状态还会留一会儿） */
async function ready(page: Page) {
  await expect.poll(() => page.evaluate(() => window.__allayTest!.previewUpToDate()), { timeout: 20_000 }).toBe(true);
}

test.describe.configure({ mode: 'serial' });

test.beforeAll(async () => {
  dir = makeUserDataDir();
  launched = await launchApp(dir);
});
test.afterAll(async () => {
  await launched?.app.close();
  removeUserDataDir(dir);
});

test('启动时从 resources/templates/ 装载内置的 T1，参数是默认值', async () => {
  const { page } = launched;
  await ready(page);
  const list = await page.evaluate(() => window.__allayTest!.templates());
  expect(list.find((e) => e.id === 'allay.builtin.block-wipe')).toMatchObject({ source: 'builtin', version: '1.0.0', kind: 'script' });
  const p = await page.evaluate(() => window.__allayTest!.project());
  expect(p.ref).toEqual({ id: 'allay.builtin.block-wipe', version: '1.0.0' });
  expect(p.params).toMatchObject({ cols: 12, style: '3d', inPattern: 'centerOut', outPattern: 'reverse', inDuration: 0.5, hold: 0.1, outDuration: 0.5, easing: 'backOut', spin: 'flipY', seed: 1 });
  expect(Object.keys(p.params)).toHaveLength(16);
  await expect(page.getByTestId('template-allay.builtin.block-wipe')).toHaveAttribute('aria-pressed', 'true');
});

test('改参数（经测试钩子）：时长和剪辑点跟着变，越界的钳制，预览重新装载', async () => {
  const { page } = launched;
  await page.evaluate(() => window.__allayTest!.setParams({ inDuration: 1, hold: 0.4, outDuration: 0.6, cols: 99, bogus: 1 }));
  await ready(page);
  const p = await page.evaluate(() => window.__allayTest!.project());
  expect(p.params.cols).toBe(40);
  expect(p.params).not.toHaveProperty('bogus');
  const tr = await page.evaluate(() => window.__allayTest!.transport());
  expect(tr.duration).toBeCloseTo(2, 6);
  expect(tr.cutTime).toBeCloseTo(1.2, 6);
  expect((await page.evaluate(() => window.__allayTest!.previewStats(0))).maxAlpha).toBe(0);
  expect((await page.evaluate(() => window.__allayTest!.previewStats(1.2))).minAlpha).toBe(255);
});

test('T-TPL-8 预设：保存后再加载，参数一致；只存与默认值不同的参数', async () => {
  const { page } = launched;
  const before = (await page.evaluate(() => window.__allayTest!.project())).params;
  const saved = await page.evaluate(() => window.__allayTest!.savePreset('e2e 预设'));
  expect(saved).not.toBeNull();
  expect(Object.keys(saved!.params).sort()).toEqual(['cols', 'hold', 'inDuration', 'outDuration']);
  expect(readdirSync(join(dir, 'presets')).filter((f) => f.endsWith('.allaypreset'))).toHaveLength(1);
  // 换回默认参数，再套用预设
  await page.evaluate(() => window.__allayTest!.loadBuiltin());
  await ready(page);
  expect((await page.evaluate(() => window.__allayTest!.project())).params.cols).toBe(12);
  expect(await page.evaluate((id) => window.__allayTest!.applyPreset(id), saved!.id)).toBe(true);
  await ready(page);
  expect((await page.evaluate(() => window.__allayTest!.project())).params).toEqual(before);
  expect((await page.evaluate(() => window.__allayTest!.transport())).duration).toBeCloseTo(2, 6);
});

test('T-TPL-6 安装校验（界面路径）：带 import、冒用 allay. 前缀被拒绝，列表不变', async () => {
  const { page } = launched;
  const count = (await page.evaluate(() => window.__allayTest!.templates())).length;
  const withImport = await install(page, pkg('import.allaytpl', { ...BASE, 'template.js': `import x from 'three';\n${SPRITE_CODE}` }));
  expect(withImport).toMatchObject({ kind: 'rejected', code: 'code-has-import' });
  const reserved = await install(page, pkg('reserved.allaytpl', { ...BASE, 'manifest.json': BASE['manifest.json']!.toString().replace('user.e2e.sprite', 'allay.e2e.sprite') }));
  expect(reserved).toMatchObject({ kind: 'rejected', code: 'reserved-id' });
  const missingBase = await install(page, pkg('orphan.allaytpl', DERIVED));
  expect(missingBase).toMatchObject({ kind: 'rejected', code: 'base-missing' });
  expect(await page.evaluate(() => window.__allayTest!.templates())).toHaveLength(count);
  // 拒绝的原因显示在提示里（两种语言都有文案，这里只看有提示）
  await expect(page.getByTestId('notice')).toBeVisible();
});

test('试运行（4.8 第 4 步）：setup 卡死的模板被看门狗拒绝；update 依赖调用顺序的模板装上但标注“预览与导出可能不一致”', async () => {
  const { page } = launched;
  await page.evaluate(() => window.__allayTest!.setTrialTimeouts({ load: 2000, exportFrame: 2000 }));
  const hang = await install(page, pkg('hang.allaytpl', { ...BASE, 'manifest.json': BASE['manifest.json']!.toString().replace('user.e2e.sprite', 'user.e2e.hang'), 'template.js': 'export default { setup() { for (;;) {} } };' }));
  expect(hang).toMatchObject({ kind: 'rejected', code: 'trial-failed' });
  expect(hang.detail).toMatch(/EngineUnresponsiveError/);
  // 每次 update 都让一个计数加一，画面跟着计数走：同一帧渲染两次结果不同
  const stateful = `export default {
    async setup(ctx) {
      const m = new ctx.THREE.Mesh(new ctx.THREE.PlaneGeometry(200, 200), new ctx.THREE.MeshBasicMaterial({ color: 0xffffff }));
      ctx.scene.add(m);
      let n = 0;
      return { duration: 1, cutTime: 0.5, update(t) { n++; m.position.x = (n % 7) * 50; m.visible = t > 0.2 && t < 0.8; } };
    },
  };`;
  const nd = await install(page, pkg('nd.allaytpl', { ...BASE, 'manifest.json': BASE['manifest.json']!.toString().replace('user.e2e.sprite', 'user.e2e.nd').replace('"overlay"', '"transition"'), 'template.js': stateful }));
  expect(nd.kind).toBe('installed');
  expect(nd.warnings).toEqual(expect.arrayContaining(['nondeterministic', 'cut-not-opaque']));
  const entry = (await page.evaluate(() => window.__allayTest!.templates())).find((e) => e.id === 'user.e2e.nd');
  expect(entry?.trialWarnings).toEqual(expect.arrayContaining(['nondeterministic']));
  await expect(page.getByTestId('template-user.e2e.nd')).toContainText(/可能不一致|may differ/);
});

test('T-TPL-7 派生模板：覆盖默认值、隐藏参数、引用自带图片（预览里画的是包里的图）', async () => {
  const { page } = launched;
  const base = await install(page, pkg('base.allaytpl', BASE));
  expect(base).toMatchObject({ kind: 'installed', warnings: [] });
  const derived = await install(page, pkg('derived.allaytpl', DERIVED));
  // 自带的图铺满整个画面：首末帧不透明是这个测试模板自己的问题，只是警告
  expect(derived.kind).toBe('installed');
  expect(derived.warnings).toEqual(['first-frame-visible', 'last-frame-visible']);
  expect(derived.loadWarnings).toEqual([]);
  // 装上后自动选中
  await ready(page);
  const p = await page.evaluate(() => window.__allayTest!.project());
  expect(p.ref).toEqual({ id: 'user.e2e.logo', version: '1.0.0' });
  expect(p.hidden).toEqual(['size']);
  expect(p.paramDefaults).toEqual({ logo: 'asset:logo.png', size: 10 });
  expect(p.params).toEqual({ logo: 'asset:logo.png', size: 10 });
  expect(await page.evaluate(() => window.__allayTest!.previewPixel(0.5, 0.5, 0.5))).toEqual([255, 0, 0, 255]);
  // 基模板自己没有图：同一个位置是透明的
  expect(await page.evaluate(() => window.__allayTest!.selectTemplate('user.e2e.sprite', '1.0.0'))).toBe(true);
  await ready(page);
  expect((await page.evaluate(() => window.__allayTest!.previewPixel(0.5, 0.5, 0.5)))[3]).toBe(0);
  // 删除基模板：派生模板保留，标记为基模板缺失，不能选；当前模板换回 T1
  expect(await page.evaluate(() => window.__allayTest!.removeTemplate('user.e2e.sprite', '1.0.0'))).toBe(true);
  await ready(page);
  const list = await page.evaluate(() => window.__allayTest!.templates());
  expect(list.find((e) => e.id === 'user.e2e.logo')).toMatchObject({ baseMissing: true });
  expect((await page.evaluate(() => window.__allayTest!.project())).ref?.id).toBe('allay.builtin.block-wipe');
  await expect(page.getByTestId('template-user.e2e.logo')).toBeDisabled();
});
