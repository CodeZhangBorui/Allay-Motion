// electron-builder 的 afterPack 钩子（docs/decisions.md M8）：在打成安装包之前，从解包目录里去掉不该分发的文件。
//
// electronDist 指向工作区里已安装的 Electron（为了打包不联网，decisions.md M0“打包不联网”），
// electron-builder 会把那个目录整个复制过来，其中有 Electron 自带的示例应用 resources/default_app.asar。
// 我们的应用只从 app.asar 加载（fuse OnlyLoadAppFromAsar），用不到它，带着它只是多一个可执行的入口。
// tests/dist/M8.package.test.ts 核对它不在解包目录和安装包里。
import { existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import process from 'node:process';

/** 解包目录下要删掉的文件（相对 appOutDir） */
export const REMOVE = ['resources/default_app.asar'];

/** @param {{ appOutDir: string }} context */
export default async function afterPack(context) {
  for (const rel of REMOVE) {
    const file = join(context.appOutDir, rel);
    if (existsSync(file)) {
      rmSync(file, { force: true });
      process.stdout.write(`  • after-pack: removed ${rel}\n`);
    }
  }
}
