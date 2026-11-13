// 把启动画面的静态页面放进渲染进程的构建产物（out/renderer/splash/），开发服务器上同样提供。
// 开发服务器另外提供 /mascot/（packages/mascot/generated 的烘焙产物）；构建时不带它们，
// 打包后由主进程从安装目录的 resources/mascot 提供（docs/decisions.md M5b）。
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { Plugin } from 'vite';
import { splashFiles } from './generate';

const MASCOT_FILE = /^\/mascot\/([a-z0-9.-]+\.(?:png|json))$/;

/** repoRoot：仓库根目录（由 Vite 配置传入；这个文件会被打进配置，不能靠 import.meta.dirname 找路径） */
export function splashPages(repoRoot: string): Plugin {
  const MASCOT_DIR = resolve(repoRoot, 'packages/mascot/generated');
  return {
    name: 'allay-splash-pages',
    generateBundle() {
      for (const [fileName, source] of splashFiles(repoRoot)) this.emitFile({ type: 'asset', fileName, source });
    },
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const path = (req.url ?? '').split('?')[0]!;
        const page = splashFiles(repoRoot).get(path.slice(1));
        if (page !== undefined) {
          res.setHeader('Content-Type', path.endsWith('.css') ? 'text/css; charset=utf-8' : 'text/html; charset=utf-8');
          res.end(page);
          return;
        }
        const m = MASCOT_FILE.exec(path);
        if (m && existsSync(join(MASCOT_DIR, m[1]!))) {
          res.setHeader('Content-Type', m[1]!.endsWith('.png') ? 'image/png' : 'application/json; charset=utf-8');
          res.end(readFileSync(join(MASCOT_DIR, m[1]!)));
          return;
        }
        if (m) {
          res.statusCode = 404;
          res.end();
          return;
        }
        next();
      });
    },
  };
}
