import { existsSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { listPackage } from '@electron/asar';
import { FuseState, FuseV1Options, getCurrentFuseWire } from '@electron/fuses';
import { describe, expect, it } from 'vitest';

// T-ARC-2（打包后）：fuses 与 1.6 第 8 条一致；安装包内容只有构建产物。
// 由 pnpm dist 在 electron-builder 之后运行。

const RELEASE = resolve(import.meta.dirname, '../../apps/desktop/release');
const UNPACKED = join(RELEASE, 'win-unpacked');
const EXE = join(UNPACKED, 'AllayMotion.exe');
const ASAR = join(UNPACKED, 'resources', 'app.asar');

describe('T-ARC-2 打包后的应用', () => {
  it('打包产物存在（否则说明 pnpm dist 没跑完，而不是“跳过”）', () => {
    expect(existsSync(EXE), EXE).toBe(true);
    expect(existsSync(ASAR), ASAR).toBe(true);
    expect(readdirSync(RELEASE).some((f) => /-x64-setup\.exe$/.test(f))).toBe(true);
  });

  it('fuses 与 1.6 第 8 条一致', async () => {
    const wire = await getCurrentFuseWire(EXE);
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
    const files = listPackage(ASAR, { isPack: false }).map((f) => f.replace(/\\/g, '/'));
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
