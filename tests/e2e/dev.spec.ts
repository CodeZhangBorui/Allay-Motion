import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { launchApp, makeUserDataDir, readFixture, removeUserDataDir, type Launched } from './helpers';

// 模板开发模式（docs/08-milestones.md MD）的端到端测试：从菜单“复制当前内置模板来修改”得到一个用户模板，
// 测试进程像外部编辑器一样直接改它文件夹里的文件（真实的文件系统事件），应用监视、热重载。
// 判定一律用状态轮询（热重载完成的次数和结果、预览是否就绪），不依赖固定的等待时间。窗口不显示、不抢焦点。
// 不点“打开模板文件夹”：那会真的弹出资源管理器，只核对它在菜单里的可用状态。

/** 文件改动到预览换上新代码的时限（T-DEV-1） */
const RELOAD_BUDGET_MS = 5000;

const MANIFEST_PARAMS = [
  { key: 'size', type: 'number', label: { 'zh-CN': '大小', en: 'Size' }, default: 1, min: 0.1, max: 1 },
  { key: 'tint', type: 'color', label: { 'zh-CN': '颜色', en: 'Tint' }, default: '#FF0000' },
];

/** 铺满舞台的一块纯色（颜色写死在代码里，改代码就能看出预览换了）；大小来自参数 */
function solidCode(color: string): string {
  return `export default {
  setup(ctx) {
    const { THREE, scene, stage, params } = ctx;
    const size = typeof params.size === 'number' ? params.size : 1;
    const quad = new THREE.Mesh(new THREE.PlaneGeometry(stage.width * size, stage.height * size), new THREE.MeshBasicMaterial({ color: '${color}' }));
    scene.add(quad);
    return { duration: 2, cutTime: 1, update(t) { quad.position.y = 0 * t; } };
  },
};
`;
}

interface DevState {
  reloads: number;
  phase: string;
  last: { ok: boolean } | null;
  diagnostics: { kind: string; code: string; line?: number; column?: number; operation?: string }[];
}

const devState = (page: Page) => page.evaluate(() => window.__allayTest!.devState() as unknown as DevState);

/** 等热重载处理完一次新的改动（完成次数超过 before、回到空闲） */
async function waitReload(page: Page, before: number, timeout = RELOAD_BUDGET_MS): Promise<DevState> {
  await page.waitForFunction((n) => {
    const s = window.__allayTest!.devState();
    return s.reloads > n && s.phase === 'idle';
  }, before, { timeout, polling: 50 });
  return devState(page);
}

/** 像编辑器的原子保存那样写文件：先写临时文件再改名 */
function save(path: string, text: string): void {
  writeFileSync(`${path}.tmp`, text);
  renameSync(`${path}.tmp`, path);
}

async function copyBuiltin(page: Page): Promise<{ id: string; version: string }> {
  await page.waitForFunction(() => window.__allayTest?.previewUpToDate() === true, undefined, { timeout: 30_000 });
  await page.getByTestId('project-menu').click();
  // 当前是内置模板：能复制，没有文件夹可开
  await expect(page.getByTestId('menu-open-template-folder')).toHaveAttribute('data-disabled', '');
  await page.getByTestId('menu-copy-builtin').click();
  await page.waitForFunction(() => window.__allayTest!.project().ref?.id.startsWith('user.') === true && window.__allayTest!.previewUpToDate(), undefined, { timeout: 30_000 });
  return page.evaluate(() => window.__allayTest!.project().ref!);
}

let launched: Launched | null = null;
let dir = '';

test.afterEach(async () => {
  await launched?.app.close();
  launched = null;
  removeUserDataDir(dir);
});

test('T-DEV-1 入口、类型定义、监视提示；改动模板文件后预览在时限内更新，播放位置和参数不变，manifest 变了属性面板重建', async () => {
  dir = makeUserDataDir();
  launched = await launchApp(dir);
  const { page } = launched;

  const ref = await copyBuiltin(page);
  const folder = join(dir, 'templates', ref.id, ref.version);
  // 复制后自动写好类型定义和 jsconfig.json，外部编辑器能补全
  expect(existsSync(join(folder, 'template-api.d.ts'))).toBe(true);
  expect(JSON.parse(readFileSync(join(folder, 'jsconfig.json'), 'utf8')).compilerOptions.checkJs).toBe(true);
  // 不打扰的监视提示；现在可以打开文件夹、不能再复制
  await expect(page.getByTestId('dev-watch-status')).toBeVisible();
  await page.getByTestId('project-menu').click();
  await expect(page.getByTestId('menu-open-template-folder')).not.toHaveAttribute('data-disabled', '');
  await expect(page.getByTestId('menu-copy-builtin')).toHaveAttribute('data-disabled', '');
  await page.keyboard.press('Escape');

  // 换成测试用的 manifest 和代码（红色）
  const manifest = (params: unknown[]) => JSON.stringify({ formatVersion: 1, id: ref.id, version: ref.version, name: 'Dev', category: 'transition', params });
  let s = await devState(page);
  save(join(folder, 'manifest.json'), manifest(MANIFEST_PARAMS));
  save(join(folder, 'template.js'), solidCode('#FF0000'));
  await page.waitForFunction(() => window.__allayTest!.project().paramDefaults.tint === '#FF0000' && window.__allayTest!.devState().phase === 'idle' && window.__allayTest!.previewUpToDate(), undefined, { timeout: 10_000, polling: 50 });
  s = await devState(page);
  expect(s.last?.ok).toBe(true);
  await expect(page.getByTestId('param-row-tint')).toBeVisible();
  await expect(page.getByTestId('dev-watch-status')).toHaveAttribute('data-result', 'ok');

  // 改参数、挪播放头
  await page.evaluate(() => window.__allayTest!.setParams({ size: 0.5, tint: '#00FF00' }));
  await page.evaluate(() => window.__allayTest!.setTime(0.75));
  await page.waitForFunction(() => window.__allayTest!.previewUpToDate(), undefined, { timeout: 10_000 });
  const params = (await page.evaluate(() => window.__allayTest!.project().params)) as Record<string, unknown>;
  const generation = await page.evaluate(() => window.__allayTest!.workerGeneration());
  const center = await page.evaluate(() => window.__allayTest!.previewPixel(0.75, 0.5, 0.5));
  expect(center[0]).toBeGreaterThan(200);

  // 只改代码（红 → 蓝）：时限内换上新代码，播放位置、参数不变，换了一个 Worker
  const t0 = Date.now();
  save(join(folder, 'template.js'), solidCode('#0000FF'));
  s = await waitReload(page, s.reloads);
  const elapsed = Date.now() - t0;
  expect(s.last?.ok).toBe(true);
  expect(elapsed).toBeLessThan(RELOAD_BUDGET_MS);
  expect(await page.evaluate(() => window.__allayTest!.transport().time)).toBe(0.75);
  expect(await page.evaluate(() => window.__allayTest!.project().params)).toEqual(params);
  expect(await page.evaluate(() => window.__allayTest!.workerGeneration())).toBeGreaterThan(generation);
  const after = await page.evaluate(() => window.__allayTest!.previewPixel(0.75, 0.5, 0.5));
  expect(after[2]).toBeGreaterThan(200);
  expect(after[0]).toBeLessThan(50);
  // 热重载不进撤销历史
  const history = await page.evaluate(() => window.__allayTest!.history());

  // 改 manifest：tint 改成数字（类型变了，回默认值），加一个参数；size 保留
  save(
    join(folder, 'manifest.json'),
    manifest([MANIFEST_PARAMS[0], { key: 'tint', type: 'number', label: 'Tint', default: 3, min: 0, max: 10 }, { key: 'extra', type: 'boolean', label: { 'zh-CN': '附加', en: 'Extra' }, default: true }]),
  );
  s = await waitReload(page, s.reloads);
  expect(s.last?.ok).toBe(true);
  expect(await page.evaluate(() => window.__allayTest!.project().params)).toEqual({ size: 0.5, tint: 3, extra: true });
  expect(await page.evaluate(() => window.__allayTest!.transport().time)).toBe(0.75);
  await expect(page.getByTestId('param-row-extra')).toBeVisible();
  expect(await page.evaluate(() => window.__allayTest!.history())).toEqual(history);
});

test('T-DEV-2（界面）语法错误、运行时错误、死循环、不确定代码：带位置的诊断，预览保留上一帧，修好后恢复', async () => {
  dir = makeUserDataDir();
  launched = await launchApp(dir);
  const { page } = launched;
  const ref = await copyBuiltin(page);
  const folder = join(dir, 'templates', ref.id, ref.version);
  const good = solidCode('#3366FF');
  save(join(folder, 'manifest.json'), JSON.stringify({ formatVersion: 1, id: ref.id, version: ref.version, name: 'Dev', category: 'transition', params: MANIFEST_PARAMS }));
  save(join(folder, 'template.js'), good);
  await page.waitForFunction(() => window.__allayTest!.project().paramDefaults.tint === '#FF0000' && window.__allayTest!.devState().last?.ok === true && window.__allayTest!.previewUpToDate(), undefined, { timeout: 10_000, polling: 50 });
  await page.evaluate(() => window.__allayTest!.setTime(0.5));
  // 死循环要等看门狗：把预览单帧的时限调短（备用 Worker 用同一套时限）
  await page.evaluate(() => window.__allayTest!.setPreviewTimeouts({ previewFrame: 2000, load: 4000 }));
  await page.waitForFunction(() => window.__allayTest!.previewUpToDate(), undefined, { timeout: 10_000 });
  const goodHash = await page.evaluate(() => window.__allayTest!.previewHash(0.5));
  const generation = await page.evaluate(() => window.__allayTest!.workerGeneration());

  const cases: { name: string; code: string; kind: string; code_: string; line?: number; column?: number }[] = [
    { name: '语法错误', code: readFixture('dev/syntax-error.js'), kind: 'compile', code_: 'syntax-error', line: 6, column: 25 },
    { name: 'setup 抛错', code: readFixture('dev/setup-throws.js'), kind: 'setup', code_: 'setup-threw', line: 5, column: 11 },
    { name: 'update 抛错', code: readFixture('dev/update-throws.js'), kind: 'update', code_: 'update-threw', line: 9, column: 29 },
    // 死循环：Worker 被看门狗终止，拿不到卡在哪一行（docs/decisions.md MD-a），诊断带操作和时限
    { name: '死循环', code: readFixture('hang-update.js'), kind: 'watchdog', code_: 'unresponsive' },
    { name: '不确定代码', code: readFixture('dev/random-update.js'), kind: 'rule', code_: 'math-random', line: 8, column: 24 },
  ];

  let s = await devState(page);
  for (const c of cases) {
    await test.step(c.name, async () => {
      save(join(folder, 'template.js'), c.code);
      s = await waitReload(page, s.reloads, c.kind === 'watchdog' ? 15_000 : RELOAD_BUDGET_MS);
      expect(s.last?.ok, c.name).toBe(false);
      const d = s.diagnostics[0]!;
      expect(d.kind).toBe(c.kind);
      expect(d.code).toBe(c.code_);
      if (c.line !== undefined) {
        expect(d.line).toBe(c.line);
        expect(d.column).toBe(c.column);
      } else {
        expect(d.operation).toBe('render');
      }
      // 错误浮层：种类、错误码、位置
      const row = page.getByTestId('dev-diagnostic').first();
      await expect(page.getByTestId('dev-overlay')).toBeVisible();
      await expect(row).toHaveAttribute('data-kind', c.kind);
      await expect(row).toHaveAttribute('data-code', c.code_);
      if (c.line !== undefined) await expect(row.getByTestId('dev-diagnostic-position')).toContainText(`${c.line}`);
      await expect(page.getByTestId('dev-watch-status')).toHaveAttribute('data-result', 'failed');
      // 预览保留上一帧：还是原来的 Worker、原来的代码，画面相同，状态仍是就绪
      expect(await page.evaluate(() => window.__allayTest!.workerGeneration())).toBe(generation);
      expect(await page.evaluate(() => window.__allayTest!.status().kind)).toBe('ready');
      expect(await page.evaluate(() => window.__allayTest!.previewHash(0.5))).toBe(goodHash);
    });
  }

  // 修好：浮层消失，预览换上修好的代码
  save(join(folder, 'template.js'), good.replace('#3366FF', '#33FF66'));
  s = await waitReload(page, s.reloads);
  expect(s.last?.ok).toBe(true);
  expect(s.diagnostics).toEqual([]);
  await expect(page.getByTestId('dev-overlay')).toHaveCount(0);
  await expect(page.getByTestId('dev-watch-status')).toHaveAttribute('data-result', 'ok');
  expect(await page.evaluate(() => window.__allayTest!.previewHash(0.5))).not.toBe(goodHash);
  expect(await page.evaluate(() => window.__allayTest!.transport().time)).toBe(0.5);
});

test('H11 主进程经命令通道调用界面命令；H3 修订号冲突被拒绝；H6 撤销记录标明来自主进程；H4 静帧接口带尺寸上限', async () => {
  dir = makeUserDataDir();
  launched = await launchApp(dir);
  const { app, page } = launched;
  await page.waitForFunction(() => window.__allayTest?.previewUpToDate() === true, undefined, { timeout: 30_000 });

  type Outcome = { ok: boolean; output?: { revision: number; params: Record<string, unknown> }; error?: string };
  const run = (command: string, input?: unknown) =>
    app.evaluate(
      async (_electron, [c, i]) => {
        const ch = (globalThis as unknown as { __allayHostCommands: { run(c: string, i?: unknown): Promise<unknown> } }).__allayHostCommands;
        return ch.run(c as string, i);
      },
      [command, input] as const,
    ) as Promise<Outcome>;

  const snap = await run('project.get');
  expect(snap.ok).toBe(true);
  expect(snap.output!.revision).toBe(await page.evaluate(() => window.__allayTest!.project().revision));
  const key = Object.keys(snap.output!.params).find((k) => typeof snap.output!.params[k] === 'number')!;
  const set = await run('project.setParams', { params: { [key]: snap.output!.params[key] }, baseRevision: snap.output!.revision });
  expect(set.ok).toBe(true);
  expect(await run('project.setParams', { params: {}, baseRevision: snap.output!.revision - 1 })).toMatchObject({ ok: false, error: 'conflict' });
  expect(await run('noSuchCommand')).toMatchObject({ ok: false, error: 'unknown-command' });
  expect(await run('project.setParams', { params: 'x' })).toMatchObject({ ok: false, error: 'invalid-input' });

  // 一次真正改了值的写命令：撤销记录标明来源
  await page.evaluate(() => window.__allayTest!.dispatch('reroll'));
  expect(await page.evaluate(() => window.__allayTest!.undoInfo().undo)).toEqual({ labelKey: 'command.items.reroll', source: 'command' });

  // 静帧：按输出比例缩到 320 宽；要求超过上限时钳到 1920
  const small = await page.evaluate(() => window.__allayTest!.renderStill(0.55, 320));
  expect([small.width, small.height]).toEqual([320, 180]);
  expect(Buffer.from(small.pngBase64, 'base64').subarray(1, 4).toString('latin1')).toBe('PNG');
  const big = await page.evaluate(() => window.__allayTest!.renderStill(0.55, 99_999));
  expect([big.width, big.height]).toEqual([1920, 1080]);

  // 这次构建没有可选模块
  expect(await page.evaluate(() => window.__allayTest!.optionalModules())).toEqual({ available: [], active: [], failures: {} });
});
