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
  // T-UI-5 的截图基线：由 pnpm test:e2e:baselines 在本机渲染（假原版层、纯色色块），登记为 origin: rendered
  snapshotPathTemplate: 'tests/fixtures/ui-baselines/{arg}{ext}',
});
