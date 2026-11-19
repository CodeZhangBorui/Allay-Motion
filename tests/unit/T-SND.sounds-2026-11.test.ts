import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { AudioCue } from '../../packages/template-sdk/src/index';
import { createLogger } from '../../apps/desktop/src/main/logger';
import { DownloadError, type VanillaDownloader } from '../../apps/desktop/src/main/resources/download';
import { ResourceService } from '../../apps/desktop/src/main/resources/service';
import { SettingsStore } from '../../apps/desktop/src/main/settings-store';
import { spatialFactors, voiceParams } from '../../apps/desktop/src/renderer/audio/schedule';
import { deriveSoundName, parseLangJson, soundCategory } from '../../packages/assets/src/index';
import {
  compareVersionsDesc,
  knownResourceFormat,
  matchesVersionQuery,
  packCompat,
  parseJarVersionJson,
  parsePackFormatRange,
  releasesForFormat,
} from '../../packages/assets/src/versions';
import { makeFakeMinecraft, packMcmeta, writeFiles } from './helpers/resource-fixtures';

// 2026-11 反馈的音效部分（T-SND-*）和版本匹配的纯逻辑（T-AST-VER-3）。
// 语言文件、sounds.json 都是测试里写的假数据（假的中文字幕），不是游戏或 Wiki 的文本。

describe('T-AST-VER-3 资源包格式与版本', () => {
  it('pack.mcmeta 的三种写法', () => {
    expect(parsePackFormatRange(packMcmeta('x', 15))).toEqual({ min: { major: 15, minor: 0 }, max: { major: 15, minor: Number.MAX_SAFE_INTEGER } });
    expect(parsePackFormatRange(JSON.stringify({ pack: { pack_format: 22, supported_formats: { min_inclusive: 18, max_inclusive: 32 } } }))).toEqual({
      min: { major: 18, minor: 0 },
      max: { major: 32, minor: Number.MAX_SAFE_INTEGER },
    });
    expect(parsePackFormatRange(JSON.stringify({ pack: { min_format: [69, 0], max_format: [75, 1] } }))).toEqual({ min: { major: 69, minor: 0 }, max: { major: 75, minor: 1 } });
    expect(parsePackFormatRange('{"pack":{"description":"x"}}')).toBeNull();
    expect(parsePackFormatRange('not json')).toBeNull();
  });

  it('jar 里 version.json 的 pack_version 三种写法', () => {
    expect(parseJarVersionJson(JSON.stringify({ id: '1.16.5', pack_version: 6 }))?.resourceFormat).toEqual({ major: 6, minor: 0 });
    expect(parseJarVersionJson(JSON.stringify({ id: '1.21.1', pack_version: { resource: 34, data: 48 } }))?.resourceFormat).toEqual({ major: 34, minor: 0 });
    expect(parseJarVersionJson(JSON.stringify({ id: '26.3', pack_version: { resource_major: 80, resource_minor: 1 } }))?.resourceFormat).toEqual({ major: 80, minor: 1 });
    expect(parseJarVersionJson('{}')).toBeNull();
  });

  it('匹配、对照表、排序、搜索', () => {
    const range = parsePackFormatRange(packMcmeta('x', 34));
    expect(packCompat(range, { major: 34, minor: 0 })).toBe('ok');
    expect(packCompat(range, { major: 46, minor: 0 })).toBe('older');
    expect(packCompat(range, { major: 15, minor: 0 })).toBe('newer');
    expect(packCompat(null, { major: 15, minor: 0 })).toBe('unknown');
    expect(knownResourceFormat('1.21.1')).toEqual({ major: 34, minor: 0 });
    expect(knownResourceFormat('25w45a')).toBeNull();
    expect(releasesForFormat({ major: 34, minor: 0 })).toBe('1.21–1.21.1');
    // 没有发布时间时按数字版本号
    expect([{ versionId: '1.20.1' }, { versionId: '1.21.11' }, { versionId: '1.21.4' }].sort(compareVersionsDesc).map((v) => v.versionId)).toEqual(['1.21.11', '1.21.4', '1.20.1']);
    // 有发布时间时按发布时间（快照和正式版混排）
    const timed = [
      { versionId: '1.21.4', releaseTime: '2024-12-03T00:00:00Z' },
      { versionId: '25w45a', releaseTime: '2025-11-04T00:00:00Z' },
      { versionId: '1.21.11', releaseTime: '2025-12-09T00:00:00Z' },
    ];
    expect(timed.sort(compareVersionsDesc).map((v) => v.versionId)).toEqual(['1.21.11', '25w45a', '1.21.4']);
    expect(matchesVersionQuery('1.21 prism', '1.21.4', 'C:/PrismLauncher/x')).toBe(true);
    expect(matchesVersionQuery('1.20', '1.21.4')).toBe(false);
  });
});

describe('T-SND-1 分类与显示名', () => {
  it('资源包新增的音乐按事件 ID 或文件路径归进“音乐”分类', () => {
    expect(soundCategory('minecraft:block.stone.place')).toBe('block');
    expect(soundCategory('mypack:music.boss_fight')).toBe('music');
    expect(soundCategory('mypack:bossfight', 'mypack:music/bossfight')).toBe('music');
    expect(soundCategory('mypack:x', 'mypack:records/song')).toBe('music_disc');
    expect(soundCategory('mypack:x', 'mypack:weird/thing')).toBe('other');
  });

  it('从语言文件推名字：字幕；共用字幕时括注主体；音乐、唱片、环境音用生物群系或唱片名；推不出为 null', () => {
    const zh = parseLangJson(
      JSON.stringify({
        'subtitles.block.generic.place': '假字幕-放置',
        'subtitles.entity.allay.ambient': '假字幕-悦灵',
        'block.minecraft.stone': '假名-石头',
        'entity.minecraft.allay': '假名-悦灵',
        'biome.minecraft.cherry_grove': '假名-樱花',
        'jukebox_song.minecraft.cat': '假名-cat',
      }),
    );
    expect(deriveSoundName('minecraft:block.stone.place', 'subtitles.block.generic.place', zh, 'zh-CN')).toBe('假字幕-放置（假名-石头）');
    expect(deriveSoundName('minecraft:entity.allay.ambient', 'subtitles.entity.allay.ambient', zh, 'zh-CN')).toBe('假字幕-悦灵');
    expect(deriveSoundName('minecraft:music.overworld.cherry_grove', undefined, zh, 'zh-CN')).toBe('音乐：假名-樱花');
    expect(deriveSoundName('minecraft:music_disc.cat', undefined, zh, 'en')).toBe('Disc: 假名-cat');
    expect(deriveSoundName('minecraft:ui.button.click', undefined, zh, 'zh-CN')).toBeNull();
    // 其他命名空间只用字幕
    expect(deriveSoundName('mypack:music.overworld.cherry_grove', undefined, zh, 'zh-CN')).toBeNull();
  });
});

describe('T-SND-2 音效来源：原版、资源包改过、资源包新增、导入', () => {
  let dir: string;
  const log = createLogger(null, false);
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'allay-snd-'));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('选择器的库带来源、相关资源包的名字、分类、从语言文件推出的名字；导入的音效在自有命名空间', async () => {
    const appData = join(dir, 'appdata');
    const game = join(appData, '.minecraft');
    makeFakeMinecraft(game, [{ id: '1.21.1', type: 'release', releaseTime: '2024-08-08T00:00:00+00:00', jar: true, assetIndex: '17' }]);
    const userData = join(dir, 'userData');
    const settings = new SettingsStore(join(userData, 'settings.json'), log);
    await settings.load();
    const svc = new ResourceService({
      userDataDir: userData,
      builtinDir: join(dir, 'none'),
      settings,
      log,
      gameEnv: { platform: 'win32', appData, home: join(dir, 'home') },
      downloader: {
        findCached: async () => null,
        listCached: async () => [],
        fetchObject: async () => {
          throw new DownloadError('offline', 'network');
        },
      } as unknown as VanillaDownloader,
      onChanged: () => undefined,
    });
    await svc.init();
    await svc.detectMinecraft();
    await svc.setVanilla({ consent: true });
    // 原版：block.stone.place（假的 dig/stone1）
    let lib = await svc.soundLibrary();
    expect(lib.events).toEqual([{ id: 'minecraft:block.stone.place', state: 'local', origin: 'vanilla', category: 'block' }]);

    // 资源包 A 替换了 dig/stone1 的文件；资源包 B 新增一首音乐（自己的命名空间、事件名没有分类前缀，看文件路径），并带假的中文语言文件
    const a = join(dir, 'A');
    writeFiles(a, { 'pack.mcmeta': packMcmeta('a', 34), 'assets/minecraft/sounds/dig/stone1.ogg': 'OggS-pack-a' });
    const b = join(dir, 'B');
    writeFiles(b, {
      'pack.mcmeta': packMcmeta('b', 34),
      'assets/mypack/sounds.json': JSON.stringify({ bossfight: { sounds: [{ name: 'music/bossfight', stream: true }], subtitle: 'subtitles.mypack.bossfight' } }),
      'assets/mypack/sounds/music/bossfight.ogg': 'OggS-boss',
      'assets/minecraft/lang/zh_cn.json': JSON.stringify({ 'subtitles.mypack.bossfight': '假字幕-首领战' }),
    });
    await svc.addPackFromPath(a);
    await svc.addPackFromPath(b);
    const tmpOgg = join(dir, 'My Whoosh!.ogg');
    writeFiles(dir, { 'My Whoosh!.ogg': 'OggS-mine' });
    const imported = await svc.importSounds([tmpOgg, join(dir, 'not-audio.txt')]);
    expect(imported).toEqual({ ok: true, ids: ['allay_user:imported.my_whoosh'], skipped: 1 });

    lib = await svc.soundLibrary();
    const byId = Object.fromEntries(lib.events.map((e) => [e.id, e]));
    expect(byId['minecraft:block.stone.place']).toMatchObject({ origin: 'overridden', packs: ['A'], category: 'block' });
    expect(byId['mypack:bossfight']).toMatchObject({ origin: 'added', packs: ['B'], category: 'music', names: { 'zh-CN': '假字幕-首领战' } });
    expect(byId['allay_user:imported.my_whoosh']).toMatchObject({ origin: 'imported', state: 'local', names: { 'zh-CN': 'My Whoosh!.ogg', en: 'My Whoosh!.ogg' } });
    expect(lib.lang['zh-CN']).toBe(true);
    // 导入的音效不在资源栈弹层里显示为资源包，也不算“有素材”
    expect(svc.state().layers.find((l) => l.id === 'imported')?.source).toBe('imported');
    expect(await svc.soundVariants('allay_user:imported.my_whoosh')).toEqual([{ file: 'allay_user:imported/my_whoosh', volume: 1, pitch: 1, weight: 1, attenuation: 16 }]);

    await svc.removeImportedSound('allay_user:imported.my_whoosh');
    expect((await svc.soundLibrary()).events.some((e) => e.origin === 'imported')).toBe(false);
    svc.close();
  });
});

describe('T-SND-3 空间音效：原版的线性衰减与左右定位，预览和导出共用一个函数', () => {
  const cue = (spatial: AudioCue['spatial'], extra: Partial<AudioCue> = {}): AudioCue => ({
    sound: 'minecraft:block.stone.place',
    at: 0,
    gain: 1,
    rate: 1,
    pan: 0,
    variant: { file: 'minecraft:dig/stone1', volume: 1, pitch: 1 },
    ...(spatial ? { spatial } : {}),
    ...extra,
  });

  it('距离衰减：增益 = 1 − min(d, 范围) / 范围，范围 = max(音量, 1) × attenuation_distance（默认 16）', () => {
    expect(spatialFactors(cue({ x: 0, y: 0, z: 0 }), 1, true)).toEqual({ gain: 1, pan: 0 });
    expect(spatialFactors(cue({ x: 0, y: 0, z: -8 }), 1, true)).toEqual({ gain: 0.5, pan: 0 });
    expect(spatialFactors(cue({ x: 0, y: 0, z: -16 }), 1, true).gain).toBe(0);
    expect(spatialFactors(cue({ x: 0, y: 0, z: -40 }), 1, true).gain).toBe(0);
    // 音量 2：范围翻倍
    expect(spatialFactors(cue({ x: 0, y: 0, z: -16 }, { gain: 2 }), 1, true).gain).toBe(0.5);
    // sounds.json 的 attenuation_distance
    expect(spatialFactors(cue({ x: 0, y: 0, z: -16 }, { variant: { file: 'f', volume: 1, pitch: 1, attenuation: 32 } }), 1, true).gain).toBe(0.5);
  });

  it('左右定位：声源方向在听者右轴上的分量；正右方 +1、正左方 −1、正前方 0', () => {
    expect(spatialFactors(cue({ x: 4, y: 0, z: 0 }), 1, true).pan).toBe(1);
    expect(spatialFactors(cue({ x: -4, y: 0, z: 0 }), 1, true).pan).toBe(-1);
    expect(spatialFactors(cue({ x: 3, y: 0, z: -4 }), 1, true).pan).toBeCloseTo(0.6, 12);
  });

  it('关着、没有位置、立体声文件：不处理；voiceParams 把系数乘到增益上、把声像加到模板的 pan 上并钳制', () => {
    expect(spatialFactors(cue({ x: 4, y: 0, z: -4 }), 1, false)).toEqual({ gain: 1, pan: 0 });
    expect(spatialFactors(cue(undefined), 1, true)).toEqual({ gain: 1, pan: 0 });
    expect(spatialFactors(cue({ x: 4, y: 0, z: -4 }), 2, true)).toEqual({ gain: 1, pan: 0 });
    const p = voiceParams(cue({ x: 8, y: 0, z: 0 }, { pan: 0.8 }), { channels: 1, enabled: true });
    expect(p).toEqual({ gain: 0.5, rate: 1, pan: 1 });
    expect(voiceParams(cue({ x: 8, y: 0, z: 0 }))).toEqual({ gain: 1, rate: 1, pan: 0 });
  });
});
