// 官网构建用的两个 Vite 插件。
//
// 1. virtual:allay-builtin-templates：用 pnpm templates:build 同一份打包函数（esbuild + 导入检查 + 确定性规则）
//    现场把 packages/templates/* 打成单文件 ESM，连同 manifest 一起交给页面。packages/templates 下多一个模板，
//    官网就多一个，不用改官网代码（tests/engine/vite.config.ts 用的是同一个办法）。
// 2. 方舟像素字体（兜底字形，OFL-1.1）以文本打进仿真器的代码块；OFL 要求随字体附带许可全文，
//    构建时把 resources/fonts/ark-pixel/OFL.txt 原样放进产物的 licenses/ 下。
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Plugin } from 'vite';
import { bundleTemplate, readTemplateManifest, templateDirs } from '../../../scripts/build-templates';

const VIRTUAL = 'virtual:allay-builtin-templates';
const ROOT = resolve(import.meta.dirname, '../../..');

export function builtinTemplates(): Plugin {
  return {
    name: 'allay-website-builtin-templates',
    resolveId: (id) => (id === VIRTUAL ? `\0${VIRTUAL}` : null),
    async load(id) {
      if (id !== `\0${VIRTUAL}`) return null;
      const out: { manifest: unknown; code: string }[] = [];
      for (const dir of templateDirs()) {
        const manifest = readTemplateManifest(dir);
        this.addWatchFile(resolve(dir, 'manifest.json'));
        this.addWatchFile(resolve(dir, 'src/index.ts'));
        out.push({ manifest, code: await bundleTemplate(dir) });
      }
      return `export default ${JSON.stringify(out)};`;
    },
  };
}

const FONT_LICENSE_PATH = 'licenses/ark-pixel-font-OFL.txt';
const fontLicenseText = () => readFileSync(resolve(ROOT, 'resources/fonts/ark-pixel/OFL.txt'), 'utf8');

export function fontLicense(): Plugin {
  return {
    name: 'allay-website-font-license',
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: FONT_LICENSE_PATH, source: fontLicenseText() });
    },
    // 开发服务器上也能点开
    configureServer(server) {
      server.middlewares.use(`/${FONT_LICENSE_PATH}`, (_req, res) => {
        res.setHeader('content-type', 'text/plain; charset=utf-8');
        res.end(fontLicenseText());
      });
    },
  };
}

/**
 * 构建产物的每张页面带一条内容安全策略：只允许同源和页面自己生成的 blob:/data:。
 * 这保证官网不会向任何第三方发请求（字体、脚本、图片都自托管），模板的 blob: 装载照常可用。
 * 只在构建时加：开发服务器的热更新要连 WebSocket。
 */
export const SITE_CSP = [
  "default-src 'self'",
  "script-src 'self' blob:",
  "worker-src 'self' blob:",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' blob: data:",
  "font-src 'self'",
  "connect-src 'self' blob: data:",
  "media-src 'self' blob:",
  "frame-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'none'",
].join('; ');

export function contentSecurityPolicy(): Plugin {
  return {
    name: 'allay-website-csp',
    apply: 'build',
    transformIndexHtml: () => [{ tag: 'meta', attrs: { 'http-equiv': 'Content-Security-Policy', content: SITE_CSP }, injectTo: 'head-prepend' }],
  };
}
