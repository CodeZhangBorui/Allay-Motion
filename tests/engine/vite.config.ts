import { resolve } from 'node:path';
import { defineConfig } from 'vite';

// test:engine 的测试页：把引擎 Worker、EngineHost 和测试模板打包到 tests/engine/out/。
export default defineConfig({
  root: resolve(import.meta.dirname, 'harness'),
  base: './',
  logLevel: 'warn',
  build: {
    outDir: resolve(import.meta.dirname, 'out'),
    emptyOutDir: true,
    assetsInlineLimit: 0,
    target: 'es2023',
  },
  worker: { format: 'es' },
});
