import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createLogger } from '../../apps/desktop/src/main/logger';
import { SettingsStore } from '../../apps/desktop/src/main/settings-store';
import { fallbackSettingsFile, migrateSettingsFile, UiSettingsPatchSchema } from '../../apps/desktop/src/shared/settings';

// T-UX-10 新手引导的“已看过”标记（docs/06-ui-design.md 6.14）：新装为 false，老用户读成 true，看完或跳过后写回

let dir: string;
const log = createLogger(null, false);
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'allay-tour-settings-'));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe('T-UX-10 新手引导标记', () => {
  it('新装：没看过', async () => {
    expect((await new SettingsStore(join(dir, 'settings.json'), log).load()).ui.tourCompleted).toBe(false);
  });

  it('新手引导上线之前的设置文件：算看过（老用户不被拉进来）；设置文件整个坏了也算看过', () => {
    expect(migrateSettingsFile({ formatVersion: 1 })?.ui.tourCompleted).toBe(true);
    expect(migrateSettingsFile({ formatVersion: 1, ui: { onboardingCompleted: true, theme: 'light' } })?.ui.tourCompleted).toBe(true);
    expect(migrateSettingsFile({ formatVersion: 1, ui: { tourCompleted: 'no' } })?.ui.tourCompleted).toBe(true);
    expect(fallbackSettingsFile().ui.tourCompleted).toBe(true);
  });

  it('首次启动引导明确记着没走完时，新手引导也还没看', () => {
    expect(migrateSettingsFile({ formatVersion: 1, ui: { onboardingCompleted: false } })?.ui.tourCompleted).toBe(false);
    expect(migrateSettingsFile({ formatVersion: 1, ui: { onboardingCompleted: true, tourCompleted: false } })?.ui.tourCompleted).toBe(false);
  });

  it('看完或跳过后写回 true，重读保持', async () => {
    const file = join(dir, 'settings.json');
    writeFileSync(file, JSON.stringify({ formatVersion: 1, ui: { onboardingCompleted: true, tourCompleted: false } }));
    const store = new SettingsStore(file, log);
    expect((await store.load()).ui.tourCompleted).toBe(false);
    await store.updateUi({ tourCompleted: true });
    expect(JSON.parse(readFileSync(file, 'utf8')).ui.tourCompleted).toBe(true);
    expect((await new SettingsStore(file, log).load()).ui.tourCompleted).toBe(true);
  });

  it('渲染进程的修改只收布尔值', () => {
    expect(UiSettingsPatchSchema.safeParse({ tourCompleted: true }).success).toBe(true);
    expect(UiSettingsPatchSchema.safeParse({ tourCompleted: 1 }).success).toBe(false);
  });
});
