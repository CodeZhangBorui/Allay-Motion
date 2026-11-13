import { defineConfig } from 'vitest/config';

// pnpm dist 之后运行：检查打包产物（T-ARC-2 的 fuses 部分）。
export default defineConfig({
  test: {
    include: ['tests/dist/**/*.test.ts'],
    environment: 'node',
    testTimeout: 60_000,
  },
});
