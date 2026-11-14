// macOS 上的 pnpm ffmpeg:fetch（docs/decisions.md“macOS 构建”）：从官方源码按 LGPL 配置编译 FFmpeg，
// 放到 resources/ffmpeg/darwin-<arch>/（ffmpeg、ffprobe、LICENSE.txt、build.json），和 Windows 的目录结构一样。
//
// - 源码：scripts/ffmpeg-build.ts 的 FFMPEG_MACOS，每个 tarball 固定版本并校验 SHA-256，校验不过就停。
// - libvpx、libopus 编成静态库，链进 ffmpeg；ffmpeg 只依赖系统库和系统框架（编译后用 otool -L 核对）。
// - 编译完核对：没有 GPL/nonfree、许可是 LGPL v3、导出要用的编码器都在、架构对、动态依赖只有系统的。
//   已编译过（build.json 的 recipe 哈希一致、文件都在）时只重跑这些核对，不联网、不重新编译（CI 用缓存时走这里）。
// - 只在 macOS 上运行，编译要 Xcode 命令行工具（clang、make）和 pkg-config；x64 还要 nasm（汇编优化）。
import { createHash } from 'node:crypto';
import { spawnSync, type SpawnSyncOptions } from 'node:child_process';
import { createReadStream, createWriteStream, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { ReadableStream as WebReadableStream } from 'node:stream/web';

import { FFMPEG_MACOS, type MacosArch } from './ffmpeg-build';

/** 应用依赖的编码器（docs/05-export.md 5.6），加上 macOS 的 H.264 编码器 */
export const REQUIRED_ENCODERS = ['prores_ks', 'png', 'libvpx-vp9', 'aac', 'libopus', 'pcm_s16le', 'h264_videotoolbox'] as const;

/** recipe 的哈希：源码、configure 参数、最低系统版本有任何变化都会变 */
export function recipeHash(): string {
  return createHash('sha256').update(JSON.stringify(FFMPEG_MACOS)).digest('hex');
}

const lipoArch = (arch: MacosArch) => (arch === 'arm64' ? 'arm64' : 'x86_64');

function run(cmd: string, args: string[], opts: SpawnSyncOptions = {}): void {
  console.log(`[ffmpeg:fetch] $ ${cmd} ${args.join(' ')}`);
  const r = spawnSync(cmd, args, { stdio: 'inherit', ...opts });
  if (r.status !== 0) throw new Error(`${cmd} 失败（退出码 ${r.status ?? r.signal}）`);
}

function capture(cmd: string, args: string[]): string {
  const r = spawnSync(cmd, args, { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
  if (r.status !== 0) throw new Error(`${cmd} ${args.join(' ')} 失败：${r.stderr}`);
  return `${r.stdout}${r.stderr}`;
}

async function sha256Of(path: string): Promise<string> {
  const hash = createHash('sha256');
  await pipeline(createReadStream(path), hash);
  return hash.digest('hex');
}

async function download(url: string, dest: string): Promise<void> {
  console.log(`[ffmpeg:fetch] 下载 ${url}`);
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok || !res.body) throw new Error(`下载失败：HTTP ${res.status}（${url}）`);
  await pipeline(Readable.fromWeb(res.body as WebReadableStream<Uint8Array>), createWriteStream(dest));
}

/** 编译后的核对。任何一项不过就抛错（不分发许可不对或依赖了非系统库的二进制） */
export function verifyBuild(outDir: string, arch: MacosArch): void {
  const ffmpeg = join(outDir, 'ffmpeg');
  const ffprobe = join(outDir, 'ffprobe');
  for (const bin of [ffmpeg, ffprobe]) {
    const archs = capture('lipo', ['-archs', bin]).trim();
    if (archs !== lipoArch(arch)) throw new Error(`${bin} 的架构是 ${archs}，应为 ${lipoArch(arch)}`);
    // otool -L 的第一行是文件名，之后每行一个依赖
    const deps = capture('otool', ['-L', bin])
      .split('\n')
      .slice(1)
      .map((l) => l.trim().split(' ')[0] ?? '')
      .filter(Boolean);
    const foreign = deps.filter((d) => !d.startsWith('/usr/lib/') && !d.startsWith('/System/Library/'));
    if (foreign.length) throw new Error(`${bin} 依赖了非系统的动态库：${foreign.join(', ')}`);
  }
  const version = capture(ffmpeg, ['-hide_banner', '-version']);
  for (const bad of ['--enable-gpl', '--enable-nonfree']) if (version.includes(bad)) throw new Error(`configure 里有 ${bad}：不是 LGPL 构建`);
  const license = capture(ffmpeg, ['-hide_banner', '-L']);
  if (!/GNU Lesser General Public License/.test(license) || !/version 3/.test(license)) throw new Error(`ffmpeg -L 不是 LGPL v3：\n${license}`);
  const encoders = capture(ffmpeg, ['-hide_banner', '-encoders']);
  const missing = REQUIRED_ENCODERS.filter((e) => !new RegExp(`^\\s*[VAS.][F.][S.][X.][B.][D.]\\s+${e.replace(/[-]/g, '\\-')}\\s`, 'm').test(encoders));
  if (missing.length) throw new Error(`缺少编码器：${missing.join(', ')}`);
  console.log(`[ffmpeg:fetch] 核对通过：${version.split('\n')[0]}；LGPL v3；编码器齐全；只依赖系统库`);
}

function alreadyBuilt(outDir: string, arch: MacosArch): boolean {
  const stamp = join(outDir, 'build.json');
  if (!existsSync(stamp)) return false;
  try {
    const s = JSON.parse(readFileSync(stamp, 'utf8')) as { recipe?: string; arch?: string };
    return s.recipe === recipeHash() && s.arch === arch && ['ffmpeg', 'ffprobe', 'LICENSE.txt'].every((f) => existsSync(join(outDir, f)));
  } catch {
    return false;
  }
}

/** LICENSE.txt：FFmpeg 的 LGPLv3（及其引用的 GPLv3）全文，加上静态链进去的 libvpx、libopus 的许可（BSD 要求随二进制附带） */
function licenseText(srcRoot: string): string {
  const parts: string[] = [
    `FFmpeg ${FFMPEG_MACOS.version} for macOS, built from the official source release by this project's build script`,
    '(scripts/ffmpeg-macos.ts in the source repository). This build is licensed under the GNU Lesser General Public',
    'License version 3 or later (configured with --enable-version3; no --enable-gpl, no --enable-nonfree).',
    'It statically links libvpx and libopus, whose BSD licenses are reproduced below.',
    '',
    'Sources (SHA-256):',
    ...FFMPEG_MACOS.sources.map((s) => `  ${s.name} ${s.version}: ${s.url} (${s.sha256}) — ${s.license}`),
    '',
  ];
  for (const s of FFMPEG_MACOS.sources) {
    for (const f of s.licenseFiles) {
      parts.push('='.repeat(78), `${s.name} ${s.version} — ${f}`, '='.repeat(78), '', readFileSync(join(srcRoot, s.dir, f), 'utf8').replace(/\r\n?/g, '\n').trim(), '');
    }
  }
  return `${parts.join('\n')}\n`;
}

export async function buildFfmpegMacos(outDir: string, arch: MacosArch): Promise<void> {
  if (process.platform !== 'darwin') throw new Error('scripts/ffmpeg-macos.ts 只在 macOS 上运行');
  if (alreadyBuilt(outDir, arch)) {
    console.log(`[ffmpeg:fetch] 已编译：${outDir}（recipe ${recipeHash().slice(0, 12)}），不联网、不重新编译，只重跑核对。`);
    verifyBuild(outDir, arch);
    return;
  }
  const work = join(tmpdir(), `allay-ffmpeg-macos-${process.pid}`);
  const src = join(work, 'src');
  const prefix = join(work, 'prefix');
  rmSync(work, { recursive: true, force: true });
  mkdirSync(src, { recursive: true });
  try {
    for (const s of FFMPEG_MACOS.sources) {
      const file = join(work, s.url.split('/').pop()!);
      await download(s.url, file);
      const actual = await sha256Of(file);
      if (actual !== s.sha256) throw new Error(`${s.name} 的 SHA-256 不符：期望 ${s.sha256}，实际 ${actual}`);
      run('tar', ['-xf', file, '-C', src]);
      if (!existsSync(join(src, s.dir))) throw new Error(`解压后没有 ${s.dir}`);
    }
    const dirOf = (name: (typeof FFMPEG_MACOS.sources)[number]['name']) => join(src, FFMPEG_MACOS.sources.find((s) => s.name === name)!.dir);
    const jobs = capture('sysctl', ['-n', 'hw.ncpu']).trim() || '4';
    const min = `-mmacosx-version-min=${FFMPEG_MACOS.minMacos}`;
    const env = { ...process.env, MACOSX_DEPLOYMENT_TARGET: FFMPEG_MACOS.minMacos, PKG_CONFIG_PATH: join(prefix, 'lib', 'pkgconfig'), PKG_CONFIG_LIBDIR: join(prefix, 'lib', 'pkgconfig') };

    // libvpx：只要库（VP9 编码器），静态、位置无关
    const vpx = dirOf('libvpx');
    run(
      './configure',
      [`--prefix=${prefix}`, `--target=${arch === 'arm64' ? 'arm64' : 'x86_64'}-darwin21-gcc`, '--enable-static', '--disable-shared', '--enable-pic', '--disable-examples', '--disable-tools', '--disable-docs', '--disable-unit-tests', `--extra-cflags=${min}`],
      { cwd: vpx, env },
    );
    run('make', [`-j${jobs}`], { cwd: vpx, env });
    run('make', ['install'], { cwd: vpx, env });

    // libopus
    const opus = dirOf('opus');
    run('./configure', [`--prefix=${prefix}`, '--enable-static', '--disable-shared', '--with-pic', '--disable-doc', '--disable-extra-programs', `CFLAGS=-O2 ${min}`], { cwd: opus, env });
    run('make', [`-j${jobs}`], { cwd: opus, env });
    run('make', ['install'], { cwd: opus, env });

    // FFmpeg
    const ff = dirOf('ffmpeg');
    run(
      './configure',
      [
        `--prefix=${prefix}`,
        `--arch=${lipoArch(arch)}`,
        '--cc=clang',
        ...FFMPEG_MACOS.configure,
        '--pkg-config-flags=--static',
        `--extra-cflags=${min} -I${join(prefix, 'include')}`,
        `--extra-ldflags=${min} -L${join(prefix, 'lib')}`,
      ],
      { cwd: ff, env },
    );
    run('make', [`-j${jobs}`], { cwd: ff, env });

    rmSync(outDir, { recursive: true, force: true });
    mkdirSync(outDir, { recursive: true });
    for (const bin of ['ffmpeg', 'ffprobe']) {
      writeFileSync(join(outDir, bin), readFileSync(join(ff, bin)), { mode: 0o755 });
      run('strip', ['-x', join(outDir, bin)]);
    }
    writeFileSync(join(outDir, 'LICENSE.txt'), licenseText(src));
    verifyBuild(outDir, arch);
    const versionLine = capture(join(outDir, 'ffmpeg'), ['-hide_banner', '-version']).split('\n')[0]?.trim();
    writeFileSync(
      join(outDir, 'build.json'),
      `${JSON.stringify(
        {
          platform: `darwin-${arch}`,
          arch,
          version: FFMPEG_MACOS.version,
          versionLine,
          license: 'LGPL-3.0-or-later',
          recipe: recipeHash(),
          minMacos: FFMPEG_MACOS.minMacos,
          configure: FFMPEG_MACOS.configure,
          sources: FFMPEG_MACOS.sources.map(({ name, version, url, sha256, license }) => ({ name, version, url, sha256, license })),
          buildScript: 'scripts/ffmpeg-macos.ts',
        },
        null,
        2,
      )}\n`,
    );
    console.log(`[ffmpeg:fetch] 完成：${outDir}`);
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}
