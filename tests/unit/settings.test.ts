import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createLogger, formatLine } from '../../apps/desktop/src/main/logger';
import { SettingsStore, writeJsonAtomic } from '../../apps/desktop/src/main/settings-store';
import { restoreBounds } from '../../apps/desktop/src/main/window-state';
import { defaultResourceSettings, defaultUiSettings } from '../../apps/desktop/src/shared/settings';

let dir: string;
const log = createLogger(null, false);

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'allay-settings-'));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('设置读写（1.9）', () => {
  it('没有文件时用默认值', async () => {
    const store = new SettingsStore(join(dir, 'settings.json'), log);
    const s = await store.load();
    expect(s).toEqual({ formatVersion: 1, ui: defaultUiSettings(), resources: defaultResourceSettings() });
  });

  it('资源栈配置：M1 的设置文件没有 resources 时用默认值；坏掉时只回退这一项', async () => {
    const file = join(dir, 'settings.json');
    writeFileSync(file, JSON.stringify({ formatVersion: 1, ui: { theme: 'light' } }));
    const store = new SettingsStore(file, log);
    expect((await store.load()).resources).toEqual(defaultResourceSettings());
    writeFileSync(file, JSON.stringify({ formatVersion: 1, ui: { theme: 'light' }, resources: { vanilla: 'x', packs: 3 } }));
    const loaded = await store.load();
    expect(loaded.resources).toEqual(defaultResourceSettings());
    expect(loaded.ui.theme).toBe('light');
    // zip 包只能记 <sha256>.zip，不能被改成任意路径
    writeFileSync(
      file,
      JSON.stringify({ formatVersion: 1, resources: { vanilla: { consent: true, enabled: true, dir: null }, packs: [{ id: 'z', name: 'z', enabled: true, source: { kind: 'zip', file: '../../evil.zip' } }] } }),
    );
    expect((await store.load()).resources).toEqual(defaultResourceSettings());
    await store.updateResources({ vanilla: { consent: false, enabled: true, dir: null }, packs: [] });
    expect(JSON.parse(readFileSync(file, 'utf8')).resources.vanilla.consent).toBe(false);
  });

  it('写入带 formatVersion，先写临时文件再改名，不留临时文件', async () => {
    const file = join(dir, 'settings.json');
    const store = new SettingsStore(file, log);
    await store.load();
    await store.updateUi({ theme: 'light', layout: { left: { size: 300, collapsed: true } } });
    const json = JSON.parse(readFileSync(file, 'utf8'));
    expect(json.formatVersion).toBe(1);
    expect(json.ui.theme).toBe('light');
    expect(json.ui.layout.left).toEqual({ size: 300, collapsed: true });
    expect(json.ui.layout.right).toEqual({ size: 320, collapsed: false });
    expect(readdirSync(dir)).toEqual(['settings.json']);

    const again = new SettingsStore(file, log);
    expect((await again.load()).ui.theme).toBe('light');
  });

  it('并发写入串行化，最后的状态落盘', async () => {
    const file = join(dir, 'settings.json');
    const store = new SettingsStore(file, log);
    await store.load();
    await Promise.all(Array.from({ length: 20 }, (_, i) => store.updateUi({ layout: { right: { size: 280 + i, collapsed: false } } })));
    await store.flush();
    expect(JSON.parse(readFileSync(file, 'utf8')).ui.layout.right.size).toBe(299);
    expect(readdirSync(dir)).toEqual(['settings.json']);
  });

  it('坏掉的 JSON：留档并用默认值', async () => {
    const file = join(dir, 'settings.json');
    writeFileSync(file, '{ not json');
    const store = new SettingsStore(file, log);
    expect((await store.load()).ui).toEqual(defaultUiSettings());
    expect(readdirSync(dir).some((f) => f.startsWith('settings.json.bad-'))).toBe(true);
  });

  it('未知的 formatVersion：留档并用默认值', async () => {
    const file = join(dir, 'settings.json');
    writeFileSync(file, JSON.stringify({ formatVersion: 99, ui: { theme: 'light' } }));
    const store = new SettingsStore(file, log);
    expect((await store.load()).ui.theme).toBe('dark');
  });

  it('单个字段坏了只回退这个字段', async () => {
    const file = join(dir, 'settings.json');
    writeFileSync(
      file,
      JSON.stringify({
        formatVersion: 1,
        ui: {
          theme: 'light',
          language: 'klingon',
          reducedMotion: 'on',
          layout: { left: { size: -5, collapsed: 1 }, right: { size: 400, collapsed: true } },
        },
        window: { x: 'a' },
      }),
    );
    const s = await new SettingsStore(file, log).load();
    expect(s.ui.theme).toBe('light');
    expect(s.ui.language).toBe('system');
    expect(s.ui.reducedMotion).toBe('on');
    expect(s.ui.layout.left).toEqual({ size: 280, collapsed: false });
    expect(s.ui.layout.right).toEqual({ size: 400, collapsed: true });
    expect(s.window).toBeUndefined();
  });

  it('writeJsonAtomic 覆盖已有文件', async () => {
    const file = join(dir, 'x.json');
    await writeJsonAtomic(file, { a: 1 });
    await writeJsonAtomic(file, { a: 2 });
    expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual({ a: 2 });
  });
});

describe('日志', () => {
  it('写进 logs/main.log，一行一条', () => {
    const logger = createLogger(join(dir, 'logs'), false);
    logger.warn('net', 'blocked request', { url: 'https://example.com/x' });
    const text = readFileSync(join(dir, 'logs', 'main.log'), 'utf8');
    expect(text).toMatch(/^\d{4}-\d{2}-\d{2}T.* WARN {2}\[net\] blocked request \{"url":"https:\/\/example\.com\/x"\}\n$/);
  });
  it('过长的内容被截断', () => {
    const line = formatLine('info', 's', 'x'.repeat(2000));
    expect(line.length).toBeLessThan(600);
  });
});

describe('窗口位置和大小的恢复', () => {
  const screen = [{ x: 0, y: 0, width: 1920, height: 1040 }];
  it('没有记录：默认 1440×900', () => {
    expect(restoreBounds(undefined, screen)).toEqual({ width: 1440, height: 900 });
  });
  it('记录在屏幕内：原样恢复', () => {
    expect(restoreBounds({ x: 100, y: 50, width: 1300, height: 800, maximized: false }, screen)).toEqual({
      x: 100,
      y: 50,
      width: 1300,
      height: 800,
    });
  });
  it('不小于最小尺寸 1120×700', () => {
    expect(restoreBounds({ x: 0, y: 0, width: 400, height: 300, maximized: false }, screen)).toMatchObject({ width: 1120, height: 700 });
  });
  it('屏幕已拔掉：丢掉位置', () => {
    expect(restoreBounds({ x: 3000, y: 100, width: 1300, height: 800, maximized: false }, screen)).toEqual({ width: 1300, height: 800 });
  });
});

describe('只给测试用的开关', () => {
  const ALL = {
    ALLAY_E2E_HIDDEN: '1',
    ALLAY_USER_DATA_DIR: 'C:/x',
    ALLAY_E2E_HOOKS: '1',
    ALLAY_E2E_EXPORT_TARGET: 'C:/out',
    ALLAY_FFMPEG: 'C:/ff.exe',
    ALLAY_E2E_GAME_APPDATA: 'C:/game',
    ALLAY_E2E_MOJANG_ORIGIN: 'http://127.0.0.1:4567',
  };
  const OFF = { userDataDir: null, hiddenWindow: false, testHooks: false, exportTarget: null, ffmpeg: null, gameAppData: null, mojangOrigin: null };
  it('打包后的应用忽略它们', async () => {
    const { readTestSwitches } = await import('../../apps/desktop/src/main/test-switches');
    expect(readTestSwitches(true, ALL)).toEqual(OFF);
  });
  it('未打包时生效', async () => {
    const { readTestSwitches } = await import('../../apps/desktop/src/main/test-switches');
    expect(readTestSwitches(false, ALL)).toEqual({
      userDataDir: 'C:/x',
      hiddenWindow: true,
      testHooks: true,
      exportTarget: 'C:/out',
      ffmpeg: 'C:/ff.exe',
      gameAppData: 'C:/game',
      mojangOrigin: 'http://127.0.0.1:4567',
    });
    // 假服务器只能是本机回环地址
    for (const bad of ['https://127.0.0.1:4567', 'http://evil.example:80', 'http://127.0.0.1:4567/x', 'http://localhost:4567'])
      expect(readTestSwitches(false, { ALLAY_E2E_MOJANG_ORIGIN: bad }).mojangOrigin).toBeNull();
    expect(readTestSwitches(false, { ALLAY_E2E_HIDDEN: 'yes', ALLAY_E2E_HOOKS: 'yes' })).toEqual(OFF);
    expect(readTestSwitches(false, {})).toEqual(OFF);
  });
});
