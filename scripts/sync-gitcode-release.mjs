#!/usr/bin/env node
// 只同步 GitHub 上已经发布的版本；不使用本机 GitCode 凭据。
import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import https from 'node:https';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const mib = (bytes) => (bytes / 1048576).toFixed(1);

export const CHECKSUMS_NAME = 'SHA256SUMS.txt';

/**
 * 上传顺序：先校验和，再是应用内自动更新要用的安装包（exe、dmg），最后其他附件（zip 等）；同一类小的先传。
 * 自动更新（docs/decisions.md“自动更新”）要求同一个版本里安装包和 SHA256SUMS.txt 都在，缺了就改用 GitHub。
 */
export function assetPriority(name) {
  if (name === CHECKSUMS_NAME) return 0;
  if (/-setup\.exe$|\.dmg$/.test(name)) return 1;
  return 2;
}

export function orderAssets(assets) {
  return [...assets].sort((a, b) => assetPriority(a.name) - assetPriority(b.name) || a.size - b.size);
}

/** 最多 limit 个同时跑；一个失败不影响其他，返回全部错误 */
async function pool(items, limit, fn) {
  const errors = [];
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const item = items[next++];
      try {
        await fn(item);
      } catch (error) {
        errors.push(error);
      }
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, worker));
  return errors;
}

function digestOf(value) {
  const match = /^(?:sha256:)?([0-9a-f]{64})$/i.exec(value || '');
  return match ? match[1].toLowerCase() : null;
}

function attachment(release, name) {
  // 自动生成的源码包没有附件 ID，不能与上传的安装包混淆。
  return (release.assets || []).find((item) => item.name === name && item.id != null);
}

function sameAsset(source, dest) {
  const a = digestOf(source.digest);
  const b = digestOf(dest.digest);
  if (!a || !b) {
    throw new Error(`无法校验 ${source.name} 的 SHA-256；请检查两端的附件摘要`);
  }
  return a === b && (dest.size == null || Number(source.size) === Number(dest.size));
}

export function createClient({
  githubRepo, gitcodeRepo, githubToken, gitcodeToken,
  // 跨境上传单个连接很慢（2026-11-14 实测 v0.1.1 的第一个安装包 50 分钟没传完），几个附件同时传
  uploadConcurrency = 3,
  uploadAttempts = 3,
  // 这么久一个字节都没发出去（或收不到响应）就放弃这次上传、换一个上传地址重试
  uploadIdleMs = 5 * 60 * 1000,
  progressLogMs = 60_000,
  retryDelayMs = 5000,
  confirmDelayMs = 3000,
}) {
  if (!/^[\w.-]+\/[\w.-]+$/.test(githubRepo || '') ||
      !/^[\w.-]+\/[\w.-]+$/.test(gitcodeRepo || '')) {
    throw new Error('GH_REPO 和 GITCODE_REPO 必须是 owner/repo');
  }
  if (!githubToken || !gitcodeToken) throw new Error('缺少 GITHUB_TOKEN 或 GITCODE_TOKEN');

  const githubBase = `https://api.github.com/repos/${githubRepo}`;
  const gitcodeBase = `https://api.gitcode.com/api/v5/repos/${gitcodeRepo}`;
  const headers = { Accept: 'application/json', 'User-Agent': 'Allay-Motion-GitCode-Mirror' };

  async function request(url, options, { retry = true, timeout = 120_000 } = {}) {
    for (let attempt = 0; ; attempt++) {
      try {
        const response = await fetch(url, { ...options, signal: AbortSignal.timeout(timeout) });
        if (retry && attempt < 3 && (response.status === 429 || response.status >= 500)) {
          await response.body?.cancel();
          await sleep(2000 * (attempt + 1));
          continue;
        }
        return response;
      } catch {
        // 不输出可能包含令牌或预签名 URL 的网络异常。
        if (!retry || attempt >= 3) throw new Error('访问平台 API 失败，请检查网络');
        await sleep(2000 * (attempt + 1));
      }
    }
  }

  async function readJson(response, label, allow404 = false) {
    if (allow404 && response.status === 404) return null;
    if (!response.ok) throw new Error(`${label}失败：HTTP ${response.status}`);
    return response.json();
  }

  async function gh(pathname, accept = 'application/vnd.github+json', timeout) {
    return request(githubBase + pathname, {
      headers: { ...headers, Accept: accept, Authorization: `Bearer ${githubToken}` },
    }, { timeout });
  }

  async function gc(pathname, method = 'GET', body) {
    const url = new URL(gitcodeBase + pathname);
    url.searchParams.set('access_token', gitcodeToken);
    return request(url, {
      method,
      headers: { ...headers, ...(body ? { 'Content-Type': 'application/json' } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}),
    }, { retry: method === 'GET' });
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

  async function gitcodeRelease(tag) {
    return readJson(await gc(`/releases/tags/${encodeURIComponent(tag)}`), '读取 GitCode Release', true);
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

  function putFile(uploadUrl, headersToSend, file, size, label) {
    const url = new URL(uploadUrl);
    if (url.protocol !== 'https:') throw new Error('GitCode 返回了非 HTTPS 的上传地址');
    return new Promise((resolve, reject) => {
      let settled = false;
      let progress = null;
      const done = (error) => {
        if (settled) return;
        settled = true;
        if (progress) clearInterval(progress);
        if (error) reject(error);
        else resolve();
      };
      const req = https.request(url, {
        method: 'PUT',
        headers: { ...headersToSend, 'Content-Length': size },
      }, (response) => {
        response.resume();
        response.on('end', () => {
          if (response.statusCode >= 200 && response.statusCode < 300) done();
          else done(new Error(`HTTP ${response.statusCode}`));
        });
        response.on('error', () => done(new Error('读取响应失败')));
      });
      // 套接字上这么久没有任何收发就算卡住：放弃这次，由调用方换新的上传地址重试
      req.setTimeout(uploadIdleMs, () => req.destroy(new Error(`${Math.round(uploadIdleMs / 1000)} 秒没有进度`)));
      // 不输出可能包含签名的地址
      req.on('error', (error) => done(new Error(/没有进度/.test(error?.message) ? error.message : '连接中断')));
      const started = Date.now();
      let sent = 0;
      // 每分钟记一次进度，卡在哪里、速度多少在日志里看得到
      progress = setInterval(() => {
        const rate = sent / 1024 / Math.max(1, (Date.now() - started) / 1000);
        console.log(`[GitCode] 上传 ${label}：${mib(sent)} / ${mib(size)} MiB，平均 ${rate.toFixed(0)} KiB/s`);
      }, progressLogMs);
      progress.unref?.();
      const stream = createReadStream(file);
      stream.on('data', (chunk) => {
        sent += chunk.length;
      });
      stream.on('error', () => req.destroy(new Error('读取临时文件失败')));
      stream.pipe(req);
    });
  }

  /** 附件出现在 GitCode 上且摘要一致时为真；摘要不一致时抛错 */
  async function waitForAttachment(tag, asset, attempts) {
    for (let attempt = 0; attempt < attempts; attempt++) {
      const current = await gitcodeRelease(tag);
      const uploaded = current && attachment(current, asset.name);
      if (uploaded) {
        if (!sameAsset(asset, uploaded)) throw new Error(`上传后摘要不一致：${tag}/${asset.name}`);
        return true;
      }
      if (attempt + 1 < attempts) await sleep(confirmDelayMs);
    }
    return false;
  }

  /** 从 GitHub 下载一个附件并上传到 GitCode；上传失败时先确认没有传上去，再换上传地址重试 */
  async function uploadAsset(tag, asset, dir) {
    const label = `${tag}/${asset.name}`;
    const file = path.join(dir, String(asset.id));
    console.log(`[GitCode] 下载 ${label}（${mib(asset.size)} MiB）`);
    await downloadAsset(asset, file);
    try {
      for (let attempt = 1; ; attempt++) {
        const upload = await readJson(
          await gc(`/releases/${encodeURIComponent(tag)}/upload_url?file_name=${encodeURIComponent(asset.name)}`),
          `获取 ${asset.name} 的上传地址`,
        );
        if (!upload.url || !upload.headers) throw new Error('GitCode 上传地址响应不完整');
        const started = Date.now();
        try {
          await putFile(upload.url, upload.headers, file, asset.size, label);
        } catch (error) {
          // 响应丢了但文件其实已经存上的情况：先等一会儿看附件有没有登记，避免重复上传
          if (await waitForAttachment(tag, asset, 5)) {
            console.log(`[GitCode] ${label} 上传时连接中断，但附件已登记且摘要一致`);
            return;
          }
          if (attempt >= uploadAttempts) throw new Error(`${label} 上传失败（${error.message}），已试 ${attempt} 次`, { cause: error });
          console.log(`[GitCode] ${label} 上传失败（${error.message}），${retryDelayMs * attempt / 1000} 秒后第 ${attempt + 1} 次尝试`);
          await sleep(retryDelayMs * attempt);
          continue;
        }
        const seconds = Math.max(1, (Date.now() - started) / 1000);
        console.log(`[GitCode] 已上传 ${label}，用时 ${Math.round(seconds)} 秒，平均 ${(asset.size / 1024 / seconds).toFixed(0)} KiB/s`);
        // OBS 回调登记附件可能有延迟；未确认成功则中止，避免制造重复文件。
        if (await waitForAttachment(tag, asset, 10)) return;
        throw new Error(`GitCode 未确认附件 ${asset.name}；请稍后重新运行同步`);
      }
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
  const { releases, latestTag } = await client.githubReleases(env.SELECTED_TAG?.trim());
  // 发行版和说明：最后同步最新正式版，避免补传历史版本影响最新标记。
  releases.sort((a, b) => Number(a.tag_name === latestTag) - Number(b.tag_name === latestTag));
  const synced = [];
  for (const release of releases) synced.push([release, await client.syncReleaseInfo(release, latestTag)]);
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
