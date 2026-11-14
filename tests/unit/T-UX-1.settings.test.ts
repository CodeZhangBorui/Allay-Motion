import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createLogger } from '../../apps/desktop/src/main/logger';
import { SettingsStore } from '../../apps/desktop/src/main/settings-store';
import { migrateSettingsFile, UiSettingsPatchSchema } from '../../apps/desktop/src/shared/settings';

// T-UX-1 设置的校验与平滑升级（docs/06-ui-design.md 6.13、docs/decisions.md 界面增强）

let dir: string;
const log = createLogger(null, false);
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'allay-ux-settings-'));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe('T-UX-1 设置：引导标记、自定义快捷键、默认文件夹', () => {
  it('新装（没有设置文件）：引导还没走过', async () => {
    const s = await new SettingsStore(join(dir, 'settings.json'), log).load();
    expect(s.ui.onboardingCompleted).toBe(false);
    expect(s.ui.shortcuts).toEqual({});
    expect(s.project).toEqual({ folder: null });
  });

  it('引导上线之前的设置文件（没有新字段）：引导算走过，其他字段照旧，新字段用默认值', async () => {
    const file = join(dir, 'settings.json');
    // M8 时的设置文件长这样（只列了几项）
    writeFileSync(file, JSON.stringify({ formatVersion: 1, ui: { theme: 'light', language: 'en' }, export: { folder: 'D:/out', h264: null } }));
    const s = await new SettingsStore(file, log).load();
    expect(s.ui.onboardingCompleted).toBe(true);
    expect(s.ui.theme).toBe('light');
    expect(s.ui.language).toBe('en');
    expect(s.ui.shortcuts).toEqual({});
    expect(s.export.folder).toBe('D:/out');
    expect(s.project).toEqual({ folder: null });
    // ui 整块缺失或坏掉也算老用户
    expect(migrateSettingsFile({ formatVersion: 1 })?.ui.onboardingCompleted).toBe(true);
    expect(migrateSettingsFile({ formatVersion: 1, ui: 'broken' })?.ui.onboardingCompleted).toBe(true);
    expect(migrateSettingsFile({ formatVersion: 1, ui: { onboardingCompleted: 'yes' } })?.ui.onboardingCompleted).toBe(true);
  });

  it('明确记着没走完的（新装后中途退出）保持 false；走完后写回 true', async () => {
    const file = join(dir, 'settings.json');
    writeFileSync(file, JSON.stringify({ formatVersion: 1, ui: { onboardingCompleted: false } }));
    const store = new SettingsStore(file, log);
    expect((await store.load()).ui.onboardingCompleted).toBe(false);
    await store.updateUi({ onboardingCompleted: true });
    expect(JSON.parse(readFileSync(file, 'utf8')).ui.onboardingCompleted).toBe(true);
    expect((await new SettingsStore(file, log).load()).ui.onboardingCompleted).toBe(true);
  });

  it('自定义快捷键：坏掉的条目各自回到默认，整块坏了只回退这一项', () => {
    const shortcuts = { loop: 'Ctrl+Shift+L', reroll: null, playPause: 'Shift+Ctrl+P', export: 'Ctrl+C', 'bad id!': 'K', toStart: 42, toEnd: 'Hyper+Q' };
    const s = migrateSettingsFile({ formatVersion: 1, ui: { theme: 'light', shortcuts } });
    // 写法不规范（修饰键顺序）、保留键（Ctrl+C）、坏 id、非字符串、未知修饰键都丢掉
    expect(s?.ui.shortcuts).toEqual({ loop: 'Ctrl+Shift+L', reroll: null });
    expect(s?.ui.theme).toBe('light');
    const broken = migrateSettingsFile({ formatVersion: 1, ui: { theme: 'light', shortcuts: [1, 2] } });
    expect(broken?.ui.shortcuts).toEqual({});
    expect(broken?.ui.theme).toBe('light');
  });

  it('工程文件夹坏了只回退这一项', () => {
    const s = migrateSettingsFile({ formatVersion: 1, ui: { theme: 'light' }, project: { folder: 7 } });
    expect(s?.project).toEqual({ folder: null });
    expect(s?.ui.theme).toBe('light');
  });

  it('渲染进程发来的修改：快捷键表整张校验，保留键、坏写法、多余的键都拒绝', () => {
    expect(UiSettingsPatchSchema.safeParse({ shortcuts: { loop: 'Ctrl+Shift+L', reroll: null } }).success).toBe(true);
    expect(UiSettingsPatchSchema.safeParse({ shortcuts: { loop: 'Ctrl+V' } }).success).toBe(false);
    expect(UiSettingsPatchSchema.safeParse({ shortcuts: { loop: 'Shift+Ctrl+L' } }).success).toBe(false);
    expect(UiSettingsPatchSchema.safeParse({ shortcuts: { '../x': 'L' } }).success).toBe(false);
    expect(UiSettingsPatchSchema.safeParse({ onboardingCompleted: true }).success).toBe(true);
    expect(UiSettingsPatchSchema.safeParse({ onboardingCompleted: 'yes' }).success).toBe(false);
    // 文件夹只有主进程能改：渲染进程的设置修改里没有这个字段
    expect(UiSettingsPatchSchema.safeParse({ project: { folder: 'C:/x' } }).success).toBe(false);
  });
});
