import { defineConfig } from '@playwright/test';

// pnpm test:website：官网的冒烟测试。先构建官网，再用 vite preview 起本机服务，在 Electron 自带的 Chromium 里打开（窗口不显示）。
export default defineConfig({
  testDir: 'tests/website',
  testMatch: '*.spec.ts',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 120_000,
  reporter: [['list']],
  outputDir: 'test-results/website',
  webServer: {
    command: 'pnpm --filter @allay/website preview',
    url: 'http://localhost:4180/',
    reuseExistingServer: true,
    timeout: 60_000,
  },
});
