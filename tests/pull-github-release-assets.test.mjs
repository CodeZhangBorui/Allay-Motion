import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import https from 'node:https';
import { PassThrough, Readable } from 'node:stream';
import { test } from 'node:test';
import { createPuller, parseChecksums } from '../scripts/pull-github-release-assets.mjs';

// 在 GitCode 流水线上从 GitHub 拉附件（docs/gitcode-mirror.md）

const sha = (buffer) => createHash('sha256').update(buffer).digest('hex');
const files = new Map([
  ['Allay-Motion-1.0.0-x64-setup.exe', Buffer.from('exe bytes')],
  ['Allay-Motion-1.0.0-arm64.dmg', Buffer.from('dmg bytes')],
]);
const sums = [...files].map(([name, bytes]) => `${sha(bytes)}  ${name}`).join('\n') + '\n';
const options = {
  githubRepo: 'Mystic-Stars/Allay-Motion', gitcodeRepo: 'Mystic-Stars/Allay-Motion', gitcodeToken: 'atomgit-test',
  authHeader: true, retryDelayMs: 0, confirmDelayMs: 0, downloadRetryDelayMs: 0, pollMs: 0,
};
const json = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });

/** 假的 GitHub 下载地址和 GitCode API；返回记录 */
function fakePlatforms(t, { remote, github = files, sumsText = sums, corrupt = new Set() }) {
  const log = { downloads: [], uploads: [], auth: [] };
  t.mock.method(globalThis, 'fetch', async (input, init = {}) => {
    const url = new URL(input);
    if (url.host === 'github.com') {
      const name = decodeURIComponent(url.pathname.split('/').pop());
      log.downloads.push(name);
      if (name === 'SHA256SUMS.txt') return sumsText === null ? new Response('', { status: 404 }) : new Response(sumsText);
      if (!github.has(name)) return new Response('', { status: 404 });
      return new Response(corrupt.has(name) ? Buffer.from('tampered') : github.get(name));
    }
    log.auth.push(init.headers?.Authorization);
    if (url.pathname.endsWith('/releases/tags/v1.0.0')) return remote.value ? json(remote.value) : json({}, 404);
    if (url.pathname.endsWith('/upload_url')) {
      return json({ url: `https://storage.example/${encodeURIComponent(url.searchParams.get('file_name'))}`, headers: {} });
    }
    throw new Error(`unexpected request ${url}`);
  });
  t.mock.method(https, 'request', (target, _options, callback) => {
    const name = decodeURIComponent(new URL(target).pathname.slice(1));
    const stream = new PassThrough();
    const chunks = [];
    stream.setTimeout = () => stream;
    stream.on('data', (chunk) => chunks.push(chunk));
    stream.on('finish', () => {
      const body = Buffer.concat(chunks);
      log.uploads.push(name);
      remote.value.assets.push({ id: 100 + remote.value.assets.length, name, size: body.length, digest: `sha256:${sha(body)}` });
      const response = Readable.from([]);
      response.statusCode = 200;
      callback(response);
    });
    return stream;
  });
  return log;
}

test('解析 SHA256SUMS.txt，不接受带路径的文件名', () => {
  const h = 'a'.repeat(64);
  assert.deepEqual(parseChecksums(`${h}  ok.exe\r\n${h}  ../evil.exe\nbad\n`), [{ name: 'ok.exe', sha256: h }]);
});

test('按 SHA256SUMS.txt 从 GitHub 下载、校验，传进 GitCode（含 SHA256SUMS.txt 本身）；再跑一次不重复', async (t) => {
  const remote = { value: { tag_name: 'v1.0.0', assets: [{ name: 'v1.0.0.zip', type: 'source' }] } };
  const log = fakePlatforms(t, { remote });
  const puller = createPuller(options);
  assert.equal(await puller.syncTag('v1.0.0'), 'done');
  assert.deepEqual([...log.uploads].sort(), ['Allay-Motion-1.0.0-arm64.dmg', 'Allay-Motion-1.0.0-x64-setup.exe', 'SHA256SUMS.txt']);
  // 流水线令牌放在 Authorization 头里
  assert.ok(log.auth.every((h) => h === 'token atomgit-test'));
  assert.equal(await puller.syncTag('v1.0.0'), 'done');
  assert.equal(log.uploads.length, 3);
});

test('GitHub 上还没发布、GitCode 上还没建好时什么都不传', async (t) => {
  const remote = { value: null };
  fakePlatforms(t, { remote });
  assert.equal(await createPuller(options).syncTag('v1.0.0'), 'no-release');
  t.mock.restoreAll();
  const remote2 = { value: { tag_name: 'v1.0.0', assets: [] } };
  const log = fakePlatforms(t, { remote: remote2, sumsText: null });
  assert.equal(await createPuller(options).syncTag('v1.0.0'), 'not-published');
  assert.deepEqual(log.uploads, []);
});

test('下载的内容和 SHA256SUMS.txt 对不上时重试，最后失败，不上传这个文件', async (t) => {
  const remote = { value: { tag_name: 'v1.0.0', assets: [] } };
  const log = fakePlatforms(t, { remote, corrupt: new Set(['Allay-Motion-1.0.0-arm64.dmg']) });
  await assert.rejects(createPuller(options).syncTag('v1.0.0'), /1 个附件没有补上[\s\S]*SHA-256/);
  assert.equal(log.downloads.filter((n) => n === 'Allay-Motion-1.0.0-arm64.dmg').length, 3);
  assert.ok(!log.uploads.includes('Allay-Motion-1.0.0-arm64.dmg'));
});

test('GitCode 上同名附件的摘要不同时失败，不覆盖', async (t) => {
  const remote = { value: { tag_name: 'v1.0.0', assets: [{ id: 1, name: 'Allay-Motion-1.0.0-x64-setup.exe', digest: `sha256:${'b'.repeat(64)}` }] } };
  const log = fakePlatforms(t, { remote });
  await assert.rejects(createPuller(options).syncTag('v1.0.0'), /摘要与 GitHub 的 SHA256SUMS.txt 不一致/);
  assert.deepEqual(log.uploads, []);
});
