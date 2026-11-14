import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import https from 'node:https';
import { PassThrough, Readable } from 'node:stream';
import { test } from 'node:test';
import { createClient, main } from '../scripts/sync-gitcode-release.mjs';

const payload = Buffer.from('installer bytes');
const digest = `sha256:${createHash('sha256').update(payload).digest('hex')}`;
const asset = { id: 42, name: 'installer.exe', state: 'uploaded', size: payload.length, digest };
const release = {
  tag_name: 'v1.0.0', draft: false, published_at: '2026-11-14T00:00:00Z',
  prerelease: false, name: 'Version 1', body: 'notes', assets: [asset],
};
const options = {
  githubRepo: 'Mystic-Stars/Allay-Motion', gitcodeRepo: 'Mystic-Stars/Allay-Motion',
  githubToken: 'github-test', gitcodeToken: 'gitcode-test',
};
const json = (value, status = 200) => new Response(JSON.stringify(value), {
  status, headers: { 'Content-Type': 'application/json' },
});

test('仅选取已发布版本，并保留 GitHub 最新版信息', async (t) => {
  t.mock.method(globalThis, 'fetch', async (url) => {
    if (String(url).endsWith('/releases/latest')) return json(release);
    if (String(url).includes('/releases?')) return json([{ ...release, draft: true }, release]);
    throw new Error('unexpected request');
  });
  const result = await createClient(options).githubReleases();
  assert.deepEqual(result.releases.map((item) => item.tag_name), ['v1.0.0']);
  assert.equal(result.latestTag, 'v1.0.0');
});

test('创建发行版、上传附件并验证摘要；再次同步不重复上传', async (t) => {
  let remote = null;
  let uploads = 0;
  const requests = [];
  t.mock.method(globalThis, 'fetch', async (input, init) => {
    const url = new URL(input);
    requests.push(`${init.method || 'GET'} ${url.host}${url.pathname}`);
    if (url.host === 'api.github.com' && url.pathname.endsWith('/releases/assets/42')) {
      return new Response(payload);
    }
    if (url.pathname.endsWith('/releases/tags/v1.0.0')) return remote ? json(remote) : json({}, 404);
    if (url.pathname.endsWith('/releases') && init.method === 'POST') {
      const body = JSON.parse(init.body);
      assert.equal(body.tag_name, 'v1.0.0');
      assert.equal(body.release_status, 'latest');
      remote = { ...body, prerelease: false, assets: [] };
      return json(remote);
    }
    if (url.pathname.endsWith('/upload_url')) {
      assert.equal(url.searchParams.get('file_name'), 'installer.exe');
      return json({ url: 'https://storage.example/file', headers: { 'Content-Type': 'application/octet-stream' } });
    }
    throw new Error('unexpected request');
  });
  t.mock.method(https, 'request', (_url, requestOptions, callback) => {
    assert.equal(requestOptions.headers['Content-Length'], payload.length);
    const stream = new PassThrough();
    const chunks = [];
    stream.setTimeout = () => stream;
    stream.on('data', (chunk) => chunks.push(chunk));
    stream.on('finish', () => {
      assert.deepEqual(Buffer.concat(chunks), payload);
      uploads++;
      remote.assets.push({ id: 13, name: asset.name, size: asset.size, digest });
      const response = Readable.from([]);
      response.statusCode = 200;
      callback(response);
    });
    return stream;
  });

  const client = createClient(options);
  await client.syncRelease(release, release.tag_name);
  await client.syncRelease(release, release.tag_name);
  assert.equal(uploads, 1);
  assert.equal(requests.filter((item) => item.includes('releases/assets/42')).length, 1);
});

test('Windows 与 macOS 的全部安装包和 SHA256SUMS.txt 都同步，不按文件名挑选', async (t) => {
  const names = [
    'Allay-Motion-1.0.0-x64-setup.exe',
    'Allay-Motion-1.0.0-arm64.dmg',
    'Allay-Motion-1.0.0-x64.dmg',
    'Allay-Motion-1.0.0-arm64-mac.zip',
    'Allay-Motion-1.0.0-x64-mac.zip',
    'SHA256SUMS.txt',
  ];
  const bytes = new Map(names.map((name) => [name, Buffer.from(`bytes of ${name}`)]));
  const sha = (buffer) => `sha256:${createHash('sha256').update(buffer).digest('hex')}`;
  const assets = names.map((name, i) => ({
    id: 100 + i, name, state: 'uploaded', size: bytes.get(name).length, digest: sha(bytes.get(name)),
  }));
  const multi = { ...release, assets };
  let remote = null;
  let pending = null;
  t.mock.method(globalThis, 'fetch', async (input, init) => {
    const url = new URL(input);
    const assetMatch = /\/releases\/assets\/(\d+)$/.exec(url.pathname);
    if (url.host === 'api.github.com' && assetMatch) {
      return new Response(bytes.get(assets.find((a) => a.id === Number(assetMatch[1])).name));
    }
    if (url.pathname.endsWith('/releases/tags/v1.0.0')) return remote ? json(remote) : json({}, 404);
    if (url.pathname.endsWith('/releases') && init.method === 'POST') {
      remote = { ...JSON.parse(init.body), prerelease: false, assets: [] };
      return json(remote);
    }
    if (url.pathname.endsWith('/upload_url')) {
      pending = url.searchParams.get('file_name');
      return json({ url: 'https://storage.example/file', headers: {} });
    }
    throw new Error('unexpected request');
  });
  t.mock.method(https, 'request', (_url, _options, callback) => {
    const stream = new PassThrough();
    const chunks = [];
    stream.setTimeout = () => stream;
    stream.on('data', (chunk) => chunks.push(chunk));
    stream.on('finish', () => {
      const body = Buffer.concat(chunks);
      assert.deepEqual(body, bytes.get(pending));
      remote.assets.push({ id: 1000 + remote.assets.length, name: pending, size: body.length, digest: sha(body) });
      const response = Readable.from([]);
      response.statusCode = 200;
      callback(response);
    });
    return stream;
  });

  await createClient(options).syncRelease(multi, multi.tag_name);
  assert.deepEqual(remote.assets.map((a) => a.name).sort(), [...names].sort());
});

test('同名附件内容不同时失败，不删除或覆盖现有文件', async (t) => {
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async (_input, init) => {
    calls++;
    assert.equal(init.method, 'GET');
    return json({
      name: release.name, body: release.body, prerelease: false, release_status: 'latest',
      assets: [{ id: 2, name: asset.name, size: asset.size, digest: `sha256:${'a'.repeat(64)}` }],
    });
  });
  await assert.rejects(createClient(options).syncRelease(release, release.tag_name), /摘要不一致/);
  assert.equal(calls, 1);
});

test('草稿及没有附件的版本绝不创建 GitCode Release', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => {
    assert.fail('不应访问 GitCode');
  });
  const client = createClient(options);
  await assert.rejects(client.syncRelease({ ...release, draft: true }), /已经发布/);
  await assert.rejects(client.syncRelease({ ...release, assets: [] }), /没有附件/);
});

test('手动指定草稿时失败；不把已发布的预发布版错误设为 latest', async (t) => {
  const patches = [];
  t.mock.method(globalThis, 'fetch', async (input, init) => {
    const url = new URL(input);
    if (url.host === 'api.github.com') {
      if (url.pathname.endsWith('/latest')) return json(release);
      return json({ ...release, draft: true });
    }
    if (init.method === 'PATCH') {
      patches.push(JSON.parse(init.body));
      return json({ ...patches[0], prerelease: true, assets: [{ id: 1, ...asset }] });
    }
    return json({ ...release, prerelease: false, release_status: 'none', assets: [{ id: 1, ...asset }] });
  });
  await assert.rejects(createClient(options).githubReleases('v1.0.0'), /仍是草稿/);
  await createClient(options).syncRelease({ ...release, prerelease: true }, 'v2.0.0');
  assert.equal(patches[0].release_status, 'pre');
});

test('没有令牌时失败', async () => {
  await assert.rejects(main({ GH_REPO: options.githubRepo, GITCODE_REPO: options.gitcodeRepo }), /缺少/);
});
