// pnpm ffmpeg:fetch：下载固定版本的 FFmpeg 构建并校验 SHA-256，放到 resources/ffmpeg/<平台>/（docs/05-export.md 5.6、09-compliance.md 9.9）。
// 二进制不进仓库（.gitignore 已排除 resources/ffmpeg/）。
//
// - Windows 渠道：FFmpeg-Builds，变体 win64-lgpl（LGPLv3），发布分支 9.0 的构建，固定到具体的发布标签。
// - macOS：从官方源码按 LGPL 配置编译（scripts/ffmpeg-macos.ts），见 scripts/ffmpeg-build.ts 的 FFMPEG_MACOS。
// - 已经取回且校验过（stamp 文件一致、文件都在）时直接退出，不联网。
// - 发布页上的 autobuild 会被定期清理；资源不在了的话可以用 --from <zip> 指定本机的同一个 zip（仍然校验 SHA-256）。
import { createHash } from 'node:crypto';
import { createWriteStream, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { Readable } from 'node:stream';
import type { ReadableStream as WebReadableStream } from 'node:stream/web';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';
import yauzl from 'yauzl';

import { FFMPEG_BUILD } from './ffmpeg-build';

export { FFMPEG_BUILD };

/** 从 zip 里取出的文件 → 放到目标目录下的名字 */
const FILES: Record<string, string> = {
  'bin/ffmpeg.exe': 'ffmpeg.exe',
  'bin/ffprobe.exe': 'ffprobe.exe',
  'LICENSE.txt': 'LICENSE.txt',
};

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const FFMPEG_DIR = join(ROOT, 'resources', 'ffmpeg', FFMPEG_BUILD.platform);
const STAMP = join(FFMPEG_DIR, 'build.json');

function downloadUrl(): string {
  return `https://github.com/${FFMPEG_BUILD.repo}/releases/download/${FFMPEG_BUILD.tag}/${FFMPEG_BUILD.asset}`;
}

function alreadyFetched(): boolean {
  if (!existsSync(STAMP)) return false;
  try {
    const stamp = JSON.parse(readFileSync(STAMP, 'utf8')) as { sha256?: string };
    return stamp.sha256 === FFMPEG_BUILD.sha256 && Object.values(FILES).every((f) => existsSync(join(FFMPEG_DIR, f)));
  } catch {
    return false;
  }
}

async function sha256Of(path: string): Promise<string> {
  const hash = createHash('sha256');
  const { createReadStream } = await import('node:fs');
  await pipeline(createReadStream(path), hash);
  return hash.digest('hex');
}

async function download(dest: string): Promise<void> {
  const url = downloadUrl();
  console.log(`[ffmpeg:fetch] 下载 ${url}`);
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok || !res.body) throw new Error(`下载失败：HTTP ${res.status}。这个 autobuild 可能已被清理，可以用 --from <zip> 指定本机的同一个文件。`);
  await pipeline(Readable.fromWeb(res.body as WebReadableStream<Uint8Array>), createWriteStream(dest));
}

function extract(zipPath: string, outDir: string): Promise<void> {
  return new Promise((resolvePromise, reject) => {
    yauzl.open(zipPath, { lazyEntries: true }, (err, zip) => {
      if (err || !zip) return reject(err ?? new Error('cannot open zip'));
      const wanted = new Map(Object.entries(FILES).map(([src, dst]) => [`${FFMPEG_BUILD.root}/${src}`, dst]));
      const found = new Set<string>();
      zip.on('entry', (entry: yauzl.Entry) => {
        const dst = wanted.get(entry.fileName);
        if (!dst) return zip.readEntry();
        zip.openReadStream(entry, (e, stream) => {
          if (e || !stream) return reject(e ?? new Error('cannot read entry'));
          pipeline(stream, createWriteStream(join(outDir, dst)))
            .then(() => {
              found.add(dst);
              zip.readEntry();
            })
            .catch(reject);
        });
      });
      zip.on('end', () => {
        const missing = [...wanted.values()].filter((f) => !found.has(f));
        if (missing.length) reject(new Error(`zip 里缺少：${missing.join(', ')}`));
        else resolvePromise();
      });
      zip.on('error', reject);
      zip.readEntry();
    });
  });
}

async function main(): Promise<void> {
  // macOS：没有可用的 LGPL 预编译包，从官方源码编译（scripts/ffmpeg-macos.ts，docs/decisions.md“macOS 构建”）
  if (process.platform === 'darwin' && (process.arch === 'arm64' || process.arch === 'x64')) {
    const { buildFfmpegMacos } = await import('./ffmpeg-macos');
    await buildFfmpegMacos(join(ROOT, 'resources', 'ffmpeg', `darwin-${process.arch}`), process.arch);
    return;
  }
  if (`${process.platform}-${process.arch}` !== FFMPEG_BUILD.platform) {
    throw new Error(`只固定了 ${FFMPEG_BUILD.platform} 和 macOS（arm64、x64）的构建，当前是 ${process.platform}-${process.arch}`);
  }
  if (alreadyFetched()) {
    console.log(`[ffmpeg:fetch] 已就位：${FFMPEG_DIR}（${FFMPEG_BUILD.asset}，SHA-256 已校验），不联网。`);
    return;
  }
  const fromIdx = process.argv.indexOf('--from');
  const local = fromIdx >= 0 ? process.argv[fromIdx + 1] : undefined;
  const tmp = join(tmpdir(), `allay-ffmpeg-${process.pid}.zip`);
  const zipPath = local ? resolve(local) : tmp;
  try {
    if (!local) await download(tmp);
    const actual = await sha256Of(zipPath);
    if (actual !== FFMPEG_BUILD.sha256) throw new Error(`SHA-256 不符：期望 ${FFMPEG_BUILD.sha256}，实际 ${actual}`);
    rmSync(FFMPEG_DIR, { recursive: true, force: true });
    mkdirSync(FFMPEG_DIR, { recursive: true });
    await extract(zipPath, FFMPEG_DIR);
    writeFileSync(
      STAMP,
      `${JSON.stringify({ ...FFMPEG_BUILD, url: downloadUrl(), license: 'LGPL-3.0-or-later', source: `https://github.com/${FFMPEG_BUILD.repo}` }, null, 2)}\n`,
    );
    console.log(`[ffmpeg:fetch] 完成：${FFMPEG_DIR}`);
  } finally {
    if (!local) rmSync(tmp, { force: true });
  }
}

main().catch((error: unknown) => {
  console.error(`[ffmpeg:fetch] 失败：${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
