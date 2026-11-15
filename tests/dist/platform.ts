// 打包后检查（tests/dist）用到的路径：按当前机器打出来的那个包（scripts/dist.mjs 按当前机器选平台和架构）。
// Windows：release/win-unpacked/AllayMotion.exe 和 NSIS 安装包；macOS：release/mac-arm64（或 mac）/<产品名>.app、dmg 和 zip。
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

export const ROOT = resolve(import.meta.dirname, '../..');
export const RELEASE = join(ROOT, 'apps/desktop/release');
export const IS_MAC = process.platform === 'darwin';
export const IS_WIN = process.platform === 'win32';
/** resources/ffmpeg/ 下的平台目录 */
export const FFMPEG_TARGET = IS_MAC ? `darwin-${process.arch}` : 'win32-x64';

/** electron-builder 的 macOS 输出目录：x64 是 mac，arm64 是 mac-arm64 */
export const MAC_OUT = join(RELEASE, process.arch === 'arm64' ? 'mac-arm64' : 'mac');

/** 解包出来的 .app（找不到时抛错：说明 pnpm dist 没跑完，而不是“跳过”） */
export function macApp(): string {
  const name = existsSync(MAC_OUT) ? readdirSync(MAC_OUT).find((f) => f.endsWith('.app')) : undefined;
  if (!name) throw new Error(`${MAC_OUT} 里没有 .app（pnpm dist 没跑完）`);
  return join(MAC_OUT, name);
}

/** Info.plist 转成 JSON 读出来 */
export function macInfoPlist(app: string = macApp()): Record<string, unknown> {
  const r = spawnSync('plutil', ['-convert', 'json', '-o', '-', join(app, 'Contents', 'Info.plist')], { encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`plutil 失败：${r.stderr}`);
  return JSON.parse(r.stdout) as Record<string, unknown>;
}

/** 应用的可执行文件（Contents/MacOS/<CFBundleExecutable>） */
export function macExecutable(app: string = macApp()): string {
  return join(app, 'Contents', 'MacOS', String(macInfoPlist(app).CFBundleExecutable));
}

/** release 目录里文件名匹配的那一个产物 */
export function releaseFile(pattern: RegExp): string {
  const name = readdirSync(RELEASE).find((f) => pattern.test(f));
  if (!name) throw new Error(`${RELEASE} 里没有匹配 ${pattern} 的文件（pnpm dist 没跑完）`);
  return join(RELEASE, name);
}

export const DMG_PATTERN = new RegExp(`-${process.arch}\\.dmg$`);
export const MAC_ZIP_PATTERN = new RegExp(`-${process.arch}-mac\\.zip$`);
