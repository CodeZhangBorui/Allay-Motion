import { resolve } from 'node:path';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vite';
import { builtinTemplates, contentSecurityPolicy, mascotAssets, preloadFonts, websiteMc } from './build/plugins';

const here = import.meta.dirname;

// 官网：纯静态单页应用（index.html），与桌面应用解耦，只复用共享包（@allay/engine、@allay/ui、@allay/mascot 等）。
// base 用相对路径，产物可以放在任何子路径下静态托管。
export default defineConfig({
  root: here,
  base: './',
  plugins: [tailwindcss(), builtinTemplates(), websiteMc(), mascotAssets(), preloadFonts(), contentSecurityPolicy()],
  // 引擎 Worker 是 module worker（docs/02-engine.md 2.2）
  worker: { format: 'es' },
  resolve: {
    dedupe: ['react', 'react-dom', 'i18next', 'react-i18next', 'comlink', '@base-ui/react', '@phosphor-icons/react'],
  },
  build: {
    outDir: resolve(here, 'dist'),
    emptyOutDir: true,
    target: 'es2023',
    // 字体等资源保持独立文件，不内联成 data:
    assetsInlineLimit: 0,
    chunkSizeWarningLimit: 4096,
    rollupOptions: {
      input: { index: resolve(here, 'index.html') },
      // Base UI 的 'use client' 指令对纯客户端页面没有意义
      onwarn(warning, warn) {
        if (warning.code === 'MODULE_LEVEL_DIRECTIVE') return;
        warn(warning);
      },
    },
  },
  server: { port: 5180, strictPort: true, host: 'localhost', fs: { allow: [resolve(here, '../..')] } },
  preview: { port: 4180, strictPort: true, host: 'localhost' },
});
