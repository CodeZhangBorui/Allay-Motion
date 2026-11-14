// 端到端测试用的本机假 Mojang 服务器（decisions.md M2a、M2b）：假清单 → 假版本 JSON → 假 jar（纯色色块）。
// 只监听 127.0.0.1，应用经测试开关 ALLAY_E2E_MOJANG_ORIGIN 连到这里；pnpm check 不访问真实网络。
import { createHash } from 'node:crypto';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { buildZip, type ZipEntrySpec } from '../unit/helpers/resource-fixtures';

const sha1 = (b: Buffer) => createHash('sha1').update(b).digest('hex');

/** slow：限速，jar 分 60 份、每 150 ms 一份（约 9 秒），界面上能看到速度和剩余时间 */
export type JarMode = 'ok' | 'fail' | 'hold' | 'slow';

export interface FakeMojang {
  origin: string;
  /** 收到的请求路径（按顺序） */
  requests: string[];
  /** 收到的请求里有没有 User-Agent 之类的标识 */
  identifyingHeaders: string[];
  jarMode: JarMode;
  /** 资源对象（M6b 的音效）：fail 时一律返回 500，模拟离线 */
  objectMode: 'ok' | 'fail';
  /** hold 模式下 jar 已经发了一半、正在等 */
  holding(): boolean;
  close(): Promise<void>;
}

/**
 * assets 给定时（M6b）：版本 JSON 带资源索引，索引里是这些对象（键如 minecraft/sounds.json），
 * 对象按 /<哈希前两位>/<哈希> 提供，和 resources.download.minecraft.net 一样。
 */
export async function startFakeMojang(versionId: string, jarEntries: readonly ZipEntrySpec[], assets?: Readonly<Record<string, Buffer>>): Promise<FakeMojang> {
  const jar = Buffer.from(buildZip(jarEntries));
  const index = assets ? Buffer.from(JSON.stringify({ objects: Object.fromEntries(Object.entries(assets).map(([k, b]) => [k, { hash: sha1(b), size: b.length }])) })) : null;
  const objects = new Map(Object.values(assets ?? {}).map((b) => [`/${sha1(b).slice(0, 2)}/${sha1(b)}`, b]));
  const version = Buffer.from(
    JSON.stringify({
      id: versionId,
      type: 'release',
      releaseTime: '2030-01-01T00:00:00+00:00',
      downloads: { client: { url: 'https://piston-data.mojang.com/v1/objects/fake/client.jar', sha1: sha1(jar), size: jar.length } },
      ...(index ? { assetIndex: { id: 'fake', url: 'https://piston-meta.mojang.com/v1/packages/fake/index.json', sha1: sha1(index), size: index.length } } : {}),
    }),
  );
  const manifest = Buffer.from(
    JSON.stringify({
      latest: { release: versionId, snapshot: versionId },
      versions: [{ id: versionId, type: 'release', url: 'https://piston-meta.mojang.com/v1/packages/fake/version.json', sha1: sha1(version) }],
    }),
  );
  let holding: ServerResponse | null = null;
  const state: FakeMojang = {
    origin: '',
    requests: [],
    identifyingHeaders: [],
    jarMode: 'ok',
    objectMode: 'ok',
    holding: () => holding !== null && !holding.destroyed,
    close: async () => {
      server.closeAllConnections();
      await new Promise<void>((r) => server.close(() => r()));
    },
  };
  const server: Server = createServer((req: IncomingMessage, res: ServerResponse) => {
    const path = new URL(req.url ?? '/', 'http://x').pathname;
    state.requests.push(path);
    for (const h of ['user-agent', 'cookie', 'authorization', 'referer']) if (req.headers[h] !== undefined) state.identifyingHeaders.push(h);
    if (path === '/mc/game/version_manifest_v2.json') return void res.writeHead(200, { 'content-length': String(manifest.length) }).end(manifest);
    if (path === '/v1/packages/fake/version.json') return void res.writeHead(200, { 'content-length': String(version.length) }).end(version);
    if (index && path === '/v1/packages/fake/index.json') return void res.writeHead(200, { 'content-length': String(index.length) }).end(index);
    const object = objects.get(path);
    if (object) {
      if (state.objectMode === 'fail') return void res.writeHead(500).end();
      return void res.writeHead(200, { 'content-length': String(object.length) }).end(object);
    }
    if (path === '/v1/objects/fake/client.jar') {
      if (state.jarMode === 'fail') return void res.writeHead(500).end();
      if (state.jarMode === 'hold') {
        // 发一半就停住，直到客户端取消（断开连接）
        res.writeHead(200, { 'content-length': String(jar.length) });
        res.write(jar.subarray(0, jar.length >> 1));
        holding = res;
        res.on('close', () => {
          if (holding === res) holding = null;
        });
        return;
      }
      if (state.jarMode === 'slow') {
        res.writeHead(200, { 'content-length': String(jar.length) });
        const parts = 60;
        let i = 0;
        const timer = setInterval(() => {
          if (res.destroyed) return clearInterval(timer);
          const a = Math.floor((i * jar.length) / parts);
          const b = Math.floor(((i + 1) * jar.length) / parts);
          i += 1;
          if (i >= parts) {
            clearInterval(timer);
            res.end(jar.subarray(a, b));
          } else res.write(jar.subarray(a, b));
        }, 150);
        res.on('close', () => clearInterval(timer));
        return;
      }
      return void res.writeHead(200, { 'content-length': String(jar.length) }).end(jar);
    }
    res.writeHead(404).end();
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const addr = server.address();
  state.origin = `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`;
  return state;
}
