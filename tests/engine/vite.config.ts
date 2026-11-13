import { resolve } from 'node:path';
import { defineConfig, type Plugin } from 'vite';
import { bundleTemplate, readTemplateManifest, templateDirs } from '../../scripts/build-templates';

const VIRTUAL = 'virtual:builtin-templates';

/**
 * 内置模板的代码：用 pnpm templates:build 同一份打包函数（esbuild + 导入检查）现场打包，
 * 测的就是装进 .allaytpl 的那份代码（docs/04-templates.md 4.9）。
 */
function builtinTemplates(): Plugin {
  return {
    name: 'allay-builtin-templates',
    resolveId: (id) => (id === VIRTUAL ? `\0${VIRTUAL}` : null),
    async load(id) {
      if (id !== `\0${VIRTUAL}`) return null;
      const out: Record<string, { manifest: unknown; code: string }> = {};
      for (const dir of templateDirs()) {
        const manifest = readTemplateManifest(dir);
        this.addWatchFile(resolve(dir, 'manifest.json'));
        out[manifest.id] = { manifest, code: await bundleTemplate(dir) };
      }
      return `export default ${JSON.stringify(out)};`;
    },
  };
}

// test:engine 的测试页：把引擎 Worker、EngineHost、内置模板和测试模板打包到 tests/engine/out/。
export default defineConfig({
  root: resolve(import.meta.dirname, 'harness'),
  base: './',
  logLevel: 'warn',
  plugins: [builtinTemplates()],
  build: {
    outDir: resolve(import.meta.dirname, 'out'),
    emptyOutDir: true,
    assetsInlineLimit: 0,
    target: 'es2023',
  },
  worker: { format: 'es' },
});
