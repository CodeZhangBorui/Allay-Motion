import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { candidateGameDirs, detectMinecraft, findLatestRelease, openVanillaLayer } from '../../apps/desktop/src/main/resources';
import { makeFakeMinecraft, solidPng, tex } from './helpers/resource-fixtures';

// T-AST-6：夹具 .minecraft 目录（含两个版本，其中一个没有 jar），选中有 jar 且最新的正式版。

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'allay-t-ast-6-'));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('T-AST-6 本机 Minecraft 探测', () => {
  it('两个版本，较新的没有 jar：选中有 jar 的那个', async () => {
    const game = join(dir, '.minecraft');
    makeFakeMinecraft(game, [
      { id: 'fx-1.0', type: 'release', releaseTime: '2020-06-01T10:00:00+00:00', jar: true, assetIndex: 'fx-1' },
      { id: 'fx-2.0', type: 'release', releaseTime: '2024-06-01T10:00:00+00:00', jar: false, assetIndex: 'fx-2' },
    ]);
    const found = await findLatestRelease(game);
    expect(found?.versionId).toBe('fx-1.0');
    expect(found?.jarPath).toBe(join(game, 'versions', 'fx-1.0', 'fx-1.0.jar'));
    expect(found?.assetIndexPath).toBe(join(game, 'assets', 'indexes', 'fx-1.json'));
  });

  it('多个有 jar 的版本：只看正式版，取 releaseTime 最新的', async () => {
    const game = join(dir, '.minecraft');
    makeFakeMinecraft(game, [
      { id: 'a', type: 'release', releaseTime: '2021-01-01T00:00:00Z', jar: true },
      { id: 'b', type: 'release', releaseTime: '2023-01-01T00:00:00Z', jar: true, assetIndex: 'b' },
      { id: 'snap', type: 'snapshot', releaseTime: '2025-01-01T00:00:00Z', jar: true },
      { id: 'beta', type: 'old_beta', releaseTime: '2026-01-01T00:00:00Z', jar: true },
    ]);
    expect((await findLatestRelease(game))?.versionId).toBe('b');
  });

  it('目录不存在或没有可用版本：返回 null，不抛错', async () => {
    expect(await findLatestRelease(join(dir, 'nope'))).toBeNull();
    const game = join(dir, 'g');
    makeFakeMinecraft(game, [{ id: 's', type: 'snapshot', releaseTime: '2025-01-01T00:00:00Z', jar: true }]);
    expect(await findLatestRelease(game)).toBeNull();
  });

  it('候选目录：上次手动选的优先，再是官方启动器默认目录', async () => {
    expect(candidateGameDirs({ platform: 'win32', appData: 'C:\\Users\\x\\AppData\\Roaming', home: 'C:\\Users\\x' }, null)).toEqual([
      join('C:\\Users\\x\\AppData\\Roaming', '.minecraft'),
    ]);
    expect(candidateGameDirs({ platform: 'linux', home: '/home/x' }, '/data/mc')).toEqual(['/data/mc', join('/home/x', '.minecraft')]);
    const chosen = join(dir, 'custom');
    makeFakeMinecraft(chosen, [{ id: 'c', type: 'release', releaseTime: '2022-01-01T00:00:00Z', jar: true }]);
    const found = await detectMinecraft({ platform: 'win32', appData: join(dir, 'roaming'), home: dir }, chosen);
    expect(found?.versionId).toBe('c');
  });

  it('原版层：贴图来自 jar，音效与 sounds.json 来自资源索引，索引里的不安全键被忽略', async () => {
    const game = join(dir, '.minecraft');
    makeFakeMinecraft(game, [{ id: 'fx', type: 'release', releaseTime: '2020-01-01T00:00:00Z', jar: true, assetIndex: 'fx' }], '#00ff00');
    const install = await findLatestRelease(game);
    const layer = await openVanillaLayer(install!);
    try {
      expect(layer.kind).toBe('vanilla');
      expect(layer.has(tex('stone'))).toBe(true);
      expect(Buffer.from((await layer.read(tex('stone'))) ?? []).equals(Buffer.from(solidPng('#00ff00')))).toBe(true);
      expect(layer.has('net/fake/Main.class')).toBe(false);
      expect(new TextDecoder().decode((await layer.read('assets/minecraft/sounds.json')) ?? new Uint8Array())).toContain('block.stone.place');
      expect(layer.has('assets/minecraft/sounds/dig/stone1.ogg')).toBe(true);
      expect(layer.list('assets/').some((p) => p.includes('escape'))).toBe(false);
    } finally {
      layer.close();
    }
  });
});
