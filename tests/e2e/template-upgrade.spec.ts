import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { launchApp, makeUserDataDir, removeUserDataDir } from './helpers';

// T-TPL-8 的“模板升级后旧预设照常可用”（docs/04-templates.md 4.7），放到内置模板升版本号的真实情形里走一遍：
// v0.2.0 存的工程、用户预设写着当时的版本（@1.0.0），v0.3.0 起改过默认值、加过参数的内置模板是 1.1.0
// （docs/decisions.md“v0.3.0 的发版准备”）。打开工程、套用预设时这个版本不在了，改用同一个 id 的最高版本
// （features/project/actions.ts、features/templates/presets.ts）；“另存为模板”存的派生模板写的是 ^1.0.0，认 1.1.0。
// 工程和预设文件照 v0.2.0 的格式现写（这两种文件的格式在 v0.2.0 之后没有变）。窗口不显示、不抢焦点。

const ID = 'allay.builtin.boss-bar';
const OLD = '1.0.0';
const PRESET = 'v0.2.0 的预设';

async function ready(page: Page): Promise<void> {
  await expect.poll(() => page.evaluate(() => window.__allayTest!.previewUpToDate()), { timeout: 30_000 }).toBe(true);
}

/** 画面中间那一刻不是空的 */
async function drawsSomething(page: Page): Promise<void> {
  const { duration } = await page.evaluate(() => window.__allayTest!.transport());
  expect((await page.evaluate((t) => window.__allayTest!.previewStats(t), duration / 2)).maxAlpha).toBeGreaterThan(0);
}

test('T-TPL-8 模板升级：v0.2.0 的工程、用户预设、派生模板写着内置模板的旧版本，照常打开、套用、装载', async () => {
  const dir = makeUserDataDir();
  // v0.2.0 存的工程：只存和默认值不同的参数（界面缩放沿用了默认值，没有存）
  const projectFile = join(dir, 'v020.allay');
  writeFileSync(
    projectFile,
    JSON.stringify({
      formatVersion: 1,
      appVersion: '0.2.0',
      name: 'v020',
      template: { id: ID, version: OLD },
      params: { names: '旧工程', color: 'green', to: 0.5 },
      output: { width: 1920, height: 1080, fps: 60 },
      export: { preset: 'prores4444', quality: 'standard', shutterAngle: 180, key: '#00FF00' },
      preview: { background: 'checker' },
      audio: { spatial: false },
      files: {},
      resourceHint: [],
    }),
  );
  // v0.2.0 存的用户预设
  mkdirSync(join(dir, 'presets'), { recursive: true });
  writeFileSync(
    join(dir, 'presets', '0123456789abcdef0123456789abcdef.allaypreset'),
    JSON.stringify({ formatVersion: 1, template: { id: ID, version: OLD }, name: PRESET, params: { names: '旧预设', color: 'red', notches: '10' }, createdAt: '2026-11-20T12:00:00.000Z' }),
  );
  // v0.2.0 “另存为模板”存的派生模板（extends 写的是 ^ 加当时基模板的版本）
  const derivedDir = join(dir, 'templates', 'user.e2e.old-boss', '1.0.0');
  mkdirSync(derivedDir, { recursive: true });
  writeFileSync(
    join(derivedDir, 'manifest.json'),
    JSON.stringify({ formatVersion: 1, id: 'user.e2e.old-boss', version: '1.0.0', name: '旧派生', category: 'overlay', extends: { id: ID, version: `^${OLD}` }, overrides: { defaults: { color: 'blue' }, hidden: [] } }),
  );

  const { app, page } = await launchApp(dir, { ALLAY_E2E_PROJECT_PATH: projectFile });
  try {
    await ready(page);
    const all = await page.evaluate(() => window.__allayTest!.templates());
    const builtin = all.filter((e) => e.id === ID);
    expect(builtin, '前提：内置的 Boss 栏只有一个版本，而且不是 1.0.0').toHaveLength(1);
    const current = builtin[0]!.version;
    expect(current).not.toBe(OLD);

    // 工程：打开后用新版本；存下的参数照旧，没存的取新版本的默认值
    await page.locator('body').focus();
    await page.keyboard.press('Control+KeyO');
    await expect.poll(() => page.evaluate(() => window.__allayTest!.project().ref)).toEqual({ id: ID, version: current });
    await ready(page);
    const opened = await page.evaluate(() => window.__allayTest!.project());
    expect(opened.params).toMatchObject({ names: '旧工程', color: 'green', to: 0.5 });
    expect(opened.params.guiScale).toBe(opened.paramDefaults.guiScale);
    await expect(page.getByTestId('project-name')).toHaveText('v020');
    await drawsSomething(page);

    // 用户预设：预设菜单里列着，经菜单套用后用新版本、参数是预设里的
    await page.getByTestId('preset-menu').click();
    await page.getByTestId(`preset-${PRESET}`).click();
    await expect.poll(async () => (await page.evaluate(() => window.__allayTest!.project())).params.names).toBe('旧预设');
    await ready(page);
    const applied = await page.evaluate(() => window.__allayTest!.project());
    expect(applied.ref).toEqual({ id: ID, version: current });
    expect(applied.params).toMatchObject({ names: '旧预设', color: 'red', notches: '10', to: applied.paramDefaults.to });
    await drawsSomething(page);

    // 派生模板：基模板认新版本，卡片能选，装载后用派生的默认值
    expect(all.find((e) => e.id === 'user.e2e.old-boss')).toMatchObject({ kind: 'derived', baseMissing: false });
    await page.getByTestId('template-user.e2e.old-boss').click();
    await expect.poll(() => page.evaluate(() => window.__allayTest!.project().ref)).toEqual({ id: 'user.e2e.old-boss', version: '1.0.0' });
    await ready(page);
    expect((await page.evaluate(() => window.__allayTest!.project())).params.color).toBe('blue');
    await drawsSomething(page);
  } finally {
    await app.close();
    removeUserDataDir(dir);
  }
});
