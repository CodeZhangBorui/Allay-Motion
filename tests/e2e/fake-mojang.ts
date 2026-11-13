// 端到端测试用的本机假 Mojang 服务器（decisions.md M2a、M2b）：假清单 → 假版本 JSON → 假 jar（纯色色块）。
// 只监听 127.0.0.1，应用经测试开关 ALLAY_E2E_MOJANG_ORIGIN 连到这里；pnpm check 不访问真实网络。
import { createHash } from 'node:crypto';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { buildZip, type ZipEntrySpec } from '../unit/helpers/resource-fixtures';

const sha1 = (b: Buffer) => createHash('sha1').update(b).digest('hex');

export type JarMode = 'ok' | 'fail' | 'hold';

export interface FakeMojang {
  origin: string;
  /** 收到的请求路径（按顺序） */
  requests: string[];
  /** 收到的请求里有没有 User-Agent 之类的标识 */
  identifyingHeaders: string[];
  jarMode: JarMode;
  /** hold 模式下 jar 已经发了一半、正在等 */
  holding(): boolean;
  close(): Promise<void>;
}

export async function startFakeMojang(versionId: string, jarEntries: readonly ZipEntrySpec[]): Promise<FakeMojang> {
  const jar = Buffer.from(buildZip(jarEntries));
  const version = Buffer.from(
    JSON.stringify({
      id: versionId,
      type: 'release',
      releaseTime: '2030-01-01T00:00:00+00:00',
      downloads: { client: { url: 'https://piston-data.mojang.com/v1/objects/fake/client.jar', sha1: sha1(jar), size: jar.length } },
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
      return void res.writeHead(200, { 'content-length': String(jar.length) }).end(jar);
    }
    res.writeHead(404).end();
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const addr = server.address();
  state.origin = `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`;
  return state;
}
