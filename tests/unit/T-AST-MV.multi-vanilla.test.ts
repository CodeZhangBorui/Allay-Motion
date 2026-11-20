import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createLogger } from '../../apps/desktop/src/main/logger';
import { DownloadError, type CachedVanilla, type VanillaDownloader } from '../../apps/desktop/src/main/resources/download';
import { discoverLocalPackFolders } from '../../apps/desktop/src/main/resources/local-packs';
import { ResourceService } from '../../apps/desktop/src/main/resources/service';
import { listVersions } from '../../apps/desktop/src/main/resources/vanilla';
import { SettingsStore } from '../../apps/desktop/src/main/settings-store';
import { makeFakeMinecraft, packMcmeta, solidPng, tex, writeFiles, writeZip } from './helpers/resource-fixtures';

// 2026-11 反馈：多个原版来源共存（T-AST-MV-*）、版本检索（T-AST-VER-*）、本机 Minecraft 的资源包文件夹（T-AST-LP-*）。
// 全部是脚本生成的假数据（纯色色块、假 jar），不联网，不碰这台机器上真装的游戏。

let dir: string;
const log = createLogger(null, false);

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'allay-mv-'));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

const b64 = (u: Uint8Array) => Buffer.from(u).toString('base64');
const STONE = 'minecraft:block/stone';

/** 假的下载缓存：一个“已下载”的 26.3，jar 里的石头是黄色，根目录 version.json 写着格式 80.1 */
function fakeCache(): CachedVanilla {
  const cacheDir = join(dir, 'vanilla-cache');
  const jarPath = join(cacheDir, 'versions', '26.3', 'client.jar');
  writeZip(jarPath, [
    { name: 'version.json', data: JSON.stringify({ id: '26.3', name: '26.3', pack_version: { resource_major: 80, resource_minor: 1, data_major: 90, data_minor: 0 } }) },
    { name: tex('stone'), data: solidPng('#ffff00') },
    { name: tex('dirt'), data: solidPng('#ffff00') },
  ]);
  return { source: 'downloaded', gameDir: cacheDir, versionId: '26.3', releaseTime: '2026-09-15T00:00:00+00:00', jarPath, assetIndexPath: null, objectsDir: join(cacheDir, 'objects'), type: 'release' };
}

function downloader(cached: CachedVanilla | null): VanillaDownloader {
  return {
    findCached: async () => cached,
    listCached: async () => (cached ? [cached] : []),
    listRemoteVersions: async () => ({
      latest: '26.3',
      versions: [
        { id: '26.3', type: 'release', releaseTime: '2026-09-15T00:00:00+00:00' },
        { id: '26.4-snapshot-1', type: 'snapshot', releaseTime: '2026-10-01T00:00:00+00:00' },
        { id: '1.20.1', type: 'release', releaseTime: '2023-06-12T00:00:00+00:00' },
      ],
    }),
    downloadLatest: async () => {
      throw new DownloadError('offline in tests', 'network');
    },
    fetchObject: async () => {
      throw new Error('no network in tests');
    },
    fetchSoundObjects: async (_i: unknown, ids: readonly string[]) => ({ fetched: 0, missing: [...ids] }),
  } as unknown as VanillaDownloader;
}

async function makeService(opts: { cached?: boolean; settings?: (s: SettingsStore) => Promise<void> } = {}) {
  const appData = join(dir, 'appdata');
  const game = join(appData, '.minecraft');
  makeFakeMinecraft(
    game,
    [
      { id: '1.21.11', type: 'release', releaseTime: '2025-12-09T00:00:00+00:00', jar: true, assetIndex: '29' },
      { id: '25w45a', type: 'snapshot', releaseTime: '2025-11-04T00:00:00+00:00', jar: true },
      { id: '1.20.1', type: 'release', releaseTime: '2023-06-12T00:00:00+00:00', jar: true },
      { id: '1.21.4', type: 'release', releaseTime: '2024-12-03T00:00:00+00:00', jar: false },
    ],
    '#00ff00',
  );
  const userData = join(dir, 'userData');
  const settings = new SettingsStore(join(userData, 'settings.json'), log);
  await settings.load();
  await opts.settings?.(settings);
  const svc = new ResourceService({
    userDataDir: userData,
    builtinDir: join(dir, 'no-builtin'),
    settings,
    log,
    gameEnv: { platform: 'win32', appData, home: join(dir, 'home') },
    downloader: downloader(opts.cached ? fakeCache() : null),
    onChanged: () => undefined,
  });
  await svc.init();
  await svc.detectMinecraft();
  return { svc, settings, game, appData, userData };
}

describe('T-AST-MV 多个原版来源', () => {
  it('T-AST-MV-1 本机的 1.21.11 和下载的 26.3 同时在栈里；最上面启用的是基底；关掉、排序、删除只影响那一个', async () => {
    const { svc, game, settings } = await makeService({ cached: true });
    await svc.addVanillaSource({ kind: 'downloaded', versionId: '26.3' });
    let s = await svc.addVanillaSource({ kind: 'local', gameDir: game, versionId: '1.21.11' });
    const vanilla = s.layers.filter((l) => l.kind === 'vanilla');
    expect(vanilla.map((l) => l.versionId)).toEqual(['26.3', '1.21.11']);
    expect(vanilla.map((l) => l.source)).toEqual(['downloaded', 'local']);
    // 后加的在上面，是基底；同名文件它胜出
    expect(s.vanilla.baseVersion).toBe('1.21.11');
    expect(vanilla.find((l) => l.base)?.versionId).toBe('1.21.11');
    expect(b64((await svc.readTexture(STONE))!.png)).toBe(b64(solidPng('#00ff00')));
    // 基底没有的文件由下面的原版补上
    expect(b64((await svc.readTexture('minecraft:block/dirt'))!.png)).toBe(b64(solidPng('#ffff00')));
    expect(settings.resources.vanillaSources).toHaveLength(2);

    // 关掉上面的：基底换成 26.3
    const top = vanilla[1]!.id;
    s = await svc.setEnabled(top, false);
    expect(s.vanilla.baseVersion).toBe('26.3');
    expect(s.vanilla.active).toBe('cached');
    expect(s.layers.find((l) => l.id === vanilla[0]!.id)?.resourceFormat).toBe('80.1');
    expect(b64((await svc.readTexture(STONE))!.png)).toBe(b64(solidPng('#ffff00')));
    await svc.setEnabled(top, true);

    // 排序（从下往上）：26.3 放到上面
    s = await svc.reorder([top, vanilla[0]!.id]);
    expect(s.layers.filter((l) => l.kind === 'vanilla').map((l) => l.versionId)).toEqual(['1.21.11', '26.3']);
    expect(s.vanilla.baseVersion).toBe('26.3');

    // 删除一个，另一个留着
    s = await svc.removeLayer(vanilla[0]!.id);
    expect(s.layers.filter((l) => l.kind === 'vanilla').map((l) => l.versionId)).toEqual(['1.21.11']);
    expect(s.vanilla.consent).toBe(true);
    // 删掉最后一个：不再使用原版素材
    s = await svc.removeLayer(top);
    expect(s.layers.filter((l) => l.kind === 'vanilla')).toEqual([]);
    expect(s.vanilla.consent).toBe(false);
    svc.close();
  });

  it('T-AST-MV-2 资源包始终在所有原版层之上；排序时资源包和原版层各排各的', async () => {
    const { svc, game } = await makeService({ cached: true });
    await svc.addVanillaSource({ kind: 'local', gameDir: game, versionId: '1.21.11' });
    const pack = join(dir, 'pack');
    writeFiles(pack, { 'pack.mcmeta': packMcmeta('p', 15), [tex('stone')]: solidPng('#0000ff') });
    await svc.addPackFromPath(pack);
    let s = await svc.addVanillaSource({ kind: 'downloaded', versionId: '26.3' });
    expect(s.layers.map((l) => l.kind)).toEqual(['builtin', 'vanilla', 'vanilla', 'pack']);
    const ids = s.layers.slice(1).map((l) => l.id);
    // 页面试图把资源包拖到原版下面：资源包仍在最上面，原版层之间按给的顺序
    s = await svc.reorder([ids[2]!, ids[1]!, ids[0]!]);
    expect(s.layers.map((l) => l.kind)).toEqual(['builtin', 'vanilla', 'vanilla', 'pack']);
    expect(s.layers.filter((l) => l.kind === 'vanilla').map((l) => l.versionId)).toEqual(['26.3', '1.21.11']);
    // 资源包与基底的匹配：基底 1.21.11 的假 jar 里没有 version.json、对照表里也没有，不知道格式
    expect(s.layers.find((l) => l.kind === 'pack')).toMatchObject({ formats: { min: '15', max: '15' }, madeFor: '1.20–1.20.1', compat: 'unknown' });
    // 26.3 放到上面（格式 80.1）：包的格式 15 比它旧
    s = await svc.reorder([ids[0]!, ids[1]!]);
    expect(s.vanilla.baseVersion).toBe('26.3');
    expect(s.layers.find((l) => l.kind === 'pack')).toMatchObject({ compat: 'older' });
    svc.close();
  });

  it('T-AST-MV-3 旧设置（只有同意、没有来源列表）迁移成一条来源：按旧规则取较新的那个', async () => {
    const { svc, settings } = await makeService({
      cached: true,
      settings: async (st) => st.updateResources({ ...st.resources, vanilla: { consent: true, enabled: true, dir: null }, vanillaSources: [] }),
    });
    const s = svc.state();
    expect(settings.resources.vanillaSources.map((v) => v.source)).toEqual([{ kind: 'downloaded', versionId: '26.3' }]);
    expect(s.vanilla.active).toBe('cached');
    svc.close();
  });

  it('T-AST-MV-4 登记过的来源找不到了：列进 missingSources，其他来源照常', async () => {
    const { svc, game } = await makeService({ cached: true });
    await svc.addVanillaSource({ kind: 'downloaded', versionId: '26.3' });
    await svc.addVanillaSource({ kind: 'local', gameDir: game, versionId: '1.20.1' });
    svc.close();
    rmSync(join(game, 'versions', '1.20.1', '1.20.1.jar'));
    const s = await svc.detectMinecraft();
    expect(s.vanilla.missingSources.map((m) => m.versionId)).toEqual(['1.20.1']);
    expect(s.layers.filter((l) => l.kind === 'vanilla').map((l) => l.versionId)).toEqual(['26.3']);
    expect(s.vanilla.problem).toBeNull();
    svc.close();
  });

  it('T-AST-MV-5 不在探测结果里的来源不加（页面不能塞任意路径）', async () => {
    const { svc } = await makeService();
    const s = await svc.addVanillaSource({ kind: 'local', gameDir: join(dir, 'elsewhere'), versionId: '1.21.11' });
    expect(s.layers.filter((l) => l.kind === 'vanilla')).toEqual([]);
    svc.close();
  });
});

describe('T-AST-VER 版本检索', () => {
  it('T-AST-VER-1 本机 versions/ 里带 jar 的版本（正式版、快照都列），新的在前；没有 jar 的不列', async () => {
    const { game } = await makeService();
    const list = await listVersions(game);
    expect(list.map((v) => [v.versionId, v.type])).toEqual([
      ['1.21.11', 'release'],
      ['25w45a', 'snapshot'],
      ['1.20.1', 'release'],
    ]);
  });

  it('T-AST-VER-2 versions() 合并本机、已下载、版本清单；加进栈的带 layerId；清单里已下载的只列一次由界面处理', async () => {
    const { svc, game } = await makeService({ cached: true });
    await svc.addVanillaSource({ kind: 'local', gameDir: game, versionId: '1.20.1' });
    let c = svc.versions();
    expect(c.local.map((v) => v.versionId)).toEqual(['1.21.11', '25w45a', '1.20.1']);
    expect(c.local.find((v) => v.versionId === '1.20.1')?.layerId).toMatch(/^vanilla:local:/);
    expect(c.local.find((v) => v.versionId === '1.21.11')?.layerId).toBeNull();
    expect(c.downloaded.map((v) => v.versionId)).toEqual(['26.3']);
    expect(c.remote).toBeNull();
    const r = await svc.fetchRemoteVersions();
    expect(r.ok).toBe(true);
    c = svc.versions();
    expect(c.remote?.latest).toBe('26.3');
    expect(c.remote?.versions.map((v) => [v.versionId, v.type])).toEqual([
      ['26.4-snapshot-1', 'snapshot'],
      ['26.3', 'release'],
      ['1.20.1', 'release'],
    ]);
    svc.close();
  });
});

describe('T-AST-LP 本机 Minecraft 的资源包文件夹', () => {
  function makeLaunchers(appData: string, home: string, game: string) {
    // 官方启动器的共用文件夹：一个 zip、一个文件夹包、一个不是资源包的文件夹
    writeZip(join(game, 'resourcepacks', 'Faithful.zip'), [
      { name: 'pack.mcmeta', data: JSON.stringify({ pack: { pack_format: 34, supported_formats: [34, 46], description: 'zip pack' } }) },
      { name: tex('stone'), data: solidPng('#ff00ff') },
    ]);
    writeFiles(join(game, 'resourcepacks', 'MyFolder'), { 'pack.mcmeta': JSON.stringify({ pack: { min_format: [75, 0], max_format: 80, description: 'folder pack' } }) });
    writeFiles(join(game, 'resourcepacks', 'not-a-pack'), { 'readme.txt': 'x' });
    // 版本隔离（PCL/HMCL）：versions/<id>/resourcepacks，游戏版本取 inheritsFrom
    writeFiles(join(game, 'versions', 'Fabric-1.21.1'), {
      'Fabric-1.21.1.json': JSON.stringify({ id: 'Fabric-1.21.1', inheritsFrom: '1.21.1', type: 'release', releaseTime: '2024-08-08T00:00:00+00:00' }),
      'resourcepacks/Iso/pack.mcmeta': packMcmeta('iso', 34),
    });
    // Prism Launcher
    writeFiles(join(appData, 'PrismLauncher', 'instances', 'Survival'), {
      'mmc-pack.json': JSON.stringify({ components: [{ uid: 'org.lwjgl3' }, { uid: 'net.minecraft', version: '1.20.1' }] }),
      '.minecraft/resourcepacks/Prism/pack.mcmeta': packMcmeta('prism', 15),
    });
    // CurseForge
    writeFiles(join(home, 'curseforge', 'minecraft', 'Instances', 'Skyblock'), {
      'minecraftinstance.json': JSON.stringify({ name: 'Skyblock Pack', gameVersion: '1.21.4' }),
      'resourcepacks/CF/pack.mcmeta': packMcmeta('cf', 46),
    });
  }

  it('T-AST-LP-1 认出官方启动器、版本隔离、Prism、CurseForge 的 resourcepacks，写明游戏版本和完整路径', async () => {
    const appData = join(dir, 'appdata');
    const home = join(dir, 'home');
    const game = join(appData, '.minecraft');
    makeLaunchers(appData, home, game);
    const folders = await discoverLocalPackFolders({ platform: 'win32', appData, home }, [game]);
    expect(folders.map((f) => [f.launcher, f.instance, f.gameVersion])).toEqual([
      ['official', null, null],
      ['isolated', 'Fabric-1.21.1', '1.21.1'],
      ['prism', 'Survival', '1.20.1'],
      ['curseforge', 'Skyblock Pack', '1.21.4'],
    ]);
    expect(folders[0]!.path).toBe(join(game, 'resourcepacks'));
    const official = folders[0]!.packs;
    expect(official.map((p) => [p.name, p.kind])).toEqual([
      ['Faithful', 'zip'],
      ['MyFolder', 'folder'],
    ]);
    expect(official[0]!.formats).toEqual({ min: { major: 34, minor: 0 }, max: { major: 46, minor: Number.MAX_SAFE_INTEGER } });
    expect(official[1]!.formats).toEqual({ min: { major: 75, minor: 0 }, max: { major: 80, minor: 0 } });
  });

  it('T-AST-LP-2 加入探测到的 zip：原地引用、不复制进应用数据目录；不在探测结果里的路径被拒绝', async () => {
    const { svc, appData, game, userData } = await makeService();
    makeLaunchers(appData, join(dir, 'home'), game);
    const zip = join(game, 'resourcepacks', 'Faithful.zip');
    expect(await svc.addLocalPack(zip)).toEqual({ ok: false, error: 'unsupported' });
    const folders = await svc.localPacks();
    expect(folders[0]!.packs[0]).toMatchObject({ name: 'Faithful', added: false, formats: { min: '34', max: '46' } });
    const r = await svc.addLocalPack(zip);
    expect(r).toMatchObject({ ok: true });
    const s = svc.state();
    const layer = s.layers.find((l) => l.kind === 'pack')!;
    expect(layer).toMatchObject({ source: 'linked', path: zip });
    expect(b64((await svc.readTexture(STONE))!.png)).toBe(b64(solidPng('#ff00ff')));
    expect(existsSync(join(userData, 'packs')) ? readdirSync(join(userData, 'packs')) : []).toEqual([]);
    expect((await svc.localPacks())[0]!.packs[0]!.added).toBe(true);
    // 重复加入是同一行
    expect(await svc.addLocalPack(zip)).toMatchObject({ ok: true, id: layer.id });
    expect(svc.state().layers.filter((l) => l.kind === 'pack')).toHaveLength(1);
    svc.close();
  });
});
