import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createLogger } from '../../apps/desktop/src/main/logger';
import type { VanillaDownloader } from '../../apps/desktop/src/main/resources/download';
import { ResourceService } from '../../apps/desktop/src/main/resources/service';
import { listVersions, openVanillaLayer } from '../../apps/desktop/src/main/resources/vanilla';
import { SettingsStore } from '../../apps/desktop/src/main/settings-store';
import { packMcmeta, solidPng, writeFiles, writeZip } from './helpers/resource-fixtures';

// T-AST-IDX：原版层里同一个路径 jar 和资源索引都有时取哪一份（docs/03-assets.md 3.4、docs/decisions.md 末尾“原版层里 jar 和资源索引的重叠”）。
// 真机上 1.20.1 到 26.3 都只有 8 个这样的路径，jar 里那一份全是占位（主菜单全景图是 1×1、include/unifont.json 是空的提供器列表），
// 游戏显示的是索引里的：所以两边都有时以索引为准，索引里的对象不在本机时退回 jar。
// jar 和索引都由测试现拼（纯色假贴图），不放任何 Mojang 文件。

let dir: string;
const log = createLogger(null, false);
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'allay-t-ast-idx-'));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const PANO = (n: number) => `assets/minecraft/textures/gui/title/background/panorama_${n}.png`;
const UNIFONT = 'assets/minecraft/font/include/unifont.json';
const STONE = 'assets/minecraft/textures/block/stone.png';
const SOUNDS = 'assets/minecraft/sounds.json';
const sha1 = (data: Uint8Array | string) => createHash('sha1').update(data).digest('hex');
const b64 = (u: Uint8Array | null | undefined) => Buffer.from(u ?? []).toString('base64');

const JAR_PLACEHOLDER = solidPng('#000000', 1);
const REAL_PANO = solidPng('#ff00ff', 16);
const EMPTY_PROVIDERS = '{\n  "providers": [\n  ]\n}\n';
const REAL_PROVIDERS = JSON.stringify({ providers: [{ type: 'unihex', hex_file: 'minecraft:font/unifont.zip', size_overrides: [] }] });
const JAR_STONE = solidPng('#00ff00');
const SOUNDS_JSON = JSON.stringify({ 'block.stone.place': { sounds: ['dig/stone1'] } });

/**
 * 假游戏目录：jar 里有全景图 0、1 的占位、空的 include/unifont.json 和石头；
 * 资源索引里有全景图 0、1 的“真图”、真的 unifont.json 和 sounds.json，其中全景图 1 的对象不在本机（没下载）
 */
function makeGame(): string {
  const game = join(dir, '.minecraft');
  writeFiles(join(game, 'versions', '9.9'), {
    '9.9.json': JSON.stringify({ id: '9.9', type: 'release', releaseTime: '2030-01-01T00:00:00+00:00', assetIndex: { id: 'idx' } }),
  });
  writeZip(join(game, 'versions', '9.9', '9.9.jar'), [
    { name: PANO(0), data: JAR_PLACEHOLDER },
    { name: PANO(1), data: JAR_PLACEHOLDER },
    { name: UNIFONT, data: EMPTY_PROVIDERS },
    { name: STONE, data: JAR_STONE },
  ]);
  const objects: Record<string, { hash: string; size: number }> = {
    'minecraft/textures/gui/title/background/panorama_0.png': { hash: sha1(REAL_PANO), size: REAL_PANO.byteLength },
    'minecraft/textures/gui/title/background/panorama_1.png': { hash: 'd'.repeat(40), size: 4096 },
    'minecraft/font/include/unifont.json': { hash: sha1(REAL_PROVIDERS), size: REAL_PROVIDERS.length },
    'minecraft/sounds.json': { hash: sha1(SOUNDS_JSON), size: SOUNDS_JSON.length },
  };
  writeFiles(join(game, 'assets', 'indexes'), { 'idx.json': JSON.stringify({ objects }) });
  const obj = (hash: string) => `${hash.slice(0, 2)}/${hash}`;
  writeFiles(join(game, 'assets', 'objects'), {
    [obj(sha1(REAL_PANO))]: REAL_PANO,
    [obj(sha1(REAL_PROVIDERS))]: REAL_PROVIDERS,
    [obj(sha1(SOUNDS_JSON))]: SOUNDS_JSON,
  });
  return game;
}

async function layerOf(game: string) {
  const [install] = await listVersions(game);
  return openVanillaLayer(install!);
}

describe('T-AST-IDX 原版层：jar 和资源索引里都有的路径', () => {
  it('T-AST-IDX-1 两边都有时取资源索引里的：全景图是真图，unifont.json 是真的提供器列表', async () => {
    const layer = await layerOf(makeGame());
    try {
      expect(layer.has(PANO(0))).toBe(true);
      expect(b64(await layer.read(PANO(0)))).toBe(b64(REAL_PANO));
      expect(new TextDecoder().decode((await layer.read(UNIFONT)) ?? new Uint8Array())).toBe(REAL_PROVIDERS);
      expect(await layer.remoteObject?.(PANO(0))).toBeNull();
      // 读取规则变了，层的内容版本也跟着变：资源栈的 stamp 变一次，按旧规则生成的缩略图失效
      expect(layer.revision).toMatch(/:index-first$/);
    } finally {
      layer.close();
    }
  });

  it('T-AST-IDX-2 索引里有、对象不在本机：退回 jar 里的那一份，并报“还没取回”', async () => {
    const layer = await layerOf(makeGame());
    try {
      expect(b64(await layer.read(PANO(1)))).toBe(b64(JAR_PLACEHOLDER));
      expect(await layer.remoteObject?.(PANO(1))).toEqual({ hash: 'd'.repeat(40), size: 4096 });
    } finally {
      layer.close();
    }
  });

  it('T-AST-IDX-3 只有一边有的照旧：只在 jar 里的取 jar，只在索引里的取索引；都没有的是 null', async () => {
    const layer = await layerOf(makeGame());
    try {
      expect(b64(await layer.read(STONE))).toBe(b64(JAR_STONE));
      expect(await layer.remoteObject?.(STONE)).toBeNull();
      expect(new TextDecoder().decode((await layer.read(SOUNDS)) ?? new Uint8Array())).toBe(SOUNDS_JSON);
      expect(await layer.read('assets/minecraft/textures/block/dirt.png')).toBeNull();
      // jar 根目录的文件（version.json 这类）不当资源读
      expect(await layer.read('version.json')).toBeNull();
    } finally {
      layer.close();
    }
  });

  it('T-AST-IDX-4 资源栈里资源包仍然盖在原版之上；没有资源包时取到的是索引里的全景图', async () => {
    const game = makeGame();
    const userData = join(dir, 'userData');
    const settings = new SettingsStore(join(userData, 'settings.json'), log);
    await settings.load();
    const offline = { findCached: async () => null, listCached: async () => [], fetchSoundObjects: async () => ({ fetched: 0, missing: [] }) } as unknown as VanillaDownloader;
    const svc = new ResourceService({ userDataDir: userData, builtinDir: join(dir, 'no-builtin'), settings, log, gameEnv: { platform: 'win32', appData: join(dir, 'roaming'), home: dir }, downloader: offline, onChanged: () => undefined });
    await svc.init();
    await svc.detectMinecraft();
    // 用户在对话框里选了这个游戏目录：其中最新的正式版（9.9）加进资源栈
    expect(await svc.useGameDir(game)).toEqual({ ok: true });
    try {
      expect(b64((await svc.readTexture('minecraft:gui/title/background/panorama_0'))?.png)).toBe(b64(REAL_PANO));
      const pack = join(dir, 'pack');
      const packPano = solidPng('#0000ff', 16);
      writeFiles(pack, { 'pack.mcmeta': packMcmeta('p', 15), [PANO(0)]: packPano });
      await svc.addPackFromPath(pack);
      expect(b64((await svc.readTexture('minecraft:gui/title/background/panorama_0'))?.png)).toBe(b64(packPano));
    } finally {
      svc.close();
    }
  });
});
