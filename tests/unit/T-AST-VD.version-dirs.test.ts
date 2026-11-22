import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createLogger } from '../../apps/desktop/src/main/logger';
import type { VanillaDownloader } from '../../apps/desktop/src/main/resources/download';
import { ResourceService } from '../../apps/desktop/src/main/resources/service';
import { findLatestRelease, listVersions } from '../../apps/desktop/src/main/resources/vanilla';
import { SettingsStore } from '../../apps/desktop/src/main/settings-store';
import { makeFakeMinecraft } from './helpers/resource-fixtures';

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

/** PCL 这类启动器的游戏目录：原版 26.2，和它的一个模组版本（目录名带空格，版本 JSON 的 releaseTime 更新） */
function pclLikeGame(): string {
  const game = join(dir, 'PCL', '.minecraft');
  makeFakeMinecraft(game, [
    { id: '26.2', type: 'release', releaseTime: '2026-06-16T12:03:33+00:00', jar: true, assetIndex: '32' },
    { id: '26.2-Fabric 0.19.3', type: 'release', releaseTime: '2026-06-17T08:00:00+00:00', jar: true, assetIndex: '32' },
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
});
