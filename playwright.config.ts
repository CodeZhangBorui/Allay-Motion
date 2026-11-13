import { defineConfig } from '@playwright/test';

// Playwright 驱动 Electron 的端到端测试。先 pnpm build，测试启动 apps/desktop/out 里的构建产物。
export default defineConfig({
  testDir: 'tests/e2e',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 60_000,
  reporter: [['list']],
  outputDir: 'test-results',
});
