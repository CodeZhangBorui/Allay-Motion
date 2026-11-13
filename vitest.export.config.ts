import { defineConfig } from 'vitest/config';

// pnpm test:export：导出的编码与回读测试（docs/05-export.md 5.10）。用 pnpm ffmpeg:fetch 取回的固定 FFmpeg，不用 PATH 里的。
export default defineConfig({
  test: {
    include: ['tests/export/**/*.test.ts'],
    environment: 'node',
    globalSetup: ['tests/export/global-setup.ts'],
    testTimeout: 120_000,
    hookTimeout: 60_000,
    fileParallelism: false,
  },
});
