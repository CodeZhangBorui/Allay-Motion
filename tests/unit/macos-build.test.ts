import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { decodePng } from '../../scripts/mascot-bake/png';
import { FFMPEG_MACOS } from '../../scripts/ffmpeg-build';
import { ICNS_TYPES, icnsFromIco, readIcoPngs, upscale } from '../../scripts/icns';
import { recipeHash, REQUIRED_ENCODERS } from '../../scripts/ffmpeg-macos';

// macOS 构建（docs/decisions.md“macOS 构建”）里能在任何平台上核对的部分：FFmpeg 的配方、应用图标、electron-builder 的配置。
// 真正的编译、打包和启动在 CI 的 macOS 机器上跑（pnpm ffmpeg:fetch 的核对、tests/dist）。

const ROOT = resolve(import.meta.dirname, '../..');

describe('macOS 的 FFmpeg 配方', () => {
  it('LGPL：开 version3、关自动探测，没有 GPL 和 nonfree，也没有依赖 GPL 库的编码器', () => {
    const flags: readonly string[] = FFMPEG_MACOS.configure;
    expect(flags).toContain('--enable-version3');
    expect(flags).toContain('--disable-autodetect');
    for (const f of flags) expect(f).not.toMatch(/--enable-(gpl|nonfree|libx264|libx265|libxvid|libfdk|openssl)/);
    // 外部库只有 libvpx、libopus 和系统的 zlib、VideoToolbox、AudioToolbox
    expect(flags.filter((f) => f.startsWith('--enable-lib')).sort()).toEqual(['--enable-libopus', '--enable-libvpx']);
  });
  it('每个源码包固定版本、写死 SHA-256，许可都在允许范围内', () => {
    expect(FFMPEG_MACOS.sources.map((s) => s.name)).toEqual(['ffmpeg', 'libvpx', 'opus']);
    for (const s of FFMPEG_MACOS.sources) {
      expect(s.sha256).toMatch(/^[0-9a-f]{64}$/);
      expect(s.url).toMatch(/^https:\/\//);
      expect(s.url).toContain(s.version);
      expect(s.dir).toContain(s.version);
      expect(['LGPL-3.0-or-later', 'BSD-3-Clause']).toContain(s.license);
    }
    expect(FFMPEG_MACOS.sources[0]!.version).toBe(FFMPEG_MACOS.version);
  });
  it('编译后核对的编码器包括 docs/05-export.md 5.6 的六个和 macOS 的 H.264 系统编码器', () => {
    expect([...REQUIRED_ENCODERS].sort()).toEqual(['aac', 'h264_videotoolbox', 'libopus', 'libvpx-vp9', 'pcm_s16le', 'png', 'prores_ks']);
    expect(recipeHash()).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('macOS 的应用图标（从提交的 icon.ico 生成）', () => {
  const ico = readFileSync(join(ROOT, 'packages/mascot/generated/icon.ico'));
  it('icns 含 16–1024 各项，16–256 与 icon.ico 里的 PNG 逐字节相同，512、1024 是 256 的整数倍放大', () => {
    const icns = icnsFromIco(ico);
    expect(icns.toString('ascii', 0, 4)).toBe('icns');
    expect(icns.readUInt32BE(4)).toBe(icns.length);
    const fromIco = readIcoPngs(ico);
    const base = decodePng(fromIco.get(256)!);
    let pos = 8;
    const seen: string[] = [];
    while (pos < icns.length) {
      const type = icns.toString('ascii', pos, pos + 4);
      const len = icns.readUInt32BE(pos + 4);
      const png = icns.subarray(pos + 8, pos + len);
      const size = ICNS_TYPES.find(([t]) => t === type)![1];
      const img = decodePng(png);
      expect([img.width, img.height], type).toEqual([size, size]);
      if (size <= 256) expect(png.equals(fromIco.get(size)!), type).toBe(true);
      else expect(Buffer.from(img.data).equals(Buffer.from(upscale(base, size / 256).data)), type).toBe(true);
      seen.push(type);
      pos += len;
    }
    expect(seen).toEqual(ICNS_TYPES.map(([t]) => t));
  });
});

describe('electron-builder 的 macOS 配置', () => {
  const yml = readFileSync(join(ROOT, 'apps/desktop/electron-builder.yml'), 'utf8').replace(/\r\n/g, '\n');
  it('ad-hoc 签名、不开 hardened runtime、不公证；dmg 和 zip；不发布', () => {
    expect(yml).toMatch(/^mac:\n(?: {2}.*\n|\n)*? {2}identity: "-"$/m);
    expect(yml).toMatch(/^ {2}hardenedRuntime: false$/m);
    expect(yml).not.toMatch(/notarize/);
    expect(yml).toMatch(/^ {4}- dmg$/m);
    expect(yml).toMatch(/^ {4}- zip$/m);
    expect(yml).toMatch(/^publish: null$/m);
  });
  it('fuses 不因 macOS 放宽（1.6 第 8 条）', () => {
    for (const line of [
      'runAsNode: false',
      'enableNodeOptionsEnvironmentVariable: false',
      'enableNodeCliInspectArguments: false',
      'enableEmbeddedAsarIntegrityValidation: true',
      'onlyLoadAppFromAsar: true',
      'grantFileProtocolExtraPrivileges: false',
    ])
      expect(yml).toContain(`  ${line}\n`);
  });
  it('FFmpeg 按平台带上：Windows 是 win32-x64 的 ffmpeg.exe，macOS 是 darwin-<架构> 的 ffmpeg，都不带 ffprobe', () => {
    expect(yml).toMatch(/- from: \.\.\/\.\.\/resources\/ffmpeg\/win32-x64\n\s+to: ffmpeg\/win32-x64\n\s+filter:\n\s+- ffmpeg\.exe\n/);
    expect(yml).toMatch(/- from: \.\.\/\.\.\/resources\/ffmpeg\/darwin-\$\{arch\}\n\s+to: ffmpeg\/darwin-\$\{arch\}\n\s+filter:\n\s+- ffmpeg\n/);
    expect(yml).not.toMatch(/^\s+- ffprobe/m);
  });
});
