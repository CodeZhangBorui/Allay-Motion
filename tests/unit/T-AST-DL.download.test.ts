import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  checkMojangUrl,
  chooseVanillaSource,
  createVanillaDownloader,
  DownloadError,
  MOJANG_HOSTS,
  openVanillaLayer,
  type CachedVanilla,
  type VanillaInstall,
} from '../../apps/desktop/src/main/resources';
import { buildZip, solidPng, tex } from './helpers/resource-fixtures';

// T-AST-DL：运行时从 Mojang 下载客户端 jar。全部对着本机的假 HTTP 服务器测，不访问真实网络。
// 假清单、假 jar（纯色测试色块）、假资源索引都由脚本生成。

type Route = Buffer | { status: number; headers?: Record<string, string>; body?: Buffer } | { slow: Buffer[]; delayMs: number };

let dir: string;
let server: Server;
let origin: string;
let routes: Map<string, Route>;
let log: string[];

const sha1 = (b: Buffer) => createHash('sha1').update(b).digest('hex');

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'allay-t-ast-dl-'));
  routes = new Map();
  log = [];
  server = createServer((req, res) => {
    const path = new URL(req.url ?? '/', 'http://x').pathname;
    log.push(path);
    // 不允许任何自定义标识：只应有 Host 和 Connection 这类 Node 默认头
    expect(req.headers['user-agent']).toBeUndefined();
    const r = routes.get(path);
    if (!r) {
      res.writeHead(404).end();
      return;
    }
    if (Buffer.isBuffer(r)) {
      res.writeHead(200, { 'content-length': String(r.length) }).end(r);
      return;
    }
    if ('slow' in r) {
      res.writeHead(200);
      let i = 0;
      const tick = () => {
        if (res.destroyed) return;
        const chunk = r.slow[i++];
        if (!chunk) {
          res.end();
          return;
        }
        res.write(chunk);
        setTimeout(tick, r.delayMs);
      };
      tick();
      return;
    }
    res.writeHead(r.status, r.headers).end(r.body);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const addr = server.address();
  origin = `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`;
});

afterEach(async () => {
  server.closeAllConnections();
  await new Promise<void>((r) => server.close(() => r()));
  rmSync(dir, { recursive: true, force: true });
});

const testOrigins = () => Object.fromEntries(MOJANG_HOSTS.map((h) => [h, origin]));

interface Fake {
  jar: Buffer;
  index: Buffer;
  sound: Buffer;
  version: Record<string, unknown>;
}

/** 搭一套假的清单 → 版本 JSON → jar → 资源索引 → 资源对象 */
function serveFakeRelease(patch: (f: Fake) => void = () => undefined): Fake {
  const jar = Buffer.from(buildZip([{ name: tex('stone'), data: solidPng('#00ff00') }, { name: 'net/fake/Main.class', data: 'x' }]));
  const sound = Buffer.from('OggS-fake');
  const index = Buffer.from(JSON.stringify({ objects: { 'minecraft/sounds/dig/stone1.ogg': { hash: sha1(sound), size: sound.length } } }));
  const f: Fake = {
    jar,
    index,
    sound,
    version: {
      id: 'fx-9',
      type: 'release',
      releaseTime: '2030-01-01T00:00:00+00:00',
      downloads: { client: { url: 'https://piston-data.mojang.com/v1/objects/aaa/client.jar', sha1: sha1(jar), size: jar.length } },
      assetIndex: { id: 'fx', url: 'https://piston-meta.mojang.com/v1/packages/bbb/fx.json', sha1: sha1(index), size: index.length },
    },
  };
  patch(f);
  const versionBytes = Buffer.from(JSON.stringify(f.version));
  routes.set(
    '/mc/game/version_manifest_v2.json',
    Buffer.from(
      JSON.stringify({
        latest: { release: 'fx-9', snapshot: 'fx-10-snap' },
        versions: [
          { id: 'fx-10-snap', type: 'snapshot', url: 'https://piston-meta.mojang.com/v1/packages/ccc/snap.json' },
          { id: 'fx-9', type: 'release', url: 'https://piston-meta.mojang.com/v1/packages/ddd/fx-9.json', sha1: sha1(versionBytes) },
        ],
      }),
    ),
  );
  routes.set('/v1/packages/ddd/fx-9.json', versionBytes);
  routes.set('/v1/objects/aaa/client.jar', f.jar);
  routes.set('/v1/packages/bbb/fx.json', f.index);
  routes.set(`/${sha1(sound).slice(0, 2)}/${sha1(sound)}`, sound);
  return f;
}

function files(root: string): string[] {
  if (!existsSync(root)) return [];
  const out: string[] = [];
  const walk = (d: string) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, e.name);
      if (e.isDirectory()) walk(p);
      else out.push(relative(root, p).replace(/\\/g, '/'));
    }
  };
  walk(root);
  return out.sort();
}

const cacheDir = () => join(dir, 'userData', 'vanilla-cache');

describe('T-AST-DL 运行时下载客户端 jar', () => {
  it('T-AST-DL-1 正常下载：清单 → 最新正式版 → jar 与资源索引校验通过，资源对象按需取', async () => {
    serveFakeRelease();
    const dl = createVanillaDownloader({ cacheDir: cacheDir(), packaged: false, testOrigins: testOrigins() });
    expect(await dl.findCached()).toBeNull();
    const phases = new Set<string>();
    const got = await dl.downloadLatest({ onProgress: (p) => phases.add(p.phase) });
    expect(got.versionId).toBe('fx-9');
    expect(phases).toEqual(new Set(['manifest', 'version', 'jar', 'index']));
    expect(files(cacheDir())).toEqual(['indexes/fx.json', 'versions/fx-9/client.jar', 'versions/fx-9/version.json']);
    // 下载缓存当作原版层打开；音效对象不在本地，按需取
    const layer = await openVanillaLayer(got, { fetchObject: (h, s) => dl.fetchObject(h, s) });
    try {
      expect(layer.has(tex('stone'))).toBe(true);
      expect(Buffer.from((await layer.read(tex('stone'))) ?? []).equals(Buffer.from(solidPng('#00ff00')))).toBe(true);
      const ogg = await layer.read('assets/minecraft/sounds/dig/stone1.ogg');
      expect(Buffer.from(ogg ?? []).toString()).toBe('OggS-fake');
    } finally {
      layer.close();
    }
    expect(log.filter((p) => p.startsWith('/v1/') || p === '/mc/game/version_manifest_v2.json' || /^\/[0-9a-f]{2}\//.test(p))).toHaveLength(5);
  });

  it('T-AST-DL-2 jar 的 sha1 不符：被拒绝，不留文件', async () => {
    serveFakeRelease((f) => {
      (f.version.downloads as { client: { sha1: string } }).client.sha1 = '0'.repeat(40);
    });
    const dl = createVanillaDownloader({ cacheDir: cacheDir(), packaged: false, testOrigins: testOrigins() });
    await expect(dl.downloadLatest()).rejects.toMatchObject({ code: 'hash' });
    expect(files(cacheDir())).toEqual([]);
    expect(await dl.findCached()).toBeNull();
  });

  it('T-AST-DL-3 超大文件：声明超过上限直接拒绝；实际发来的比声明多也拒绝', async () => {
    serveFakeRelease();
    const small = createVanillaDownloader({ cacheDir: cacheDir(), packaged: false, testOrigins: testOrigins(), limits: { jarBytes: 10 } });
    await expect(small.downloadLatest()).rejects.toMatchObject({ code: 'size' });
    expect(log).not.toContain('/v1/objects/aaa/client.jar');

    serveFakeRelease((f) => {
      f.jar = Buffer.concat([f.jar, Buffer.alloc(1000)]); // 服务器发来的比版本 JSON 声明的大
      (f.version.downloads as { client: { size: number } }).client.size = 50;
    });
    const dl = createVanillaDownloader({ cacheDir: cacheDir(), packaged: false, testOrigins: testOrigins() });
    await expect(dl.downloadLatest()).rejects.toMatchObject({ code: 'size' });
    expect(files(cacheDir())).toEqual([]);
  });

  it('T-AST-DL-4 白名单外的主机：清单里的 URL 指向别处时拒绝，且不发请求', async () => {
    serveFakeRelease((f) => {
      (f.version.downloads as { client: { url: string } }).client.url = 'https://evil.example.com/client.jar';
    });
    const dl = createVanillaDownloader({ cacheDir: cacheDir(), packaged: false, testOrigins: { ...testOrigins(), 'evil.example.com': origin } });
    await expect(dl.downloadLatest()).rejects.toMatchObject({ code: 'host' });
    expect(log).not.toContain('/client.jar');
    for (const bad of ['http://piston-meta.mojang.com/x', 'https://piston-meta.mojang.com:8443/x', 'https://u:p@piston-meta.mojang.com/x', 'https://mojang.com/x', 'https://piston-meta.mojang.com.evil.io/x']) {
      expect(() => checkMojangUrl(bad), bad).toThrow(DownloadError);
    }
    expect(checkMojangUrl('https://resources.download.minecraft.net/ab/abc').hostname).toBe('resources.download.minecraft.net');
  });

  it('T-AST-DL-5 重定向：一律拒绝，不跟随', async () => {
    serveFakeRelease();
    routes.set('/v1/objects/aaa/client.jar', { status: 302, headers: { location: 'https://piston-data.mojang.com/elsewhere.jar' } });
    routes.set('/elsewhere.jar', Buffer.from('x'));
    const dl = createVanillaDownloader({ cacheDir: cacheDir(), packaged: false, testOrigins: testOrigins() });
    await expect(dl.downloadLatest()).rejects.toMatchObject({ code: 'redirect' });
    expect(log).not.toContain('/elsewhere.jar');
    expect(files(cacheDir())).toEqual([]);
  });

  it('T-AST-DL-6 中途取消：不留半成品', async () => {
    const f = serveFakeRelease();
    const chunks = Array.from({ length: 20 }, (_, i) => f.jar.subarray(Math.floor((i * f.jar.length) / 20), Math.floor(((i + 1) * f.jar.length) / 20)));
    routes.set('/v1/objects/aaa/client.jar', { slow: chunks, delayMs: 50 });
    const dl = createVanillaDownloader({ cacheDir: cacheDir(), packaged: false, testOrigins: testOrigins() });
    const ac = new AbortController();
    const p = dl.downloadLatest({
      signal: ac.signal,
      onProgress: (pr) => {
        if (pr.phase === 'jar' && pr.received > 0) ac.abort();
      },
    });
    await expect(p).rejects.toMatchObject({ code: 'aborted' });
    expect(files(cacheDir())).toEqual([]);
  });

  it('T-AST-DL-7 已缓存：findCached 完全离线；再次下载只取清单和版本 JSON，不再取 jar 和索引', async () => {
    serveFakeRelease();
    const dl = createVanillaDownloader({ cacheDir: cacheDir(), packaged: false, testOrigins: testOrigins() });
    await dl.downloadLatest();
    log.length = 0;
    const cached = await dl.findCached();
    expect(cached?.versionId).toBe('fx-9');
    expect(log).toEqual([]);
    await dl.downloadLatest();
    expect(log).toEqual(['/mc/game/version_manifest_v2.json', '/v1/packages/ddd/fx-9.json']);
    // 缓存的 jar 被改坏：findCached 不再认它
    rmSync(join(cacheDir(), 'versions/fx-9/client.jar'));
    expect(await dl.findCached()).toBeNull();
  });

  it('T-AST-DL-8 打包后不允许替换下载地址', () => {
    expect(() => createVanillaDownloader({ cacheDir: cacheDir(), packaged: true, testOrigins: testOrigins() })).toThrow();
    expect(() => createVanillaDownloader({ cacheDir: cacheDir(), packaged: true })).not.toThrow();
  });

  it('T-AST-DL-9 原版层来源：默认取较新的，可以指定偏好', () => {
    const local: VanillaInstall = { gameDir: 'g', versionId: '1.21.1', releaseTime: '2024-08-08T00:00:00Z', jarPath: 'a', assetIndexPath: null, objectsDir: 'o' };
    const cached: CachedVanilla = { ...local, source: 'downloaded', versionId: '26.3', releaseTime: '2026-10-01T00:00:00Z' };
    expect(chooseVanillaSource(null, null)).toEqual({ status: 'needs-download', install: null });
    expect(chooseVanillaSource(local, null).status).toBe('local');
    expect(chooseVanillaSource(null, cached).status).toBe('cached');
    expect(chooseVanillaSource(local, cached).install?.versionId).toBe('26.3');
    expect(chooseVanillaSource(local, cached, 'local').install?.versionId).toBe('1.21.1');
    expect(chooseVanillaSource({ ...local, releaseTime: '2027-01-01T00:00:00Z' }, cached).status).toBe('local');
  });
});
