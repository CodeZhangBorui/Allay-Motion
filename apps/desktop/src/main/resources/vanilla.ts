// 原版层（docs/03-assets.md 3.4）：本机 Minecraft Java 版的客户端 jar 加资源索引。只读，不复制任何文件。
//
// 探测：在候选目录里读 versions/<目录>/<目录>.json，只考虑同目录下有 <目录>.jar 的版本，
// 取 type 为 release 且 releaseTime 最新的一个；再按 assetIndex.id 找 assets/indexes/<id>.json，
// 音效等文件在 assets/objects/<哈希前两位>/<哈希>。
// 目录名原样用（PCL 等启动器给模组版本起的名字可以带空格、括号、中文）；真实的游戏版本从 jar 根目录的 version.json、
// 版本 JSON 的 clientVersion / inheritsFrom 读，不靠目录名。jar 里只读 assets/ 和根目录的 version.json，模组版本目录也一样。
import { readdir, readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { isSafeRelativePath, isVersionDirName, parseJarVersionJson, VersionIdSchema, type PackFormat } from '@allay/assets';
import { z } from 'zod';
import type { ClosableLayer } from './layers';
import { MAX_ENTRY_BYTES, openZip } from './zip';

export const VANILLA_LAYER_ID = 'vanilla';

/** 版本 JSON 里写的游戏版本：只收像版本号的（和下载缓存的版本号一样的字符集），其余当作没写 */
const GameVersionField = VersionIdSchema.optional().catch(undefined);

/** 版本 JSON 的宽松 schema：只取需要的字段，其余忽略；只用来展示、找资源索引的字段坏了当作没写，不连累整个版本 */
const VersionJsonSchema = z.looseObject({
  type: z.string(),
  releaseTime: z.string(),
  assetIndex: z.looseObject({ id: z.string().regex(/^[\w.-]+$/) }).optional().catch(undefined),
  /** 模组加载器（Fabric、Forge、OptiFine）的版本 JSON：继承自哪个原版 */
  inheritsFrom: GameVersionField,
  /** PCL 等启动器写的原版版本号（模组版本、整合包的目录里也有） */
  clientVersion: GameVersionField,
});

const AssetIndexSchema = z.looseObject({
  objects: z.record(z.string(), z.looseObject({ hash: z.string().regex(/^[0-9a-f]{40}$/), size: z.number().int().nonnegative() })),
});

/** 版本 JSON 很小；超过这个大小的不读 */
const MAX_JSON_BYTES = 16 * 1024 * 1024;

export interface VanillaInstall {
  gameDir: string;
  /** 本机的是 versions/ 下的目录名（官方启动器里就是版本号），下载缓存的是版本号 */
  versionId: string;
  /** 版本 JSON 里写的真实游戏版本（clientVersion，其次 inheritsFrom）；和目录名相同、或者没写时缺省 */
  gameVersion?: string;
  releaseTime: string;
  jarPath: string;
  /** 资源索引不存在时为 null（没有音效，贴图照常） */
  assetIndexPath: string | null;
  objectsDir: string;
  /** 版本 JSON 的 type：release、snapshot、old_beta… （旧调用方不关心时可以缺省） */
  type?: string;
}

export interface CandidateEnv {
  platform: NodeJS.Platform;
  /** Windows 的 %APPDATA% */
  appData?: string;
  home: string;
}

/**
 * 候选目录，按优先级：用户上次手动选过的目录、官方启动器的默认目录。
 * 其他启动器（Prism、MultiMC 等）的目录结构不同，v1 不自动探测；用户可以手动选目录（见 decisions.md）。
 */
export function candidateGameDirs(env: CandidateEnv, lastChosen: string | null): string[] {
  const out: string[] = [];
  if (lastChosen) out.push(lastChosen);
  if (env.platform === 'win32') {
    if (env.appData) out.push(join(env.appData, '.minecraft'));
  } else if (env.platform === 'darwin') {
    out.push(join(env.home, 'Library', 'Application Support', 'minecraft'));
  } else {
    out.push(join(env.home, '.minecraft'));
  }
  return [...new Set(out)];
}

async function isFile(path: string): Promise<boolean> {
  return stat(path).then(
    (s) => s.isFile(),
    () => false,
  );
}

async function readJson(path: string): Promise<unknown> {
  const st = await stat(path);
  if (!st.isFile() || st.size > MAX_JSON_BYTES) throw new Error(`not a readable json file: ${path}`);
  return JSON.parse((await readFile(path, 'utf8')).replace(/^\uFEFF/, '')) as unknown;
}

/**
 * 一个游戏目录里所有带 jar 的版本（正式版、快照都算），新的在前。只读，不抛错。
 * 目录名原样用，只要它是 versions/ 的一个直接子目录名（isVersionDirName：没有分隔符、控制字符，不是 . ..，不超过 255 个字符）；
 * PCL 给模组版本起的“1.20.1-Fabric 0.19.3”、整合包的中文名都列出来。
 * 发布时间相同的（PCL 的模组版本照抄原版的版本 JSON），目录名就是版本号的原版排在前面，所以自动挑选优先选原版目录。
 */
export async function listVersions(gameDir: string): Promise<VanillaInstall[]> {
  const versionsDir = join(gameDir, 'versions');
  const names = await readdir(versionsDir, { withFileTypes: true }).catch(() => []);
  const found: VanillaInstall[] = [];
  for (const d of names) {
    if (!d.isDirectory() || !isVersionDirName(d.name)) continue;
    const id = d.name;
    const jarPath = join(versionsDir, id, `${id}.jar`);
    if (!(await isFile(jarPath))) continue;
    const parsed = VersionJsonSchema.safeParse(await readJson(join(versionsDir, id, `${id}.json`)).catch(() => null));
    if (!parsed.success || Number.isNaN(Date.parse(parsed.data.releaseTime))) continue;
    const indexId = parsed.data.assetIndex?.id;
    const indexPath = indexId ? join(gameDir, 'assets', 'indexes', `${indexId}.json`) : null;
    const gameVersion = parsed.data.clientVersion ?? parsed.data.inheritsFrom;
    found.push({
      gameDir,
      versionId: id,
      ...(gameVersion && gameVersion !== id ? { gameVersion } : {}),
      releaseTime: parsed.data.releaseTime,
      jarPath,
      assetIndexPath: indexPath && (await isFile(indexPath)) ? indexPath : null,
      objectsDir: join(gameDir, 'assets', 'objects'),
      type: parsed.data.type,
    });
  }
  found.sort(
    (a, b) =>
      Date.parse(b.releaseTime) - Date.parse(a.releaseTime) ||
      Number(a.gameVersion !== undefined) - Number(b.gameVersion !== undefined) ||
      (a.versionId < b.versionId ? 1 : a.versionId > b.versionId ? -1 : 0),
  );
  return found;
}

/** 原版的资源都在 jar 的这个前缀下 */
const CLIENT_ASSETS_PREFIX = 'assets/minecraft/';

/**
 * 版本目录里的 jar 不是完整的原版客户端：里面没有 assets/minecraft/（OptiFine 这类只装了加载器的版本目录里是个空壳 jar，
 * 游戏实际用的是它 inheritsFrom 的那个原版）。资源面板对这种来源单独说明，不说成“游戏找不到了”。
 */
export class NotClientJarError extends Error {
  override name = 'NotClientJarError';
}

/** 一个版本目录里的 jar：完整的原版客户端、不完整（没有 assets/minecraft/）、打不开（损坏、下载了一半、被占用） */
export type JarCheck = 'client' | 'not-client' | 'unreadable';

/** jar 的检查结果按路径、大小、修改时间缓存（本次运行内）：版本列表要知道哪些已经查出来不能用 */
const jarChecks = new Map<string, { size: number; mtimeMs: number; result: JarCheck }>();

async function remember(jarPath: string, result: JarCheck): Promise<void> {
  const st = await stat(jarPath).catch(() => null);
  if (st?.isFile()) jarChecks.set(jarPath, { size: st.size, mtimeMs: st.mtimeMs, result });
}

/** 查这个版本目录里的 jar 能不能当原版层用；不抛错 */
export async function checkClientJar(jarPath: string): Promise<JarCheck> {
  const st = await stat(jarPath).catch(() => null);
  if (!st?.isFile()) return 'unreadable';
  const cached = jarChecks.get(jarPath);
  if (cached && cached.size === st.size && cached.mtimeMs === st.mtimeMs) return cached.result;
  let result: JarCheck;
  try {
    const jar = await openZip(jarPath, { includePrefixes: [CLIENT_ASSETS_PREFIX] });
    result = jar.paths.size > 0 ? 'client' : 'not-client';
    jar.close();
  } catch {
    result = 'unreadable';
  }
  jarChecks.set(jarPath, { size: st.size, mtimeMs: st.mtimeMs, result });
  return result;
}

/** 这个 jar 是不是完整的原版客户端（有 assets/minecraft/ 下的文件）。打不开的也算不是 */
export async function isClientJar(jarPath: string): Promise<boolean> {
  return (await checkClientJar(jarPath)) === 'client';
}

/** 本次运行里已经查出来用不了的 jar（版本列表上标出原因）；没查过、或者能用的返回 null */
export function knownJarProblem(jarPath: string): Exclude<JarCheck, 'client'> | null {
  const result = jarChecks.get(jarPath)?.result;
  return result && result !== 'client' ? result : null;
}

/**
 * 在一个游戏目录里找有 jar 且最新的正式版；找不到返回 null，不抛错。
 * 就是 listVersions 列出的正式版里排在最前、jar 是完整原版客户端的那个：自动挑选和版本列表用同一套判断，
 * 永远不会自动选中一个列表里没有、应用自己打不开的版本（以前这里另有一套更宽的过滤，挑中过带空格的目录）。
 */
export async function findLatestRelease(gameDir: string): Promise<VanillaInstall | null> {
  for (const v of await listVersions(gameDir)) if (v.type === 'release' && (await isClientJar(v.jarPath))) return v;
  return null;
}

/** 依次试候选目录，返回第一个找到的安装 */
export async function detectMinecraft(env: CandidateEnv, lastChosen: string | null): Promise<VanillaInstall | null> {
  for (const dir of candidateGameDirs(env, lastChosen)) {
    const install = await findLatestRelease(dir);
    if (install) return install;
  }
  return null;
}

/**
 * 打开原版层。jar 里只收录 assets/ 下的文件；资源索引里的对象映射成 `assets/<键>` 的虚拟路径，
 * 这样 sounds.json 和 .ogg 与资源包里的路径写法一致。jar 打不开时抛错，调用方静默退回内置层。
 */
export interface VanillaLayerOptions {
  /**
   * 资源对象不在本地时按需取（下载缓存的原版层用 downloader.fetchObject）。不给时缺的对象当作不存在。
   * 只有用户同意下载后，调用方才应传入。
   */
  fetchObject?: (hash: string, size: number) => Promise<string>;
}

/**
 * 原版层多带的信息：来源的版本标识（本机的是目录名）、真实的游戏版本、这一版的资源包格式号（jar 根目录的 version.json）。
 * gameVersion 先取 jar 根目录 version.json 的 id（模组版本目录里的 jar 是原版客户端的副本，最可靠），
 * 其次版本 JSON 的 clientVersion、inheritsFrom；都没有时为 null（官方启动器 1.14 之前的版本，目录名就是版本号）
 */
export interface VanillaLayerExtras {
  vanilla: { versionId: string; gameVersion: string | null; releaseTime: string; type: string | null; resourceFormat: PackFormat | null; gameDir: string; hasAssetIndex: boolean };
}

/** jar 不是完整的原版客户端（没有 assets/minecraft/）时抛 NotClientJarError，调用方单独说明这个来源；jar 打不开时抛别的错误 */
export async function openVanillaLayer(install: VanillaInstall, options: VanillaLayerOptions & { id?: string } = {}): Promise<ClosableLayer & VanillaLayerExtras> {
  // 根目录的 version.json 只用来读版本号和格式号；其余只收录 assets/
  const jar = await openZip(install.jarPath, { includePrefixes: ['assets/', 'version.json'] }).catch(async (error: unknown) => {
    await remember(install.jarPath, 'unreadable');
    throw error;
  });
  try {
    const client = [...jar.paths].some((p) => p.startsWith(CLIENT_ASSETS_PREFIX));
    await remember(install.jarPath, client ? 'client' : 'not-client');
    if (!client) throw new NotClientJarError(`${install.jarPath} 里没有 ${CLIENT_ASSETS_PREFIX}，不是完整的原版客户端`);
    const objects = new Map<string, { file: string; size: number; hash: string }>();
    const warnings = [...jar.warnings];
    let indexMtime = 0;
    if (install.assetIndexPath) {
      const parsed = AssetIndexSchema.safeParse(await readJson(install.assetIndexPath).catch(() => null));
      if (parsed.success) {
        indexMtime = (await stat(install.assetIndexPath)).mtimeMs;
        for (const [key, obj] of Object.entries(parsed.data.objects)) {
          const path = `assets/${key}`;
          if (!isSafeRelativePath(path) || obj.size > MAX_ENTRY_BYTES) continue;
          objects.set(path, { file: join(install.objectsDir, obj.hash.slice(0, 2), obj.hash), size: obj.size, hash: obj.hash });
        }
      } else {
        warnings.push('资源索引无法解析，没有音效');
      }
    }
    const jarStat = await stat(install.jarPath);
    let resourceFormat: PackFormat | null = null;
    let jarVersion: string | null = null;
    if (jar.has('version.json')) {
      const bytes = await jar.read('version.json').catch(() => null);
      const info = bytes && bytes.byteLength <= 65_536 ? parseJarVersionJson(new TextDecoder().decode(bytes)) : null;
      resourceFormat = info?.resourceFormat ?? null;
      if (info && VersionIdSchema.safeParse(info.id).success) jarVersion = info.id;
    }
    const gameVersion = jarVersion ?? install.gameVersion ?? null;
    const all = [...new Set([...[...jar.paths].filter((p) => p.startsWith('assets/')), ...objects.keys()])].sort();
    return {
      id: options.id ?? VANILLA_LAYER_ID,
      kind: 'vanilla',
      // 层名是真实的游戏版本（界面上的“Minecraft 1.20.1”、原版基底的版本）；目录名在 vanilla.versionId 里
      name: gameVersion ?? install.versionId,
      enabled: true,
      ...(resourceFormat ? { packFormat: resourceFormat.major } : {}),
      vanilla: { versionId: install.versionId, gameVersion, releaseTime: install.releaseTime, type: install.type ?? null, resourceFormat, gameDir: install.gameDir, hasAssetIndex: objects.size > 0 },
      revision: `${install.versionId}:${jarStat.size}:${Math.round(jarStat.mtimeMs)}:${Math.round(indexMtime)}`,
      warnings,
      has: (path) => (path.startsWith('assets/') && jar.has(path)) || objects.has(path),
      list: (prefix) => all.filter((p) => p.startsWith(prefix)),
      read: async (path) => {
        if (jar.has(path)) return jar.read(path);
        const obj = objects.get(path);
        if (!obj) return null;
        let st = await stat(obj.file).catch(() => null);
        if (!st && options.fetchObject) {
          await options.fetchObject(obj.hash, obj.size);
          st = await stat(obj.file).catch(() => null);
        }
        if (!st || !st.isFile() || st.size > MAX_ENTRY_BYTES) return null;
        return new Uint8Array(await readFile(obj.file));
      },
      remoteObject: async (path) => {
        if (jar.has(path)) return null;
        const obj = objects.get(path);
        if (!obj) return null;
        const st = await stat(obj.file).catch(() => null);
        return st && st.isFile() && st.size === obj.size ? null : { hash: obj.hash, size: obj.size };
      },
      close: jar.close,
    };
  } catch (err) {
    jar.close();
    throw err;
  }
}
