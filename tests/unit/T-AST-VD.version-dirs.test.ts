import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { fnv1a64, isVersionDirName, VanillaSourceSchema, vanillaLayerId } from '../../packages/assets/src/index';
import { LayerIdSchema, VanillaSourceArgSchema } from '../../apps/desktop/src/shared/resources';
import { createLogger } from '../../apps/desktop/src/main/logger';
import type { VanillaDownloader } from '../../apps/desktop/src/main/resources/download';
import { ResourceService } from '../../apps/desktop/src/main/resources/service';
import { findLatestRelease, isClientJar, listVersions, NotClientJarError, openVanillaLayer } from '../../apps/desktop/src/main/resources/vanilla';
import { SettingsStore } from '../../apps/desktop/src/main/settings-store';
import { makeFakeMinecraft, writeZip } from './helpers/resource-fixtures';

// T-AST-VD：版本目录（docs/03-assets.md 3.12、docs/decisions.md 末尾“版本目录名”一节）。
// 游戏目录全部由测试现拼（纯色假贴图、假 jar），不碰这台机器上真装的游戏，不放任何 Mojang 文件。

let dir: string;
const log = createLogger(null, false);

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'allay-t-ast-vd-'));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

/** 离线的假下载器：没有缓存，也不联网 */
const offline = {
  findCached: async () => null,
  listCached: async () => [],
  listRemoteVersions: async () => {
    throw new Error('no network in tests');
  },
  downloadLatest: async () => {
    throw new Error('no network in tests');
  },
  fetchObject: async () => {
    throw new Error('no network in tests');
  },
  fetchSoundObjects: async (_i: unknown, ids: readonly string[]) => ({ fetched: 0, missing: [...ids] }),
} as unknown as VanillaDownloader;

/** 一次“启动”：读设置文件、开资源服务、做完离线探测 */
async function start(userData: string) {
  const settings = new SettingsStore(join(userData, 'settings.json'), log);
  await settings.load();
  const svc = new ResourceService({
    userDataDir: userData,
    builtinDir: join(dir, 'no-builtin'),
    settings,
    log,
    gameEnv: { platform: 'win32', appData: join(dir, 'roaming'), home: join(dir, 'home') },
    downloader: offline,
    onChanged: () => undefined,
  });
  await svc.init();
  const state = await svc.detectMinecraft();
  return { settings, svc, state };
}

/**
 * PCL 这类启动器的游戏目录：原版 26.2，和它的一个模组版本（目录名带空格，版本 JSON 的 releaseTime 更新）。
 * 和真机上一样：版本 JSON 里有 clientVersion，模组版本目录里的 jar 是原版客户端的副本（根目录 version.json 写着 26.2）
 */
function pclLikeGame(): string {
  const game = join(dir, 'PCL', '.minecraft');
  makeFakeMinecraft(game, [
    { id: '26.2', type: 'release', releaseTime: '2026-06-16T12:03:33+00:00', jar: true, assetIndex: '32', json: { clientVersion: '26.2' }, jarVersion: '26.2' },
    { id: '26.2-Fabric 0.19.3', type: 'release', releaseTime: '2026-06-17T08:00:00+00:00', jar: true, assetIndex: '32', json: { clientVersion: '26.2' }, jarVersion: '26.2' },
  ]);
  return game;
}

function seed(userData: string, resources: unknown): void {
  const file = join(userData, 'settings.json');
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify({ formatVersion: 1, ui: { onboardingCompleted: true, tourCompleted: true }, resources }));
}

describe('T-AST-VD 版本目录', () => {
  it('T-AST-VD-1 复现：同意过、还没有来源、游戏目录里有带空格的版本目录；启动两次之后设置还在，选中的版本打得开', async () => {
    const game = pclLikeGame();
    const userData = join(dir, 'userData');
    seed(userData, { vanilla: { consent: true, enabled: true, dir: game }, vanillaSources: [], packs: [] });

    const first = await start(userData);
    const picked = first.state.layers.filter((l) => l.kind === 'vanilla');
    expect(picked).toHaveLength(1);
    expect(first.state.vanilla.missingSources).toEqual([]);
    expect(first.state.vanilla.problem).toBeNull();
    first.svc.close();
    await first.settings.flush();

    const second = await start(userData);
    expect(second.settings.resources.vanilla).toEqual({ consent: true, enabled: true, dir: game });
    expect(second.settings.resources.vanillaSources).toEqual(first.settings.resources.vanillaSources);
    expect(second.state.layers.filter((l) => l.kind === 'vanilla').map((l) => l.id)).toEqual(picked.map((l) => l.id));
    expect(second.state.vanilla.missingSources).toEqual([]);
    second.svc.close();
    // 写回去的文件也还是这一条
    const written = JSON.parse(readFileSync(join(userData, 'settings.json'), 'utf8')) as { resources: { vanillaSources: unknown[] } };
    expect(written.resources.vanillaSources).toHaveLength(1);
  });

  it('T-AST-VD-2 自动挑选就是版本列表里排最前的正式版：挑不到列表里没有的目录', async () => {
    const game = pclLikeGame();
    const listed = await listVersions(game);
    const latest = await findLatestRelease(game);
    expect(latest).not.toBeNull();
    expect(listed.filter((v) => v.type === 'release')[0]?.versionId).toBe(latest!.versionId);
    expect(listed.some((v) => v.versionId === latest!.versionId)).toBe(true);
  });

  it('T-AST-VD-3 带空格、括号、中文的目录都列出来；游戏版本取 clientVersion，其次 inheritsFrom；发布时间相同时原版目录在前', async () => {
    const game = join(dir, 'g');
    const t1201 = '2023-06-12T13:25:51+00:00';
    makeFakeMinecraft(game, [
      { id: '1.20.1-Fabric 0.19.3', type: 'release', releaseTime: t1201, jar: true, assetIndex: '5', json: { clientVersion: '1.20.1' } },
      { id: '1.21.8-Fabric_0.17.3(生电)', type: 'release', releaseTime: '2025-07-17T12:04:02+00:00', jar: true, json: { clientVersion: '1.21.8' } },
      { id: '锻造之旅—无尽征途0.3.1.6', type: 'release', releaseTime: t1201, jar: true, json: { clientVersion: '1.20.1' } },
      { id: '1.20.1-OptiFine', type: 'release', releaseTime: t1201, jar: true, json: { inheritsFrom: '1.20.1' } },
      { id: '1.20.1', type: 'release', releaseTime: t1201, jar: true, json: { clientVersion: '1.20.1' } },
      // 只装了加载器、没有 jar 的不列；版本 JSON 里展示用的字段坏了不连累整个版本
      { id: 'fabric-loader-0.16.10-1.21.1', type: 'release', releaseTime: '2026-11-06T18:54:29+00:00', jar: false, json: { inheritsFrom: '1.21.1' } },
      { id: 'bad fields', type: 'release', releaseTime: '2020-01-01T00:00:00Z', jar: true, json: { clientVersion: 'not a version!', inheritsFrom: 42, assetIndex: { id: '../x' } } },
    ]);
    const list = await listVersions(game);
    expect(list.map((v) => [v.versionId, v.gameVersion ?? null])).toEqual([
      ['1.21.8-Fabric_0.17.3(生电)', '1.21.8'],
      ['1.20.1', null],
      ['锻造之旅—无尽征途0.3.1.6', '1.20.1'],
      ['1.20.1-OptiFine', '1.20.1'],
      ['1.20.1-Fabric 0.19.3', '1.20.1'],
      ['bad fields', null],
    ]);
    expect(list.find((v) => v.versionId === '1.20.1-Fabric 0.19.3')?.assetIndexPath).toBe(join(game, 'assets', 'indexes', '5.json'));
    expect(list.find((v) => v.versionId === 'bad fields')?.assetIndexPath).toBeNull();
    expect((await findLatestRelease(game))?.versionId).toBe('1.21.8-Fabric_0.17.3(生电)');
  });

  it('T-AST-VD-4 目录名的规则：没有分隔符和控制字符、不是 . ..、不超过 255 个字符；设置和 IPC 用同一套，下载的来源仍然只收版本号', () => {
    for (const ok of ['26.2', '1.20.1-Fabric 0.19.3', '1.21.8-Fabric_0.17.3(生电)', '锻造之旅—无尽征途0.3.1.6', 'Lucky World Invasion', 'x'.repeat(255), '..a', 'a..']) {
      expect(isVersionDirName(ok), ok).toBe(true);
      expect(VanillaSourceArgSchema.safeParse({ kind: 'local', gameDir: 'D:\\mc', versionId: ok }).success, ok).toBe(true);
      expect(VanillaSourceSchema.safeParse({ kind: 'local', gameDir: 'D:\\mc', versionId: ok }).success, ok).toBe(true);
    }
    for (const bad of ['', '.', '..', 'a/b', 'a\\b', '../x', '..\\x', 'x'.repeat(256), 'a\u0000b', 'line\nbreak', 'tab\t', '\u007f']) {
      expect(isVersionDirName(bad), JSON.stringify(bad)).toBe(false);
      expect(VanillaSourceArgSchema.safeParse({ kind: 'local', gameDir: 'D:\\mc', versionId: bad }).success, JSON.stringify(bad)).toBe(false);
      expect(VanillaSourceSchema.safeParse({ kind: 'local', gameDir: 'D:\\mc', versionId: bad }).success, JSON.stringify(bad)).toBe(false);
    }
    expect(VanillaSourceArgSchema.safeParse({ kind: 'downloaded', versionId: '1.20.1-Fabric 0.19.3' }).success).toBe(false);
    expect(VanillaSourceSchema.safeParse({ kind: 'downloaded', versionId: '1.20.1-Fabric 0.19.3' }).success).toBe(false);
  });

  it('T-AST-VD-5 层 id：旧的（目录名只有安全字符）一个字都不变；其余用哈希，稳定、互不相同、只有安全字符', () => {
    const g = 'D:\\PCL\\.minecraft';
    expect(vanillaLayerId({ kind: 'local', gameDir: g, versionId: '1.21.11' })).toBe(`vanilla:local:${fnv1a64(g).slice(0, 10)}:1.21.11`);
    expect(vanillaLayerId({ kind: 'downloaded', versionId: '26.3' })).toBe('vanilla:dl:26.3');
    const a = vanillaLayerId({ kind: 'local', gameDir: g, versionId: '1.20.1-Fabric 0.19.3' });
    const b = vanillaLayerId({ kind: 'local', gameDir: g, versionId: '1.20.1-Fabric 0.19.4' });
    const c = vanillaLayerId({ kind: 'local', gameDir: 'E:\\mc', versionId: '1.20.1-Fabric 0.19.3' });
    const d = vanillaLayerId({ kind: 'local', gameDir: g, versionId: 'x'.repeat(255) });
    expect(a).toMatch(/^vanilla:local:[0-9a-f]{10}:~[0-9a-f]{16}$/);
    expect(a).toBe(vanillaLayerId({ kind: 'local', gameDir: g, versionId: '1.20.1-Fabric 0.19.3' }));
    expect(new Set([a, b, c]).size).toBe(3);
    // 不是 VersionIdSchema 的目录名才用哈希：255 个 x 太长，也走哈希
    expect(d).toMatch(/:~[0-9a-f]{16}$/);
    for (const id of [a, b, c, d]) expect(LayerIdSchema.safeParse(id).success).toBe(true);
  });

  it('T-AST-VD-6 设置里登记的带空格的来源：读得进来、打得开；层名是真实的游戏版本，目录名另外给；版本列表里也有它', async () => {
    const game = pclLikeGame();
    const source = { kind: 'local', gameDir: game, versionId: '26.2-Fabric 0.19.3' } as const;
    const userData = join(dir, 'userData');
    seed(userData, { vanilla: { consent: true, enabled: true, dir: game }, vanillaSources: [{ id: vanillaLayerId(source), source, enabled: true }], packs: [] });
    const { svc, state, settings } = await start(userData);
    expect(settings.resources.vanillaSources.map((v) => v.source)).toEqual([source]);
    expect(state.layers.find((l) => l.kind === 'vanilla')).toMatchObject({ id: vanillaLayerId(source), name: '26.2', versionId: '26.2-Fabric 0.19.3', gameVersion: '26.2', source: 'local', gameDir: game });
    expect(state.vanilla.baseVersion).toBe('26.2');
    const c = svc.versions();
    expect(c.local.map((v) => [v.versionId, v.gameVersion ?? null, v.layerId])).toEqual([
      ['26.2-Fabric 0.19.3', '26.2', vanillaLayerId(source)],
      ['26.2', null, null],
    ]);
    svc.close();
  });

  it('T-AST-VD-7 从版本列表加入中文名的目录；扫描时没见过的目录名（哪怕合规）、别的游戏目录都不加', async () => {
    const game = pclLikeGame();
    makeFakeMinecraft(game, [{ id: '锻造之旅—无尽征途0.3.1.6', type: 'release', releaseTime: '2023-06-12T13:25:51+00:00', jar: true, json: { clientVersion: '1.20.1' }, jarVersion: '1.20.1' }]);
    const userData = join(dir, 'userData');
    seed(userData, { vanilla: { consent: true, enabled: true, dir: game }, vanillaSources: [], packs: [] });
    const { svc } = await start(userData);
    let s = await svc.addVanillaSource({ kind: 'local', gameDir: game, versionId: '锻造之旅—无尽征途0.3.1.6' });
    expect(s.vanilla.baseVersion).toBe('1.20.1');
    expect(s.layers.filter((l) => l.kind === 'vanilla').at(-1)).toMatchObject({ versionId: '锻造之旅—无尽征途0.3.1.6', name: '1.20.1', base: true });
    const before = s.layers.map((l) => l.id);
    s = await svc.addVanillaSource({ kind: 'local', gameDir: game, versionId: '1.20.1-Fabric 9.9.9' });
    expect(s.layers.map((l) => l.id)).toEqual(before);
    s = await svc.addVanillaSource({ kind: 'local', gameDir: join(dir, 'elsewhere'), versionId: '26.2-Fabric 0.19.3' });
    expect(s.layers.map((l) => l.id)).toEqual(before);
    svc.close();
  });

  /** OptiFine 这类只装了加载器的版本目录：jar 是个空壳（没有 assets/minecraft/），游戏用的是 inheritsFrom 的原版 */
  function addStubVersion(game: string, id: string, releaseTime: string): void {
    makeFakeMinecraft(game, [{ id, type: 'release', releaseTime, jar: false, json: { inheritsFrom: '1.20.1' } }]);
    writeZip(join(game, 'versions', id, `${id}.jar`), [
      { name: 'META-INF/MANIFEST.MF', data: 'Manifest-Version: 1.0\n' },
      { name: 'notes/readme.txt', data: 'launcher stub' },
    ]);
  }

  it('T-AST-VD-8 jar 不是完整的原版客户端：版本列表里照样列出；自动挑选跳过它；加入时不登记，列表上标出来', async () => {
    const game = join(dir, 'g');
    makeFakeMinecraft(game, [{ id: '1.20.1', type: 'release', releaseTime: '2023-06-12T13:25:51+00:00', jar: true }]);
    addStubVersion(game, '1.20.1-OptiFine_HD_U_I6', '2024-01-01T00:00:00+00:00');
    expect((await listVersions(game)).map((v) => v.versionId)).toEqual(['1.20.1-OptiFine_HD_U_I6', '1.20.1']);
    expect(await isClientJar(join(game, 'versions', '1.20.1-OptiFine_HD_U_I6', '1.20.1-OptiFine_HD_U_I6.jar'))).toBe(false);
    expect((await findLatestRelease(game))?.versionId).toBe('1.20.1');
    await expect(openVanillaLayer((await listVersions(game))[0]!)).rejects.toBeInstanceOf(NotClientJarError);

    const userData = join(dir, 'userData');
    seed(userData, { vanilla: { consent: true, enabled: true, dir: game }, vanillaSources: [], packs: [] });
    const { svc, settings } = await start(userData);
    const before = settings.resources.vanillaSources;
    const s = await svc.addVanillaSource({ kind: 'local', gameDir: game, versionId: '1.20.1-OptiFine_HD_U_I6' });
    expect(settings.resources.vanillaSources).toEqual(before);
    expect(s.layers.filter((l) => l.kind === 'vanilla').map((l) => l.versionId)).toEqual(['1.20.1']);
    expect(svc.versions().local.map((v) => [v.versionId, v.problem ?? null])).toEqual([
      ['1.20.1-OptiFine_HD_U_I6', 'not-client'],
      ['1.20.1', null],
    ]);
    svc.close();
  });

  it('T-AST-VD-9 登记过的来源换成了不完整的 jar：单独列出、说明原因；只有它一个时原版的提示也说是 jar 不完整', async () => {
    const game = join(dir, 'g');
    addStubVersion(game, 'stub', '2024-01-01T00:00:00+00:00');
    makeFakeMinecraft(game, [{ id: '1.21.1', type: 'release', releaseTime: '2024-08-08T12:24:45+00:00', jar: true }]);
    const stub = { kind: 'local', gameDir: game, versionId: 'stub' } as const;
    const good = { kind: 'local', gameDir: game, versionId: '1.21.1' } as const;
    const userData = join(dir, 'userData');
    seed(userData, { vanilla: { consent: true, enabled: true, dir: game }, vanillaSources: [{ id: vanillaLayerId(stub), source: stub, enabled: true }], packs: [] });
    let run = await start(userData);
    expect(run.state.vanilla.missingSources).toEqual([{ id: vanillaLayerId(stub), versionId: 'stub', kind: 'local', gameDir: game, problem: 'not-client' }]);
    expect(run.state.vanilla.problem).toBe('not-client');
    run.svc.close();

    // 和一个好的来源在一起：好的照常，提示只落在这一条上
    seed(userData, {
      vanilla: { consent: true, enabled: true, dir: game },
      vanillaSources: [
        { id: vanillaLayerId(good), source: good, enabled: true },
        { id: vanillaLayerId(stub), source: stub, enabled: true },
      ],
      packs: [],
    });
    run = await start(userData);
    expect(run.state.layers.filter((l) => l.kind === 'vanilla').map((l) => l.versionId)).toEqual(['1.21.1']);
    expect(run.state.vanilla.missingSources.map((m) => [m.versionId, m.problem])).toEqual([['stub', 'not-client']]);
    expect(run.state.vanilla.problem).toBeNull();
    // 找不到的仍是 missing
    run.svc.close();
    rmSync(join(game, 'versions', '1.21.1'), { recursive: true });
    run = await start(userData);
    expect(run.state.vanilla.missingSources.map((m) => [m.versionId, m.problem])).toEqual([
      ['1.21.1', 'missing'],
      ['stub', 'not-client'],
    ]);
    expect(run.state.vanilla.problem).toBe('missing');
    run.svc.close();
  });
});
