#!/usr/bin/env node
// 在 GitHub Actions 上运行（docs/gitcode-mirror.md）：只同步 GitHub 上已经发布的版本；不使用本机 GitCode 凭据。
// 默认只在 GitCode 上建好发行版、同步说明和“最新版本”标记；附件（安装包）由 GitCode 流水线
// （.gitcode/workflows/pull-release-assets.yml）从 GitHub 拉取，因为从 GitHub 的机器跨境上传太慢。
// GITCODE_ASSETS_FROM=github 时退回旧做法：附件也从这里上传。
import { createHash } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';
import { attachment, createGitcodeUploader, digestOf, mib, orderAssets, pool, sameAsset } from './gitcode-uploader.mjs';

export { assetPriority, CHECKSUMS_NAME, orderAssets } from './gitcode-uploader.mjs';

export function createClient({
  githubRepo, gitcodeRepo, githubToken, gitcodeToken,
  // 跨境上传单个连接很慢（2026-11-14 实测 v0.1.1 的第一个安装包 50 分钟没传完），几个附件同时传
  uploadConcurrency = 3,
  ...uploaderOptions
}) {
  if (!/^[\w.-]+\/[\w.-]+$/.test(githubRepo || '') ||
      !/^[\w.-]+\/[\w.-]+$/.test(gitcodeRepo || '')) {
    throw new Error('GH_REPO 和 GITCODE_REPO 必须是 owner/repo');
  }
  if (!githubToken || !gitcodeToken) throw new Error('缺少 GITHUB_TOKEN 或 GITCODE_TOKEN');

  const uploader = createGitcodeUploader({ gitcodeRepo, gitcodeToken, ...uploaderOptions });
  const { request, readJson, gc, gitcodeRelease } = uploader;
  const githubBase = `https://api.github.com/repos/${githubRepo}`;

  async function gh(pathname, accept = 'application/vnd.github+json', timeout) {
    return request(githubBase + pathname, {
      headers: { Accept: accept, 'User-Agent': 'Allay-Motion-GitCode-Mirror', Authorization: `Bearer ${githubToken}` },
    }, { timeout });
  }

  async function githubReleases(selectedTag) {
    const latest = await readJson(await gh('/releases/latest'), '读取 GitHub 最新版本', true);
    if (selectedTag) {
      const release = await readJson(
        await gh(`/releases/tags/${encodeURIComponent(selectedTag)}`), '读取 GitHub Release',
      );
      if (release.draft) throw new Error(`${selectedTag} 仍是草稿，不能同步`);
      return { releases: [release], latestTag: latest?.tag_name };
    }
    const releases = [];
    for (let page = 1; ; page++) {
      const batch = await readJson(await gh(`/releases?per_page=100&page=${page}`), '读取 GitHub Release 列表');
      if (!Array.isArray(batch)) throw new Error('GitHub Release 列表格式异常');
      releases.push(...batch.filter((item) => !item.draft));
      if (batch.length < 100) break;
    }
    return { releases: releases.reverse(), latestTag: latest?.tag_name };
  }

  async function downloadAsset(asset, file) {
    if (!Number.isSafeInteger(asset.id) || asset.state !== 'uploaded') {
      throw new Error(`GitHub 附件未就绪：${asset.name}`);
    }
    const expected = digestOf(asset.digest);
    if (!expected) throw new Error(`GitHub 附件没有 SHA-256：${asset.name}`);
    const response = await gh(`/releases/assets/${asset.id}`, 'application/octet-stream', 90 * 60 * 1000);
    if (!response.ok || !response.body) throw new Error(`下载 ${asset.name} 失败：HTTP ${response.status}`);
    const hash = createHash('sha256');
    let bytes = 0;
    const meter = new Transform({
      transform(chunk, _encoding, callback) {
        bytes += chunk.length;
        hash.update(chunk);
        callback(null, chunk);
      },
    });
    await pipeline(Readable.fromWeb(response.body), meter, createWriteStream(file));
    if (bytes !== asset.size || hash.digest('hex') !== expected) {
      throw new Error(`下载的附件校验失败：${asset.name}`);
    }
  }

  /** 从 GitHub 下载一个附件并上传到 GitCode */
  async function uploadAsset(tag, asset, dir) {
    const file = path.join(dir, String(asset.id));
    console.log(`[GitCode] 下载 ${tag}/${asset.name}（${mib(asset.size)} MiB）`);
    await downloadAsset(asset, file);
    try {
      await uploader.uploadFile(tag, asset, file);
    } finally {
      await rm(file, { force: true });
    }
  }

  /** 第一步：建好或更新 GitCode 上的发行版和说明（不传附件），返回 GitCode 上的发行版 */
  async function syncReleaseInfo(source, latestTag) {
    const tag = source.tag_name;
    if (!tag || source.draft || !source.published_at) {
      throw new Error('只能同步已经发布的 GitHub Release');
    }
    if (!(source.assets || []).length) throw new Error(`${tag} 没有附件，停止同步以免发布不完整版本`);

    let current = await gitcodeRelease(tag);
    const body = { name: source.name || tag, body: source.body || '' };
    // none 是普通版本，pre 是预发布；只有 GitHub 的最新正式版才标记为 latest。
    if (source.prerelease) body.release_status = 'pre';
    else if (tag === latestTag) body.release_status = 'latest';
    else if (current?.prerelease || current?.release_status === 'latest') body.release_status = 'none';
    if (!current) {
      const result = await gc('/releases', 'POST', { ...body, tag_name: tag });
      current = await readJson(result, `创建 GitCode Release ${tag}`);
      console.log(`[GitCode] 已创建 ${tag}`);
    } else if (current.name !== body.name || current.body !== body.body ||
               Boolean(current.prerelease) !== Boolean(source.prerelease) ||
               (body.release_status && current.release_status !== body.release_status)) {
      current = await readJson(await gc(`/releases/${encodeURIComponent(tag)}`, 'PATCH', body), `更新 GitCode Release ${tag}`);
      console.log(`[GitCode] 已更新 ${tag} 的说明`);
    }
    return current;
  }

  /** 第二步：补传缺的附件（几个同时传），已有的核对摘要。current 是 GitCode 上的发行版，缺省时现查 */
  async function syncAssets(source, current = null) {
    const tag = source.tag_name;
    current ??= await gitcodeRelease(tag);
    if (!current) throw new Error(`GitCode 上还没有 ${tag}，先同步发行版`);
    const missing = [];
    for (const asset of orderAssets(source.assets || [])) {
      const existing = attachment(current, asset.name);
      if (!existing) {
        missing.push(asset);
        continue;
      }
      if (!sameAsset(asset, existing)) {
        throw new Error(`${tag}/${asset.name} 在两端的摘要不一致；请检查并手动处理 GitCode 同名附件后重试`);
      }
      console.log(`[GitCode] ${tag}/${asset.name} 已一致，跳过`);
    }
    if (missing.length) {
      console.log(`[GitCode] ${tag} 要补传 ${missing.length} 个附件，共 ${mib(missing.reduce((n, a) => n + a.size, 0))} MiB，同时传 ${uploadConcurrency} 个`);
      const dir = await mkdtemp(path.join(tmpdir(), 'allay-gitcode-'));
      try {
        const errors = await pool(missing, uploadConcurrency, (asset) => uploadAsset(tag, asset, dir));
        if (errors.length) throw new Error(`${tag} 有 ${errors.length} 个附件没有同步：\n${errors.map((e) => e.message).join('\n')}`);
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    }
    console.log(`[GitCode] ${tag} 全部附件校验通过`);
  }

  async function syncRelease(source, latestTag) {
    await syncAssets(source, await syncReleaseInfo(source, latestTag));
  }

  return { githubReleases, syncReleaseInfo, syncAssets, syncRelease };
}

export async function main(env = process.env) {
  const client = createClient({
    githubRepo: env.GH_REPO || env.GITHUB_REPOSITORY,
    gitcodeRepo: env.GITCODE_REPO || 'Mystic-Stars/Allay-Motion',
    githubToken: env.GITHUB_TOKEN,
    gitcodeToken: env.GITCODE_TOKEN,
    ...(Number(env.GITCODE_UPLOAD_CONCURRENCY) > 0 ? { uploadConcurrency: Number(env.GITCODE_UPLOAD_CONCURRENCY) } : {}),
  });
  const uploadHere = env.GITCODE_ASSETS_FROM === 'github';
  const { releases, latestTag } = await client.githubReleases(env.SELECTED_TAG?.trim());
  // 发行版和说明：最后同步最新正式版，避免补传历史版本影响最新标记。
  releases.sort((a, b) => Number(a.tag_name === latestTag) - Number(b.tag_name === latestTag));
  const synced = [];
  for (const release of releases) synced.push([release, await client.syncReleaseInfo(release, latestTag)]);
  if (!uploadHere) {
    console.log(`[GitCode] 已同步 ${releases.length} 个已发布版本的说明；附件由 GitCode 流水线从 GitHub 拉取（GITCODE_ASSETS_FROM=github 时改从这里上传）`);
    return;
  }
  // 附件：最新正式版优先，其余从新到旧。慢的上传不再拖住最新版本；一个版本失败不影响其他版本
  const failures = [];
  for (const [release, current] of synced.reverse()) {
    try {
      await client.syncAssets(release, current);
    } catch (error) {
      console.error(`[GitCode] ${error.message}`);
      failures.push(release.tag_name);
    }
  }
  if (failures.length) throw new Error(`这些版本的附件没有同步完：${failures.join('、')}；重跑同步会接着补传`);
  console.log(`[GitCode] 已检查 ${releases.length} 个已发布版本`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
