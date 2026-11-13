import { defineConfig } from 'vitest/config';

// 单元测试（Node 环境）。端到端测试在 tests/e2e，由 Playwright 跑；打包后的检查在 tests/dist。
export default defineConfig({
  test: {
    include: ['tests/unit/**/*.test.ts', 'apps/**/src/**/*.test.ts', 'packages/**/src/**/*.test.ts', 'scripts/**/*.test.ts'],
    exclude: ['**/node_modules/**', '**/out/**'],
    environment: 'node',
    testTimeout: 30_000,
  },
});
