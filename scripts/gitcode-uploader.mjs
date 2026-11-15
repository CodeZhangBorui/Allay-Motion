// GitCode 发行版附件的上传（docs/gitcode-mirror.md）。两处共用：
// - GitHub Actions 上的 scripts/sync-gitcode-release.mjs（建发行版、写说明；备用时也从 GitHub 上传附件）；
// - GitCode 流水线上的 scripts/pull-github-release-assets.mjs（从 GitHub 拉安装包，在国内传进 GitCode）。
// 不输出令牌或预签名地址。
import { createReadStream } from 'node:fs';
import https from 'node:https';

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
export const mib = (bytes) => (bytes / 1048576).toFixed(1);

export const CHECKSUMS_NAME = 'SHA256SUMS.txt';
export const GITCODE_API = 'https://api.gitcode.com/api/v5';

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
  return [...assets].sort((a, b) => assetPriority(a.name) - assetPriority(b.name) || (a.size ?? 0) - (b.size ?? 0));
}

/** 最多 limit 个同时跑；一个失败不影响其他，返回全部错误 */
export async function pool(items, limit, fn) {
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

export function digestOf(value) {
  const match = /^(?:sha256:)?([0-9a-f]{64})$/i.exec(value || '');
  return match ? match[1].toLowerCase() : null;
}

export function attachment(release, name) {
  // 自动生成的源码包没有附件 ID，不能与上传的安装包混淆。
  return (release.assets || []).find((item) => item.name === name && item.id != null);
}

/** source 没有 size 时只比摘要 */
export function sameAsset(source, dest) {
  const a = digestOf(source.digest);
  const b = digestOf(dest.digest);
  if (!a || !b) {
    throw new Error(`无法校验 ${source.name} 的 SHA-256；请检查两端的附件摘要`);
  }
  return a === b && (source.size == null || dest.size == null || Number(source.size) === Number(dest.size));
}

export function createGitcodeUploader({
  gitcodeRepo, gitcodeToken,
  apiBase = GITCODE_API,
  // GitCode 流水线自动生成的 ATOMGIT_TOKEN 按文档用 Authorization 头；个人令牌用 access_token 参数
  authHeader = false,
  userAgent = 'Allay-Motion-GitCode-Mirror',
  uploadAttempts = 3,
  // 这么久一个字节都没发出去（或收不到响应）就放弃这次上传、换一个上传地址重试
  uploadIdleMs = 5 * 60 * 1000,
  progressLogMs = 60_000,
  retryDelayMs = 5000,
  confirmDelayMs = 3000,
}) {
  if (!/^[\w.-]+\/[\w.-]+$/.test(gitcodeRepo || '')) throw new Error('GITCODE_REPO 必须是 owner/repo');
  if (!gitcodeToken) throw new Error('缺少 GitCode 的令牌');
  const base = `${apiBase.replace(/\/+$/, '')}/repos/${gitcodeRepo}`;
  const headers = { Accept: 'application/json', 'User-Agent': userAgent };

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

  async function gc(pathname, method = 'GET', body) {
    const url = new URL(base + pathname);
    url.searchParams.set('access_token', gitcodeToken);
    return request(url, {
      method,
      headers: {
        ...headers,
        ...(authHeader ? { Authorization: `token ${gitcodeToken}` } : {}),
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    }, { retry: method === 'GET' });
  }

  async function gitcodeRelease(tag) {
    return readJson(await gc(`/releases/tags/${encodeURIComponent(tag)}`), '读取 GitCode Release', true);
  }

  /** 最近的发行版，新的在前 */
  async function gitcodeReleases(perPage = 20) {
    const list = await readJson(await gc(`/releases?per_page=${perPage}&page=1`), '读取 GitCode Release 列表');
    if (!Array.isArray(list)) throw new Error('GitCode Release 列表格式异常');
    return [...list].sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')));
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

  /**
   * 把本地文件传成发行版 tag 的附件 asset（name、size、digest）；上传失败时先确认没有传上去，再换上传地址重试。
   * 发行版必须已经存在
   */
  async function uploadFile(tag, asset, file) {
    const label = `${tag}/${asset.name}`;
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
  }

  return { request, readJson, gc, gitcodeRelease, gitcodeReleases, uploadFile };
}
