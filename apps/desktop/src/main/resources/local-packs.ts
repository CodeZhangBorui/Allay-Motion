// 本机 Minecraft 的资源包文件夹（decisions.md“2026-11 反馈：素材与音效”）。只读本机文件，不联网、不复制。
//
// 能可靠认出的位置（按这个顺序列出）：
// 1. 官方启动器的游戏目录（以及用户手动选过的、已加进资源栈的本机原版来源的游戏目录）下的 resourcepacks/：所有版本共用。
// 2. 同一游戏目录下 versions/<id>/resourcepacks/：PCL、HMCL 等启动器的“版本隔离”，游戏版本取版本 JSON 的 inheritsFrom，
//    没有就是 <id> 本身。
// 3. Prism Launcher 的实例：instances/<实例>/{.minecraft,minecraft}/resourcepacks/，版本取 mmc-pack.json 里 net.minecraft 组件。
// 4. CurseForge：~/curseforge/minecraft/Instances/<实例>/resourcepacks/，版本取 minecraftinstance.json 的 gameVersion。
// 5. Modrinth App：profiles/<名字>/resourcepacks/，版本取 profile.json 的 metadata.game_version（新版改存数据库，读不到就不写）。
// 每个文件夹里的 zip 和带 pack.mcmeta 的子文件夹算一个资源包；只读 pack.mcmeta（名称、描述、格式范围）。
import { readdir, readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { parsePackFormatRange, parsePackMeta, type PackFormatRange } from '@allay/assets';
import type { CandidateEnv } from './vanilla';
import { openZip } from './zip';

export type LauncherKind = 'official' | 'isolated' | 'prism' | 'curseforge' | 'modrinth';

export interface LocalPackInfo {
  name: string;
  /** zip 文件或文件夹的完整路径 */
  path: string;
  kind: 'zip' | 'folder';
  description?: string;
  formats: PackFormatRange | null;
}

export interface LocalPackFolder {
  launcher: LauncherKind;
  /** 实例或版本的名字（版本隔离、Prism、CurseForge、Modrinth）；官方启动器为 null */
  instance: string | null;
  /** 对应的游戏版本；官方启动器的共用文件夹、读不到时为 null */
  gameVersion: string | null;
  /** resourcepacks 文件夹的完整路径 */
  path: string;
  packs: LocalPackInfo[];
}

const MAX_JSON_BYTES = 4 * 1024 * 1024;
const MAX_FOLDERS = 200;
const MAX_PACKS_PER_FOLDER = 300;

async function isDir(path: string): Promise<boolean> {
  return stat(path).then(
    (s) => s.isDirectory(),
    () => false,
  );
}

async function readJson(path: string): Promise<unknown> {
  const st = await stat(path).catch(() => null);
  if (!st?.isFile() || st.size > MAX_JSON_BYTES) return null;
  try {
    return JSON.parse((await readFile(path, 'utf8')).trimStart()) as unknown;
  } catch {
    return null;
  }
}

function str(v: unknown, max = 64): string | null {
  return typeof v === 'string' && v.length > 0 && v.length <= max ? v : null;
}

function field(o: unknown, key: string): unknown {
  return typeof o === 'object' && o !== null && !Array.isArray(o) ? (o as Record<string, unknown>)[key] : undefined;
}

async function subdirs(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
  return entries.filter((e) => e.isDirectory() && !e.isSymbolicLink()).map((e) => e.name).sort();
}

/** 一个 resourcepacks 文件夹里的资源包；读不出来的跳过 */
export async function listPacksIn(dir: string): Promise<LocalPackInfo[]> {
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
  const out: LocalPackInfo[] = [];
  for (const e of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (out.length >= MAX_PACKS_PER_FOLDER) break;
    if (e.isSymbolicLink()) continue;
    const path = join(dir, e.name);
    let meta: string | null = null;
    let kind: LocalPackInfo['kind'];
    if (e.isFile() && e.name.toLowerCase().endsWith('.zip')) {
      kind = 'zip';
      try {
        const zip = await openZip(path);
        try {
          const bytes = zip.has('pack.mcmeta') ? await zip.read('pack.mcmeta') : null;
          if (bytes && bytes.byteLength <= 65_536) meta = new TextDecoder().decode(bytes);
        } finally {
          zip.close();
        }
      } catch {
        // 被拒绝或打不开的 zip 不列出（加进资源栈时也会被拒绝）
        continue;
      }
    } else if (e.isDirectory()) {
      kind = 'folder';
      const metaPath = join(path, 'pack.mcmeta');
      const st = await stat(metaPath).catch(() => null);
      if (!st?.isFile() || st.size > 65_536) continue;
      meta = await readFile(metaPath, 'utf8').catch(() => null);
    } else continue;
    if (meta === null && kind === 'folder') continue;
    const parsed = meta ? parsePackMeta(meta) : {};
    const info: LocalPackInfo = { name: kind === 'zip' ? e.name.replace(/\.zip$/i, '') : e.name, path, kind, formats: meta ? parsePackFormatRange(meta) : null };
    if (parsed.description) info.description = parsed.description;
    out.push(info);
  }
  return out;
}

/** 候选位置（不检查是否存在）。gameDirs 是官方结构的游戏目录：默认目录、用户选过的、本机原版来源的 */
export function launcherRoots(env: CandidateEnv): { prism: string[]; curseforge: string[]; modrinth: string[] } {
  const { platform, appData, home } = env;
  if (platform === 'win32') {
    const roaming = appData ?? join(home, 'AppData', 'Roaming');
    return {
      prism: [join(roaming, 'PrismLauncher', 'instances')],
      curseforge: [join(home, 'curseforge', 'minecraft', 'Instances')],
      modrinth: [join(roaming, 'ModrinthApp', 'profiles'), join(roaming, 'com.modrinth.theseus', 'profiles')],
    };
  }
  if (platform === 'darwin') {
    const support = join(home, 'Library', 'Application Support');
    return {
      prism: [join(support, 'PrismLauncher', 'instances')],
      curseforge: [join(home, 'Documents', 'curseforge', 'minecraft', 'Instances')],
      modrinth: [join(support, 'ModrinthApp', 'profiles'), join(support, 'com.modrinth.theseus', 'profiles')],
    };
  }
  return {
    prism: [join(home, '.local', 'share', 'PrismLauncher', 'instances')],
    curseforge: [],
    modrinth: [join(home, '.local', 'share', 'ModrinthApp', 'profiles'), join(home, '.local', 'share', 'com.modrinth.theseus', 'profiles')],
  };
}

/** 探测本机所有能认出的资源包文件夹。只读，不抛错 */
export async function discoverLocalPackFolders(env: CandidateEnv, gameDirs: readonly string[]): Promise<LocalPackFolder[]> {
  const out: LocalPackFolder[] = [];
  const seen = new Set<string>();
  const push = async (f: Omit<LocalPackFolder, 'packs'>) => {
    const key = f.path.toLowerCase();
    if (seen.has(key) || out.length >= MAX_FOLDERS || !(await isDir(f.path))) return;
    seen.add(key);
    out.push({ ...f, packs: await listPacksIn(f.path) });
  };
  for (const gameDir of new Set(gameDirs)) {
    await push({ launcher: 'official', instance: null, gameVersion: null, path: join(gameDir, 'resourcepacks') });
    for (const id of await subdirs(join(gameDir, 'versions'))) {
      const dir = join(gameDir, 'versions', id, 'resourcepacks');
      if (!(await isDir(dir))) continue;
      const json = await readJson(join(gameDir, 'versions', id, `${id}.json`));
      await push({ launcher: 'isolated', instance: id, gameVersion: str(field(json, 'inheritsFrom')) ?? str(field(json, 'clientVersion')) ?? id, path: dir });
    }
  }
  const roots = launcherRoots(env);
  for (const root of roots.prism) {
    for (const inst of await subdirs(root)) {
      const pack = await readJson(join(root, inst, 'mmc-pack.json'));
      const components = field(pack, 'components');
      const mc = Array.isArray(components) ? components.find((c) => field(c, 'uid') === 'net.minecraft') : undefined;
      const version = str(field(mc, 'version'));
      for (const sub of ['.minecraft', 'minecraft']) await push({ launcher: 'prism', instance: inst, gameVersion: version, path: join(root, inst, sub, 'resourcepacks') });
    }
  }
  for (const root of roots.curseforge) {
    for (const inst of await subdirs(root)) {
      const json = await readJson(join(root, inst, 'minecraftinstance.json'));
      await push({ launcher: 'curseforge', instance: str(field(json, 'name'), 200) ?? inst, gameVersion: str(field(json, 'gameVersion')), path: join(root, inst, 'resourcepacks') });
    }
  }
  for (const root of roots.modrinth) {
    for (const inst of await subdirs(root)) {
      const json = await readJson(join(root, inst, 'profile.json'));
      await push({ launcher: 'modrinth', instance: inst, gameVersion: str(field(field(json, 'metadata'), 'game_version')), path: join(root, inst, 'resourcepacks') });
    }
  }
  return out;
}
