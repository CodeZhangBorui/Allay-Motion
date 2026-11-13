// pnpm dist 的前置步骤：确认工作区里安装的 Electron 二进制已经在 apps/desktop/node_modules/electron/dist。
// electron-builder.yml 的 electronDist 指向那里，打包时直接用它，不再联网下载或校验 Electron。
//
// Electron 45 没有 postinstall，二进制在第一次 require('electron') 时才下载。所以这里：
// - 已经下载过：什么都不做（不联网）；
// - 还没下载：触发一次下载（这一步需要网络），失败时给出明确的报错。
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export const DESKTOP_DIR = resolve(import.meta.dirname, '../apps/desktop');

export interface ElectronDistState {
  packageDir: string;
  distDir: string;
  executable: string | null;
}

export function inspectElectronDist(desktopDir: string = DESKTOP_DIR): ElectronDistState {
  const requireFromDesktop = createRequire(join(desktopDir, 'package.json'));
  const packageDir = dirname(requireFromDesktop.resolve('electron/package.json'));
  const distDir = join(packageDir, 'dist');
  const pathFile = join(packageDir, 'path.txt');
  const relative = existsSync(pathFile) ? readFileSync(pathFile, 'utf8').trim() : '';
  const executable = relative && existsSync(join(distDir, relative)) ? join(distDir, relative) : null;
  return { packageDir, distDir, executable };
}

function main(): void {
  let state = inspectElectronDist();
  if (state.executable) {
    console.log(`ensure-electron-dist: 使用已安装的 Electron：${state.executable}`);
    return;
  }
  console.log('ensure-electron-dist: 工作区里的 Electron 二进制还没下载，现在下载一次（需要网络）…');
  try {
    // electron 包的入口在二进制缺失时会同步下载
    createRequire(join(DESKTOP_DIR, 'package.json'))('electron');
  } catch (error) {
    console.error(
      'ensure-electron-dist: Electron 二进制下载失败。请联网后在仓库根目录运行 `pnpm --filter @allay/desktop exec node node_modules/electron/install.js`，再重新 pnpm dist。',
    );
    console.error(error);
    process.exit(1);
  }
  state = inspectElectronDist();
  if (!state.executable) {
    console.error(`ensure-electron-dist: 下载后仍找不到 Electron 可执行文件（${state.distDir}）。`);
    process.exit(1);
  }
  console.log(`ensure-electron-dist: 已下载：${state.executable}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
