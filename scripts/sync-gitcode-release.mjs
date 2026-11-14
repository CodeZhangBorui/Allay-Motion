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

export function createClient({ githubRepo, gitcodeRepo, githubToken, gitcodeToken }) {
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

  function putFile(uploadUrl, headersToSend, file, size) {
    const url = new URL(uploadUrl);
    if (url.protocol !== 'https:') throw new Error('GitCode 返回了非 HTTPS 的上传地址');
    return new Promise((resolve, reject) => {
      const req = https.request(url, {
        method: 'PUT',
        headers: { ...headersToSend, 'Content-Length': size },
      }, (response) => {
        response.resume();
        response.on('end', () => {
          if (response.statusCode >= 200 && response.statusCode < 300) resolve();
          else reject(new Error(`上传附件失败：HTTP ${response.statusCode}`));
        });
      });
      // GitHub runner 向国内上传较慢，允许 90 分钟无进度超时。
      req.setTimeout(90 * 60 * 1000, () => req.destroy());
      req.on('error', () => reject(new Error('上传附件失败，请重试同步')));
      const stream = createReadStream(file);
      stream.on('error', () => req.destroy());
      stream.pipe(req);
    });
  }

  async function syncRelease(source, latestTag) {
    const tag = source.tag_name;
    const encodedTag = encodeURIComponent(tag);
    if (!tag || source.draft || !source.published_at) {
      throw new Error('只能同步已经发布的 GitHub Release');
    }
    const assets = [...(source.assets || [])].sort((a, b) => a.size - b.size);
    if (!assets.length) throw new Error(`${tag} 没有附件，停止同步以免发布不完整版本`);

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
      current = await readJson(await gc(`/releases/${encodedTag}`, 'PATCH', body), `更新 GitCode Release ${tag}`);
      console.log(`[GitCode] 已更新 ${tag} 的说明`);
    }

    const dir = await mkdtemp(path.join(tmpdir(), 'allay-gitcode-'));
    try {
      for (const asset of assets) {
        const existing = attachment(current, asset.name);
        if (existing) {
          if (!sameAsset(asset, existing)) {
            throw new Error(`${tag}/${asset.name} 在两端的摘要不一致；请检查并手动处理 GitCode 同名附件后重试`);
          }
          console.log(`[GitCode] ${tag}/${asset.name} 已一致，跳过`);
          continue;
        }
        const file = path.join(dir, String(asset.id));
        console.log(`[GitCode] 下载并上传 ${tag}/${asset.name}`);
        await downloadAsset(asset, file);
        const upload = await readJson(
          await gc(`/releases/${encodedTag}/upload_url?file_name=${encodeURIComponent(asset.name)}`),
          `获取 ${asset.name} 的上传地址`,
        );
        if (!upload.url || !upload.headers) throw new Error('GitCode 上传地址响应不完整');
        await putFile(upload.url, upload.headers, file, asset.size);
        await rm(file);

        // OBS 回调登记附件可能有延迟；未确认成功则中止，避免制造重复文件。
        let confirmed = false;
        for (let attempt = 0; attempt < 10; attempt++) {
          current = await gitcodeRelease(tag);
          const uploaded = current && attachment(current, asset.name);
          if (uploaded) {
            if (!sameAsset(asset, uploaded)) throw new Error(`上传后摘要不一致：${tag}/${asset.name}`);
            confirmed = true;
            break;
          }
          await sleep(3000);
        }
        if (!confirmed) throw new Error(`GitCode 未确认附件 ${asset.name}；请稍后重新运行同步`);
      }
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
    console.log(`[GitCode] ${tag} 全部附件校验通过`);
  }

  return { githubReleases, syncRelease };
}

export async function main(env = process.env) {
  const client = createClient({
    githubRepo: env.GH_REPO || env.GITHUB_REPOSITORY,
    gitcodeRepo: env.GITCODE_REPO || 'Mystic-Stars/Allay-Motion',
    githubToken: env.GITHUB_TOKEN,
    gitcodeToken: env.GITCODE_TOKEN,
  });
  const { releases, latestTag } = await client.githubReleases(env.SELECTED_TAG?.trim());
  // 最后同步最新正式版，避免补传历史版本影响最新标记。
  releases.sort((a, b) => Number(a.tag_name === latestTag) - Number(b.tag_name === latestTag));
  for (const release of releases) await client.syncRelease(release, latestTag);
  console.log(`[GitCode] 已检查 ${releases.length} 个已发布版本`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
