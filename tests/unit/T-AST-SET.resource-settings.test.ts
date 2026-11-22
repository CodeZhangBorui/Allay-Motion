import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { vanillaLayerId, type VanillaSource } from '../../packages/assets/src/index';
import type { Logger } from '../../apps/desktop/src/main/logger';
import { SettingsStore } from '../../apps/desktop/src/main/settings-store';
import { migrateSettingsFile, readResourceSettings } from '../../apps/desktop/src/shared/settings';

// T-AST-SET：settings.json 里的资源栈坏了一条，只丢那一条（docs/03-assets.md 3.12、docs/decisions.md 末尾“版本目录名”一节）。
// 以前整节 resources 只要有一处过不了 schema 就静默退回默认值：同意、选过的游戏目录、全部原版来源和资源包一起没了。

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'allay-t-ast-set-'));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const G = 'D:\\Games\\.minecraft';
const local = (versionId: string): VanillaSource => ({ kind: 'local', gameDir: G, versionId });
const entry = (source: VanillaSource, enabled = true) => ({ id: vanillaLayerId(source), source, enabled });
const zipPack = { id: 'zip:0123456789abcdef', name: 'Faithful', source: { kind: 'zip', file: `${'a'.repeat(64)}.zip` }, enabled: true };
const folderPack = { id: 'folder:6f1c', name: 'Mine', source: { kind: 'folder', path: 'D:\\packs\\Mine' }, enabled: false };

/** 记下 warn 的假日志 */
function recordingLog(): Logger & { warnings: { message: string; data?: Record<string, unknown> }[] } {
  const warnings: { message: string; data?: Record<string, unknown> }[] = [];
  return { file: null, warnings, debug: () => undefined, info: () => undefined, error: () => undefined, warn: (_scope, message, data) => void warnings.push({ message, ...(data ? { data } : {}) }) };
}

describe('T-AST-SET 资源栈设置：坏一条只丢一条', () => {
  it('T-AST-SET-1 一条原版来源坏了：只丢它，同意、游戏目录、其余来源和资源包都在，并记下丢了什么', () => {
    const good = entry(local('1.21.11'));
    const dl = entry({ kind: 'downloaded', versionId: '26.3' }, false);
    const notes: string[] = [];
    const s = readResourceSettings(
      {
        vanilla: { consent: true, enabled: true, dir: G },
        vanillaSources: [good, { id: 'vanilla:local:x:a/b', source: { kind: 'local', gameDir: G, versionId: 'a/b' }, enabled: true }, dl],
        packs: [zipPack, folderPack],
      },
      notes,
    );
    expect(s).toEqual({ vanilla: { consent: true, enabled: true, dir: G }, vanillaSources: [good, dl], packs: [zipPack, folderPack] });
    expect(notes).toHaveLength(1);
    expect(notes[0]).toMatch(/vanillaSources\[1\] dropped/);
    expect(notes[0]).toContain('a/b');
  });

  it('T-AST-SET-2 资源包坏了一个、重复了一个：各自丢掉；id 撞上原版层的也丢', () => {
    const notes: string[] = [];
    const s = readResourceSettings(
      {
        vanilla: { consent: false, enabled: true, dir: null },
        vanillaSources: [],
        packs: [zipPack, { ...zipPack, name: 'again' }, { id: 'zip:x', name: 'bad', source: { kind: 'zip', file: '../evil.zip' }, enabled: true }, { ...folderPack, id: 'vanilla:dl:26.3' }, folderPack],
      },
      notes,
    );
    expect(s.packs).toEqual([zipPack, folderPack]);
    expect(notes.map((n) => n.replace(/:.*/s, ''))).toEqual(['resources.packs[1] dropped (duplicate id zip', 'resources.packs[2] dropped', 'resources.packs[3] dropped (id vanilla']);
  });

  it('T-AST-SET-3 原版来源的 id 按来源重新算；同一个来源出现两次只留第一条；超过 64 条的丢掉', () => {
    const notes: string[] = [];
    const a = local('1.20.1');
    const sources = [{ id: 'stale-id', source: a, enabled: false }, { id: 'whatever', source: a, enabled: true }, ...Array.from({ length: 70 }, (_, i) => entry(local(`1.${i}`)))];
    const s = readResourceSettings({ vanilla: { consent: true, enabled: true, dir: null }, vanillaSources: sources, packs: [] }, notes);
    expect(s.vanillaSources[0]).toEqual({ id: vanillaLayerId(a), source: a, enabled: false });
    expect(s.vanillaSources).toHaveLength(64);
    expect(new Set(s.vanillaSources.map((v) => v.id)).size).toBe(64);
    expect(notes.filter((n) => n.includes('duplicate'))).toHaveLength(1);
    expect(notes.filter((n) => n.includes('more than 64'))).toHaveLength(7);
    expect(notes.some((n) => n.includes('"stale-id"'))).toBe(true);
  });

  it('T-AST-SET-4 vanilla 的三个字段各自兜底；不认识的键忽略；开关坏了算开着', () => {
    const notes: string[] = [];
    const s = readResourceSettings(
      { vanilla: { consent: 'yes', enabled: false, dir: G, extra: 1 }, vanillaSources: [{ ...entry(local('1.21.1')), enabled: 'on', note: 'x' }], packs: [{ ...zipPack, enabled: 3, future: true }], future: { a: 1 } },
      notes,
    );
    expect(s.vanilla).toEqual({ consent: null, enabled: false, dir: G });
    expect(s.vanillaSources).toEqual([entry(local('1.21.1'))]);
    expect(s.packs).toEqual([zipPack]);
    expect(notes).toEqual(['resources.vanilla.consent reset: "yes"']);
  });

  it('T-AST-SET-5 整节不是对象、各部分类型不对：用默认值，不抛错；没有这一节的旧文件不记任何东西', () => {
    const notes: string[] = [];
    expect(readResourceSettings('broken', notes)).toEqual({ vanilla: { consent: null, enabled: true, dir: null }, vanillaSources: [], packs: [] });
    expect(readResourceSettings({ vanilla: [], vanillaSources: {}, packs: 'x' }, notes)).toEqual({ vanilla: { consent: null, enabled: true, dir: null }, vanillaSources: [], packs: [] });
    expect(notes).toHaveLength(4);
    const quiet: string[] = [];
    expect(migrateSettingsFile({ formatVersion: 1 }, quiet)?.resources).toEqual({ vanilla: { consent: null, enabled: true, dir: null }, vanillaSources: [], packs: [] });
    expect(quiet).toEqual([]);
  });

  it('T-AST-SET-6 读设置文件：坏的那一条写进日志，下次写文件时它不在了，其余原样保留', async () => {
    const file = join(dir, 'settings.json');
    const good = entry(local('1.21.11'));
    writeFileSync(
      file,
      JSON.stringify({
        formatVersion: 1,
        ui: { theme: 'light' },
        resources: { vanilla: { consent: true, enabled: true, dir: G }, vanillaSources: [{ id: 'bad', source: { kind: 'local', gameDir: G, versionId: '..' }, enabled: true }, good], packs: [zipPack] },
      }),
    );
    const log = recordingLog();
    const store = new SettingsStore(file, log);
    const s = await store.load();
    expect(s.resources).toEqual({ vanilla: { consent: true, enabled: true, dir: G }, vanillaSources: [good], packs: [zipPack] });
    expect(s.ui.theme).toBe('light');
    expect(log.warnings).toEqual([{ message: 'invalid settings entry ignored', data: { note: expect.stringContaining('vanillaSources[0] dropped') } }]);
    await store.updateResources({ ...store.resources, vanilla: { ...store.resources.vanilla, enabled: false } });
    const written = JSON.parse(readFileSync(file, 'utf8')) as { resources: unknown };
    expect(written.resources).toEqual({ vanilla: { consent: true, enabled: false, dir: G }, vanillaSources: [good], packs: [zipPack] });
  });
});
