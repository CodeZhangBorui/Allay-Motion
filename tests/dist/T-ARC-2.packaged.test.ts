import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { listPackage } from '@electron/asar';
import { FuseState, FuseV1Options, getCurrentFuseWire } from '@electron/fuses';
import { describe, expect, it } from 'vitest';
import { DMG_PATTERN, IS_MAC, MAC_ZIP_PATTERN, RELEASE, macApp } from './platform';

// T-ARC-2（打包后）：fuses 与 1.6 第 8 条一致；安装包内容只有构建产物。
// 由 pnpm dist 在 electron-builder 之后运行。Windows 看 win-unpacked 和 NSIS 安装包，macOS 看 .app、dmg 和 zip。

const UNPACKED = join(RELEASE, 'win-unpacked');
/** fuses 所在的文件：Windows 是 exe；macOS 传 .app，@electron/fuses 自己找到 Electron Framework */
const fuseTarget = () => (IS_MAC ? macApp() : join(UNPACKED, 'AllayMotion.exe'));
const asarPath = () => (IS_MAC ? join(macApp(), 'Contents', 'Resources', 'app.asar') : join(UNPACKED, 'resources', 'app.asar'));

describe('T-ARC-2 打包后的应用', () => {
  it('打包产物存在（否则说明 pnpm dist 没跑完，而不是“跳过”）', () => {
    expect(existsSync(fuseTarget()), fuseTarget()).toBe(true);
    expect(existsSync(asarPath()), asarPath()).toBe(true);
    const files = readdirSync(RELEASE);
    if (IS_MAC) {
      expect(files.some((f) => DMG_PATTERN.test(f)), files.join(', ')).toBe(true);
      expect(files.some((f) => MAC_ZIP_PATTERN.test(f)), files.join(', ')).toBe(true);
    } else {
      expect(files.some((f) => /-x64-setup\.exe$/.test(f))).toBe(true);
    }
  });

  it('fuses 与 1.6 第 8 条一致', async () => {
    const wire = await getCurrentFuseWire(fuseTarget());
    const state = (o: FuseV1Options) => wire[o];
    expect(state(FuseV1Options.RunAsNode)).toBe(FuseState.DISABLE);
    expect(state(FuseV1Options.EnableNodeOptionsEnvironmentVariable)).toBe(FuseState.DISABLE);
    expect(state(FuseV1Options.EnableNodeCliInspectArguments)).toBe(FuseState.DISABLE);
    expect(state(FuseV1Options.OnlyLoadAppFromAsar)).toBe(FuseState.ENABLE);
    expect(state(FuseV1Options.EnableEmbeddedAsarIntegrityValidation)).toBe(FuseState.ENABLE);
    // 额外收紧的两项
    expect(state(FuseV1Options.EnableCookieEncryption)).toBe(FuseState.ENABLE);
    expect(state(FuseV1Options.GrantFileProtocolExtraPrivileges)).toBe(FuseState.DISABLE);
  });

  it('asar 里只有构建产物和 package.json，没有 node_modules 和源码', () => {
    const files = listPackage(asarPath(), { isPack: false }).map((f) => f.replace(/\\/g, '/'));
    expect(files).toContain('/package.json');
    expect(files).toContain('/out/main/index.js');
    expect(files).toContain('/out/preload/index.js');
    expect(files).toContain('/out/renderer/index.html');
    const unexpected = files.filter((f) => f !== '/package.json' && f !== '/out' && !f.startsWith('/out/'));
    expect(unexpected).toEqual([]);
    expect(files.some((f) => f.includes('node_modules'))).toBe(false);
    expect(files.some((f) => /\.(tsx?|map)$/.test(f))).toBe(false);
  });
});
