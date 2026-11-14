// 固定的 FFmpeg 构建（docs/05-export.md 5.6、09-compliance.md 9.9）。
// 单独成文件：pnpm ffmpeg:fetch 用它下载和校验，第三方许可清单（scripts/third-party.ts）用它写明来源和版本。
export const FFMPEG_BUILD = {
  repo: 'FFmpeg-Builds/FFmpeg-Builds',
  tag: 'autobuild-2026-11-12-15-40',
  asset: 'ffmpeg-n9.0.2-57-gd838f9f9ae-win64-lgpl-9.0.zip',
  /** 与发布页 checksums.sha256 里的值一致 */
  sha256: '7a7d4b2adafe4b2de2a0fe0077a37e3d1dae43de28df38538ca79bc5d861e33e',
  /** zip 里的顶层目录 */
  root: 'ffmpeg-n9.0.2-57-gd838f9f9ae-win64-lgpl-9.0',
  platform: 'win32-x64',
  /** FFmpeg 本身的版本（git describe）和提交：取得对应源码用 */
  version: 'n9.0.2-57-gd838f9f9ae',
  commit: 'd838f9f9ae',
} as const;
