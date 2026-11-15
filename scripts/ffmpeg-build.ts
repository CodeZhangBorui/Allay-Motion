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

/**
 * macOS 的 FFmpeg（docs/decisions.md“macOS 构建”）：FFmpeg-Builds 不出 macOS 版，找到的 macOS 预编译包都是 GPL 构建
 * （带 libx264 等），所以由 pnpm ffmpeg:fetch 在 macOS 上从官方源码 tarball 编译（scripts/ffmpeg-macos.ts）。
 * 每个源码包固定版本并校验 SHA-256；许可是 LGPLv3（--enable-version3，与 Windows 的 win64-lgpl 一致），
 * 外部库只有导出用到的 libvpx（VP9）和 libopus（Opus），都是 BSD-3-Clause，静态链接；H.264 用系统的 VideoToolbox。
 * 改这里任何一项都会改变 recipe 的哈希，缓存和已编译的产物随之失效、重新编译。
 */
export const FFMPEG_MACOS = {
  /** FFmpeg 本身的版本（官方发布 tarball） */
  version: '9.0.2',
  /** 最低系统版本：与 Electron 45 的要求（macOS 12）一致 */
  minMacos: '12.0',
  sources: [
    {
      name: 'ffmpeg',
      version: '9.0.2',
      url: 'https://ffmpeg.org/releases/ffmpeg-9.0.2.tar.xz',
      /** 2026-11-14 下载，与发布页的 .asc 签名核对过（FFmpeg release signing key FCF9 86EA 15E6 E293 A564 4F10 B432 2F04 D676 58D8） */
      sha256: '8c3850283eb25fa026482078a04051e0be17347b09ef81a0849bec15a96e002e',
      dir: 'ffmpeg-9.0.2',
      license: 'LGPL-3.0-or-later',
      licenseFiles: ['COPYING.LGPLv3', 'COPYING.GPLv3'],
    },
    {
      name: 'libvpx',
      version: '1.17.0',
      url: 'https://github.com/webmproject/libvpx/archive/refs/tags/v1.17.0.tar.gz',
      /** 2026-11-14 下载的 GitHub 标签归档 */
      sha256: '1020f184046187baa2985dbde38e0691f49c44088bca7a1842b0236c6081dc0a',
      dir: 'libvpx-1.17.0',
      license: 'BSD-3-Clause',
      licenseFiles: ['LICENSE', 'PATENTS'],
    },
    {
      name: 'opus',
      version: '1.6.1',
      url: 'https://downloads.xiph.org/releases/opus/opus-1.6.1.tar.gz',
      /** 与 downloads.xiph.org/releases/opus/SHA256SUMS.txt 一致 */
      sha256: '6ffcb593207be92584df15b32466ed64bbec99109f007c82205f0194572411a1',
      dir: 'opus-1.6.1',
      license: 'BSD-3-Clause',
      licenseFiles: ['COPYING'],
    },
  ],
  /**
   * FFmpeg 的 configure 参数（不含 --prefix、--arch 和编译器参数）。--disable-autodetect 关掉一切自动探测的外部库
   * （包括 Homebrew 里可能有的 lzma、sdl2、iconv 等），只显式打开下面几项；FFmpeg 自带的编解码器、封装、滤镜全部保留
   * （都是 LGPL，测试回读和 ffprobe 要用，与 Windows 的构建一致）。没有 --enable-gpl、--enable-nonfree。
   */
  configure: [
    '--enable-version3',
    '--disable-autodetect',
    '--enable-pthreads',
    '--enable-zlib',
    '--enable-videotoolbox',
    '--enable-audiotoolbox',
    '--enable-libvpx',
    '--enable-libopus',
    '--disable-network',
    '--disable-ffplay',
    '--disable-doc',
    '--disable-debug',
    '--disable-shared',
    '--enable-static',
  ],
} as const;

export type MacosArch = 'arm64' | 'x64';
