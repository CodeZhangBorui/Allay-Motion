import { spawn } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { writeZip } from '../../apps/desktop/src/main/templates/zip-writer';
import { appEnv, DESKTOP_DIR, ELECTRON_PATH, launchApp, makeUserDataDir, readMainLog, removeUserDataDir, ROOT } from './helpers';

// M8 的端到端测试：文件关联（启动参数和第二实例参数经命令通道交给界面）、关于页的第三方许可和声明、
// WebGL2 不可用时的说明页。窗口不显示、不抢焦点；工程文件和模板包都在测试时生成。

const FLAGSHIP = { id: 'allay.builtin.block-wipe', version: '1.0.0' };

function projectFile(dir: string, name: string, cols: number): string {
  const file = join(dir, `${name}.allay`);
  writeFileSync(
    file,
    JSON.stringify({
      formatVersion: 1,
      appVersion: '0.1.0',
      name,
      template: FLAGSHIP,
      params: { cols },
      output: { width: 1920, height: 1080, fps: 60 },
      export: { preset: 'prores4444', quality: 'standard', shutterAngle: 180 },
      preview: { background: 'checker' },
      files: {},
      resourceHint: [],
    }),
  );
  return file;
}

function templatePackage(dir: string): string {
  const file = join(dir, 'm8.allaytpl');
  const manifest = { formatVersion: 1, id: 'user.e2e.m8', version: '1.0.0', name: 'M8', category: 'overlay', params: [{ key: 'size', type: 'number', label: 'Size', default: 1, min: 0, max: 10 }] };
  const code = 'export default { setup() { return { duration: 1, cutTime: null, update() {} }; } };';
  writeFileSync(file, writeZip([
    { path: 'manifest.json', data: Buffer.from(JSON.stringify(manifest)) },
    { path: 'template.js', data: Buffer.from(code) },
  ]));
  return file;
}

const project = (page: Page) => page.evaluate(() => window.__allayTest!.project());

test('M8 文件关联：启动参数里的 .allaytpl 安装模板、.allay 打开工程；第二实例的参数交给已开着的应用', async () => {
  const dir = makeUserDataDir();
  const files = join(dir, 'files');
  mkdirSync(files);
  const tpl = templatePackage(files);
  const first = projectFile(files, 'first', 20);
  const second = projectFile(files, 'second', 7);
  const { app, page } = await launchApp(dir, {}, { args: [tpl, first] });
  try {
    // 先装模板（排队的顺序），再打开工程：最后是工程里的模板和参数
    await expect.poll(async () => (await page.evaluate(() => window.__allayTest!.templates())).some((e) => e.id === 'user.e2e.m8'), { timeout: 30_000 }).toBe(true);
    // 装好的模板被选中（与“导入模板…”相同），工程因此有了改动：打开工程前先问一句，这里确认
    await page.getByTestId('confirm-ok').click({ timeout: 30_000 });
    await expect.poll(async () => (await project(page)).params.cols, { timeout: 30_000 }).toBe(20);
    expect((await project(page)).ref).toEqual(FLAGSHIP);
    await expect(page.getByTestId('project-name')).toHaveText('first');
    await expect.poll(() => readMainLog(dir).match(/\[open-files\] handled/g)?.length ?? 0).toBe(2);

    // 第二个进程拿不到单实例锁就退出，参数经 second-instance 交给这个进程
    const env = appEnv(dir);
    const code = await new Promise<number | null>((resolve, reject) => {
      const child = spawn(ELECTRON_PATH, [DESKTOP_DIR, second], { env, cwd: DESKTOP_DIR, windowsHide: true, stdio: 'ignore' });
      child.once('error', reject);
      child.once('exit', resolve);
    });
    expect(code).toBe(0);
    await expect.poll(async () => (await project(page)).params.cols, { timeout: 30_000 }).toBe(7);
    await expect(page.getByTestId('project-name')).toHaveText('second');
    expect(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length)).toBe(1);

    // 令牌是一次性的：界面拿不认识的令牌只会得到“已失效”，拿路径会被 IPC 校验拒绝
    const bogus = await page.evaluate(async () => ({
      project: await window.allay.project.openRequested('3f2504e0-4f89-41d3-9a0c-0305e82c3301'),
      template: await window.allay.templates.installRequested('3f2504e0-4f89-41d3-9a0c-0305e82c3301'),
    }));
    expect(bogus.project).toEqual({ ok: false, error: 'missing' });
    expect(bogus.template).toMatchObject({ ok: false, error: { code: 'staging-expired' } });
    const log = readMainLog(dir);
    // 主进程日志里没有把路径写进 open-files 的记录（只有种类）
    expect(log.split('\n').filter((l) => l.includes('[open-files]') && /first\.allay|second\.allay|m8\.allaytpl/.test(l))).toEqual([]);
    expect(log.split('\n').filter((l) => l.includes('[open-files]')).length).toBeGreaterThan(3);
    expect(log).toMatch(/\[startup\] renderer-ready/);
  } finally {
    await app.close();
    removeUserDataDir(dir);
  }
});

test('M8 文件关联：坏文件给出提示、工程不变；打开工程前有未保存的改动时先问一句', async () => {
  const dir = makeUserDataDir();
  const files = join(dir, 'files');
  mkdirSync(files);
  const good = projectFile(files, 'good', 9);
  const broken = join(files, 'broken.allay');
  writeFileSync(broken, '{ not json');
  const { app, page } = await launchApp(dir);
  // 模拟第二实例交来的文件：直接放进主进程的队列（second-instance 的那条路在上一个测试里走过）
  const enqueue = (file: string) =>
    app.evaluate((_e, f) => {
      const q = (globalThis as unknown as { __allayOpenFiles: { enqueue(files: { kind: string; path: string }[]): void } }).__allayOpenFiles;
      q.enqueue([{ kind: 'project', path: f }]);
    }, file);
  const handled = () => readMainLog(dir).match(/\[open-files\] handled/g)?.length ?? 0;
  try {
    await expect.poll(() => readMainLog(dir).includes('[startup] renderer-ready')).toBe(true);
    const before = await project(page);
    await enqueue(broken);
    await expect.poll(handled, { timeout: 20_000 }).toBe(1);
    expect((await project(page)).params).toEqual(before.params);
    await expect(page.getByTestId('project-name')).not.toHaveText('broken');

    await page.evaluate(() => window.__allayTest!.setParams({ cols: 30 }));
    await expect(page.getByTestId('project-dirty')).toBeVisible();
    await enqueue(good);
    // 确认框出现，选“取消”：工程不变
    const dialog = page.getByTestId('confirm-dialog');
    await expect(dialog).toBeVisible();
    await dialog.getByRole('button', { name: /Cancel|取消/ }).click();
    await expect(dialog).toHaveCount(0);
    await expect.poll(handled).toBe(2);
    expect((await project(page)).params.cols).toBe(30);
    // 再来一次，这回确认：打开了
    await enqueue(good);
    await page.getByTestId('confirm-ok').click();
    await expect.poll(async () => (await project(page)).params.cols, { timeout: 20_000 }).toBe(9);
    await expect(page.getByTestId('project-name')).toHaveText('good');
  } finally {
    await app.close();
    removeUserDataDir(dir);
  }
});

test('M8 关于页：非官方声明、悦灵图像的来源、FFmpeg 的来源和源码去处、完整的第三方许可清单', async () => {
  const dir = makeUserDataDir();
  const { app, page } = await launchApp(dir);
  try {
    await page.evaluate(() => window.__allayTest!.dispatch('settings', { page: 'about' }));
    await expect(page.getByTestId('about-disclaimer')).toContainText('NOT AN OFFICIAL MINECRAFT PRODUCT');
    await expect(page.getByTestId('about-license')).toContainText('GPL-3.0');
    await expect(page.getByTestId('about-license')).toContainText('https://github.com/Mystic-Stars/Allay-Motion/issues');
    await expect(page.getByTestId('about-license-scope')).toContainText('Mojang');
    await expect(page.getByTestId('about-guidelines')).toContainText('https://www.minecraft.net/usage-guidelines');
    const data = JSON.parse(readFileSync(join(ROOT, 'apps/desktop/src/renderer/features/settings/third-party-licenses.json'), 'utf8')) as { ffmpeg: { commit: string }; entries: unknown[] };
    await expect(page.getByTestId('about-ffmpeg-source')).toContainText(data.ffmpeg.commit);
    await expect(page.getByTestId('about-third-party-list').locator(':scope > li')).toHaveCount(data.entries.length);
    // 展开一项能看到许可原文
    const three = page.getByTestId('about-third-party-list').locator('li', { hasText: 'three' }).first();
    await three.locator('summary').click();
    await expect(three.locator('pre')).toContainText('MIT');
  } finally {
    await app.close();
    removeUserDataDir(dir);
  }
});

test('M8 WebGL2 不可用：显示说明页和诊断信息，不白屏', async () => {
  const dir = makeUserDataDir();
  const { app, page } = await launchApp(dir, { ALLAY_E2E_NO_WEBGL: '1' }, { waitFor: '[data-testid="no-webgl"]' });
  // “复制诊断信息”会写系统剪贴板：先记下用户原来的内容，测完放回去
  const saved = await app.evaluate(({ clipboard }) => clipboard.readText());
  try {
    await expect(page.getByTestId('no-webgl')).toBeVisible();
    await expect(page.getByTestId('topbar')).toHaveCount(0);
    await expect(page.getByTestId('no-webgl-diagnostics')).toContainText('webgl2: no');
    await expect(page.getByTestId('no-webgl-diagnostics')).toContainText('version: 0.1.0');
    const title = await page.locator('h1').textContent();
    expect(title && title.trim().length > 0).toBe(true);
    await page.getByTestId('no-webgl-copy').click();
    await expect(page.getByTestId('no-webgl-copy')).toHaveText(/Copied|已复制/);
    expect(await app.evaluate(({ clipboard }) => clipboard.readText())).toContain('webgl2: no');
    await expect.poll(() => readMainLog(dir).includes('[startup] renderer-ready')).toBe(true);
  } finally {
    await app.evaluate(({ clipboard }, text) => clipboard.writeText(text), saved);
    await app.close();
    removeUserDataDir(dir);
  }
});
