#!/usr/bin/env node
// 在 GitCode 流水线上运行（.gitcode/workflows/pull-release-assets.yml，docs/gitcode-mirror.md）：
// 从 GitHub 的公开下载地址拉取发行版的附件，传进 GitCode 上同名的发行版。传进 GitCode 在国内完成，
// 不再从 GitHub 的机器跨境上传（2026-11-14：那样一个 150 MB 的安装包 50 分钟都传不完）。
//
// - 发行版本身（名称、说明、“最新版本”标记）由 GitHub Actions 上的 scripts/sync-gitcode-release.mjs 建好；这里只补附件。
// - 要传哪些文件、每个文件的 SHA-256 都以 GitHub 上同一版本的 SHA256SUMS.txt 为准（它本身也传上去）。
//   不调 GitHub 的 API（共享机器的 IP 很容易撞上未登录的限流），只用 github.com/<仓库>/releases/download/ 的公开地址。
// - 令牌：优先用仓库密钥 GITCODE_TOKEN（个人令牌），没有时用流水线自动生成的 ATOMGIT_TOKEN。
import { createHash } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';
import { attachment, CHECKSUMS_NAME, createGitcodeUploader, digestOf, GITCODE_API, mib, orderAssets, pool, sleep } from './gitcode-uploader.mjs';

/** SHA256SUMS.txt：每行“<64 位十六进制>  <文件名>” */
export function parseChecksums(text) {
  const out = [];
  for (const line of text.split(/\r?\n/)) {
    const m = /^([0-9a-fA-F]{64})\s+\*?(.+?)\s*$/.exec(line);
    if (m && /^[\w.-]+$/.test(m[2])) out.push({ name: m[2], sha256: m[1].toLowerCase() });
  }
  return out;
}

export function createPuller({
  githubRepo, gitcodeRepo, gitcodeToken, apiBase = GITCODE_API, authHeader = false,
  downloadConcurrency = 3,
  // 这么久收不到一个字节就放弃这次下载、重试
  downloadIdleMs = 5 * 60 * 1000,
  downloadAttempts = 3,
  downloadRetryDelayMs = 5000,
  progressLogMs = 60_000,
  pollMs = 60_000,
  ...uploaderOptions
}) {
  if (!/^[\w.-]+\/[\w.-]+$/.test(githubRepo || '')) throw new Error('GH_REPO 必须是 owner/repo');
  const uploader = createGitcodeUploader({ gitcodeRepo, gitcodeToken, apiBase, authHeader, userAgent: 'Allay-Motion-GitCode-Pull', ...uploaderOptions });
  const download = (tag, name) => `https://github.com/${githubRepo}/releases/download/${encodeURIComponent(tag)}/${encodeURIComponent(name)}`;

  /** GitHub 上这个版本的 SHA256SUMS.txt；还没发布（404）时为 null */
  async function checksums(tag) {
    const response = await uploader.request(download(tag, CHECKSUMS_NAME), { headers: { 'User-Agent': 'Allay-Motion-GitCode-Pull' } });
    if (response.status === 404) {
      await response.body?.cancel();
      return null;
    }
    if (!response.ok) throw new Error(`读取 GitHub 上 ${tag} 的 ${CHECKSUMS_NAME} 失败：HTTP ${response.status}`);
    return response.text();
  }

  /** 下载到 file 并核对 SHA-256，返回字节数 */
  async function downloadOnce(tag, name, sha256, file) {
    const label = `${tag}/${name}`;
    const abort = new AbortController();
    let idle = null;
    const kick = () => {
      clearTimeout(idle);
      idle = setTimeout(() => abort.abort(), downloadIdleMs);
    };
    const started = Date.now();
    let bytes = 0;
    let total = 0;
    const progress = setInterval(() => {
      const rate = bytes / 1024 / Math.max(1, (Date.now() - started) / 1000);
      console.log(`[GitHub] 下载 ${label}：${mib(bytes)}${total ? ` / ${mib(total)}` : ''} MiB，平均 ${rate.toFixed(0)} KiB/s`);
    }, progressLogMs);
    progress.unref?.();
    try {
      kick();
      let response;
      try {
        response = await fetch(download(tag, name), { headers: { 'User-Agent': 'Allay-Motion-GitCode-Pull' }, signal: abort.signal });
      } catch {
        throw new Error(abort.signal.aborted ? `${Math.round(downloadIdleMs / 1000)} 秒没有进度` : '连接失败');
      }
      if (!response.ok || !response.body) throw new Error(`HTTP ${response.status}`);
      total = Number(response.headers.get('content-length')) || 0;
      const hash = createHash('sha256');
      const meter = new Transform({
        transform(chunk, _encoding, callback) {
          bytes += chunk.length;
          hash.update(chunk);
          kick();
          callback(null, chunk);
        },
      });
      try {
        await pipeline(Readable.fromWeb(response.body), meter, createWriteStream(file));
      } catch {
        throw new Error(abort.signal.aborted ? `${Math.round(downloadIdleMs / 1000)} 秒没有进度` : '下载中断');
      }
      if (hash.digest('hex') !== sha256) throw new Error('SHA-256 与 SHA256SUMS.txt 不一致');
      const seconds = Math.max(1, (Date.now() - started) / 1000);
      console.log(`[GitHub] 已下载 ${label}（${mib(bytes)} MiB），用时 ${Math.round(seconds)} 秒，平均 ${(bytes / 1024 / seconds).toFixed(0)} KiB/s`);
      return bytes;
    } finally {
      clearTimeout(idle);
      clearInterval(progress);
    }
  }

  async function downloadFile(tag, name, sha256, file) {
    for (let attempt = 1; ; attempt++) {
      try {
        return await downloadOnce(tag, name, sha256, file);
      } catch (error) {
        await rm(file, { force: true });
        if (attempt >= downloadAttempts) throw new Error(`下载 ${tag}/${name} 失败（${error.message}），已试 ${attempt} 次`, { cause: error });
        console.log(`[GitHub] 下载 ${tag}/${name} 失败（${error.message}），第 ${attempt + 1} 次尝试`);
        await sleep(downloadRetryDelayMs * attempt);
      }
    }
  }

  /**
   * 补齐 GitCode 上 tag 这个发行版的附件。返回 'done'、'not-published'（GitHub 上还没有 SHA256SUMS.txt）
   * 或 'no-release'（GitCode 上还没有这个发行版，等 GitHub Actions 建好）
   */
  async function syncTag(tag, current = null) {
    current ??= await uploader.gitcodeRelease(tag);
    if (!current) return 'no-release';
    const sumsText = await checksums(tag);
    if (sumsText === null) return 'not-published';
    const wanted = [
      ...parseChecksums(sumsText),
      { name: CHECKSUMS_NAME, sha256: createHash('sha256').update(sumsText).digest('hex'), text: sumsText },
    ];
    const missing = [];
    for (const item of wanted) {
      const existing = attachment(current, item.name);
      if (!existing) {
        missing.push(item);
        continue;
      }
      if (digestOf(existing.digest) !== item.sha256) {
        throw new Error(`${tag}/${item.name} 在 GitCode 上的摘要与 GitHub 的 SHA256SUMS.txt 不一致；请检查并手动处理 GitCode 同名附件后重试`);
      }
    }
    if (!missing.length) {
      console.log(`[GitCode] ${tag} 的 ${wanted.length} 个附件都已就绪`);
      return 'done';
    }
    console.log(`[GitCode] ${tag} 要补 ${missing.length} 个附件：${missing.map((m) => m.name).join('、')}；同时处理 ${downloadConcurrency} 个`);
    const dir = await mkdtemp(path.join(tmpdir(), 'allay-pull-'));
    try {
      const errors = await pool(orderAssets(missing), downloadConcurrency, async (item) => {
        const file = path.join(dir, item.name);
        try {
          let size;
          if (item.text !== undefined) {
            await writeFile(file, item.text);
            size = Buffer.byteLength(item.text);
          } else {
            size = await downloadFile(tag, item.name, item.sha256, file);
          }
          await uploader.uploadFile(tag, { name: item.name, size, digest: `sha256:${item.sha256}` }, file);
        } finally {
          await rm(file, { force: true });
        }
      });
      if (errors.length) throw new Error(`${tag} 有 ${errors.length} 个附件没有补上：\n${errors.map((e) => e.message).join('\n')}`);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
    console.log(`[GitCode] ${tag} 的附件已补齐`);
    return 'done';
  }

  /** 推送标签触发时：等 GitHub 发布、GitHub Actions 在 GitCode 上建好发行版，最多等 waitMs */
  async function waitAndSync(tag, waitMs) {
    const deadline = Date.now() + waitMs;
    for (;;) {
      const result = await syncTag(tag);
      if (result === 'done') return;
      if (Date.now() >= deadline) {
        console.log(`[GitCode] ${tag} 还没有可同步的发行版（${result === 'no-release' ? 'GitCode 上还没建好' : 'GitHub 上还没发布'}），交给之后的定时运行`);
        return;
      }
      console.log(`[GitCode] ${tag}：${result === 'no-release' ? 'GitCode 上还没有这个发行版' : 'GitHub 上还没发布'}，${Math.round(pollMs / 1000)} 秒后再看`);
      await sleep(pollMs);
    }
  }

  return { syncTag, waitAndSync, gitcodeReleases: uploader.gitcodeReleases };
}

export async function main(env = process.env) {
  // 优先用仓库密钥里的个人令牌；没有时用流水线自动生成的 ATOMGIT_TOKEN（按文档放在 Authorization 头里）
  const personal = env.GITCODE_TOKEN?.trim();
  const token = personal || env.ATOMGIT_TOKEN?.trim();
  if (!token) throw new Error('缺少 GITCODE_TOKEN 或 ATOMGIT_TOKEN');
  const puller = createPuller({
    githubRepo: env.GH_REPO || 'Mystic-Stars/Allay-Motion',
    gitcodeRepo: env.ATOMGIT_REPOSITORY || env.GITCODE_REPO || 'Mystic-Stars/Allay-Motion',
    gitcodeToken: token,
    authHeader: !personal,
    apiBase: env.ATOMGIT_API_URL ? `${env.ATOMGIT_API_URL.replace(/\/+$/, '')}/api/v5` : GITCODE_API,
    ...(Number(env.PULL_CONCURRENCY) > 0 ? { downloadConcurrency: Number(env.PULL_CONCURRENCY) } : {}),
  });
  const pushedTag = env.ATOMGIT_EVENT_NAME === 'push' && env.ATOMGIT_REF_TYPE === 'tag' ? env.ATOMGIT_REF_NAME : '';
  const selected = env.SELECTED_TAG?.trim() || pushedTag;
  if (selected) {
    // 标签刚推过来时 GitHub 上还在构建（约半小时），等它发布
    await puller.waitAndSync(selected, pushedTag ? 120 * 60 * 1000 : 0);
    return;
  }
  const failures = [];
  const releases = await puller.gitcodeReleases();
  for (const release of releases) {
    try {
      // 每个版本现查一次附件列表，不依赖列表接口里带的附件
      const result = await puller.syncTag(release.tag_name);
      if (result === 'not-published') console.log(`[GitCode] ${release.tag_name}：GitHub 上没有 ${CHECKSUMS_NAME}，跳过`);
    } catch (error) {
      console.error(`[GitCode] ${error.message}`);
      failures.push(release.tag_name);
    }
  }
  if (failures.length) throw new Error(`这些版本的附件没有补齐：${failures.join('、')}；下次运行会接着补`);
  console.log(`[GitCode] 已检查 ${releases.length} 个发行版`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
