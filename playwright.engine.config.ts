import { defineConfig } from '@playwright/test';

// pnpm test:engine：引擎的渲染测试，在 Electron 自带的 Chromium 里跑真实的 WebGL2（窗口不显示）。
export default defineConfig({
  testDir: 'tests/engine',
  testMatch: '*.spec.ts',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 180_000,
  reporter: [['list']],
  outputDir: 'test-results/engine',
});
