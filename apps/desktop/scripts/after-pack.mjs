// electron-builder 的 afterPack 钩子（docs/decisions.md M8）：在打成安装包之前，从解包目录里去掉不该分发的文件。
//
// electronDist 指向工作区里已安装的 Electron（为了打包不联网，decisions.md M0“打包不联网”），
// electron-builder 会把那个目录整个复制过来，其中有 Electron 自带的示例应用 resources/default_app.asar
// （macOS 上在 <产品名>.app/Contents/Resources/ 下）。
// 我们的应用只从 app.asar 加载（fuse OnlyLoadAppFromAsar），用不到它，带着它只是多一个可执行的入口。
// tests/dist/M8.package.test.ts 核对它不在解包目录和安装包里。
// macOS 上这个钩子在 fuses 和签名之前运行，删掉文件不会破坏签名。
import { existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import process from 'node:process';

/** 解包目录下要删掉的文件（相对 appOutDir） */
export const REMOVE = ['resources/default_app.asar'];

/** macOS：相对 appOutDir 的路径，在 .app 包里 */
export function removeList(platform, productFilename) {
  return platform === 'darwin' || platform === 'mas' ? [`${productFilename}.app/Contents/Resources/default_app.asar`] : REMOVE;
}

/** @param {{ appOutDir: string, electronPlatformName: string, packager: { appInfo: { productFilename: string } } }} context */
export default async function afterPack(context) {
  for (const rel of removeList(context.electronPlatformName, context.packager.appInfo.productFilename)) {
    const file = join(context.appOutDir, rel);
    if (existsSync(file)) {
      rmSync(file, { force: true });
      process.stdout.write(`  • after-pack: removed ${rel}\n`);
    }
  }
}
