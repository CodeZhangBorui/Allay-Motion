import { describe, expect, it } from 'vitest';
import { checkUpdateUrl } from '../../apps/desktop/src/main/updates/service';
import { migrateSettingsFile } from '../../apps/desktop/src/shared/settings';
import { assetPattern, compareVersions, parseChecksums, resolveUpdateSource, staleDownload, versionFromTag } from '../../apps/desktop/src/shared/updates';
import { spaceCheckMacro } from '../../scripts/dist-extras';

// 自动更新的纯逻辑（docs/decisions.md“自动更新”）

describe('自动更新', () => {
  it('“自动”按时区选源：中国大陆用 GitCode，其他地区（含港澳台）用 GitHub', () => {
    expect(resolveUpdateSource('auto', 'Asia/Shanghai')).toBe('gitcode');
    expect(resolveUpdateSource('auto', 'Asia/Urumqi')).toBe('gitcode');
    expect(resolveUpdateSource('auto', 'Asia/Hong_Kong')).toBe('github');
    expect(resolveUpdateSource('auto', 'America/New_York')).toBe('github');
    expect(resolveUpdateSource('auto', undefined)).toBe('github');
    expect(resolveUpdateSource('github', 'Asia/Shanghai')).toBe('github');
    expect(resolveUpdateSource('gitcode', 'Europe/Berlin')).toBe('gitcode');
  });

  it('版本比较与标签解析', () => {
    expect(versionFromTag('v0.1.2')).toBe('0.1.2');
    expect(versionFromTag('nightly')).toBeNull();
    expect(compareVersions('0.1.2', '0.1.1')).toBeGreaterThan(0);
    expect(compareVersions('0.1.10', '0.1.9')).toBeGreaterThan(0);
    expect(compareVersions('1.0.0', '1.0.0')).toBe(0);
    expect(compareVersions('1.0.0', '1.0.0-beta.2')).toBeGreaterThan(0);
    expect(compareVersions('1.0.0-beta.10', '1.0.0-beta.2')).toBeGreaterThan(0);
  });

  it('按平台和架构挑安装包', () => {
    const names = ['Allay-Motion-0.1.2-x64-setup.exe', 'Allay-Motion-0.1.2-arm64.dmg', 'Allay-Motion-0.1.2-x64.dmg', 'Allay-Motion-0.1.2-arm64-mac.zip'];
    const pick = (p: string, a: string) => names.find((n) => assetPattern(p, a)?.test(n)) ?? null;
    expect(pick('win32', 'x64')).toBe('Allay-Motion-0.1.2-x64-setup.exe');
    expect(pick('darwin', 'arm64')).toBe('Allay-Motion-0.1.2-arm64.dmg');
    expect(pick('darwin', 'x64')).toBe('Allay-Motion-0.1.2-x64.dmg');
    expect(assetPattern('linux', 'x64')).toBeNull();
  });

  it('解析 SHA256SUMS.txt', () => {
    const h = 'a'.repeat(64);
    const sums = parseChecksums(`${h}  Allay-Motion-0.1.2-x64-setup.exe\r\n${'B'.repeat(64)}  other.dmg\n\nbad line`);
    expect(sums.get('Allay-Motion-0.1.2-x64-setup.exe')).toBe(h);
    expect(sums.get('other.dmg')).toBe('b'.repeat(64));
    expect(sums.size).toBe(2);
  });

  it('只访问 GitHub、GitCode 的 https 地址', () => {
    expect(() => checkUpdateUrl('https://api.github.com/repos/x/y/releases/latest')).not.toThrow();
    expect(() => checkUpdateUrl('https://release-assets.githubusercontent.com/a')).not.toThrow();
    expect(() => checkUpdateUrl('https://file-cdn.gitcode.com/a?auth_key=1')).not.toThrow();
    expect(() => checkUpdateUrl('http://github.com/a')).toThrow();
    expect(() => checkUpdateUrl('https://github.com:8443/a')).toThrow();
    expect(() => checkUpdateUrl('https://evil.example.com/a')).toThrow();
    expect(() => checkUpdateUrl('https://github.com.evil.example/a')).toThrow();
  });

  it('启动时清理：半成品和不比当前新的安装包可以删，更新的留着', () => {
    expect(staleDownload('Allay-Motion-0.1.2-x64-setup.exe.1b2c.part', '0.1.2')).toBe(true);
    expect(staleDownload('Allay-Motion-0.1.2-x64-setup.exe', '0.1.2')).toBe(true);
    expect(staleDownload('Allay-Motion-0.1.1-arm64.dmg', '0.1.2')).toBe(true);
    expect(staleDownload('Allay-Motion-0.1.3-x64-setup.exe', '0.1.2')).toBe(false);
    expect(staleDownload('notes.txt', '0.1.2')).toBe(false);
  });

  it('安装程序的临时空间检查：变量不被转义，空间不够时退出码 2', () => {
    const macro = spaceCheckMacro();
    expect(macro).toContain('${GetRoot} "$TEMP" $R9');
    expect(macro).toContain('${If} $R8 < 1024');
    expect(macro).toContain('（$R9）只剩 $R8 MB');
    expect(macro).not.toContain('$$R');
    expect(macro).toContain('SetErrorLevel 2');
  });

  it('旧设置文件没有 updates 时用默认值，坏掉的字段各自兜底', () => {
    expect(migrateSettingsFile({ formatVersion: 1 })?.ui.updates).toEqual({ mode: 'auto', source: 'auto', skipVersion: null });
    expect(migrateSettingsFile({ formatVersion: 1, ui: { updates: { mode: 'off', source: 'nope', skipVersion: 3 } } })?.ui.updates).toEqual({ mode: 'off', source: 'auto', skipVersion: null });
  });
});
