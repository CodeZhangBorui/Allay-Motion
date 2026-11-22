// 原版层（docs/03-assets.md 3.4）：本机 Minecraft Java 版的客户端 jar 加资源索引。只读，不复制任何文件。
//
// 探测：在候选目录里读 versions/<id>/<id>.json，只考虑同目录下有 <id>.jar 的版本，
// 取 type 为 release 且 releaseTime 最新的一个；再按 assetIndex.id 找 assets/indexes/<id>.json，
// 音效等文件在 assets/objects/<哈希前两位>/<哈希>。
import { readdir, readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { isSafeRelativePath, parseJarVersionJson, type PackFormat } from '@allay/assets';
import { z } from 'zod';
import type { ClosableLayer } from './layers';
import { MAX_ENTRY_BYTES, openZip } from './zip';

export const VANILLA_LAYER_ID = 'vanilla';

/** 版本 JSON 的宽松 schema：只取需要的字段，其余忽略 */
const VersionJsonSchema = z.looseObject({
  type: z.string(),
  releaseTime: z.string(),
  assetIndex: z.looseObject({ id: z.string().regex(/^[\w.-]+$/) }).optional(),
  inheritsFrom: z.string().max(64).optional(),
});

const AssetIndexSchema = z.looseObject({
  objects: z.record(z.string(), z.looseObject({ hash: z.string().regex(/^[0-9a-f]{40}$/), size: z.number().int().nonnegative() })),
});

/** 版本 JSON 很小；超过这个大小的不读 */
const MAX_JSON_BYTES = 16 * 1024 * 1024;

export interface VanillaInstall {
  gameDir: string;
  versionId: string;
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
 * 版本 id 要能当目录名用（只含字母数字、点、下划线、连字符）；带空格的（PCL 给模组版本起的名字）跳过。
 */
export async function listVersions(gameDir: string): Promise<VanillaInstall[]> {
  const versionsDir = join(gameDir, 'versions');
  const names = await readdir(versionsDir, { withFileTypes: true }).catch(() => []);
  const found: VanillaInstall[] = [];
  for (const d of names) {
    if (!d.isDirectory() || !/^[\w.-]{1,64}$/.test(d.name) || d.name === '.' || d.name === '..') continue;
    const id = d.name;
    const jarPath = join(versionsDir, id, `${id}.jar`);
    if (!(await isFile(jarPath))) continue;
    const parsed = VersionJsonSchema.safeParse(await readJson(join(versionsDir, id, `${id}.json`)).catch(() => null));
    if (!parsed.success || Number.isNaN(Date.parse(parsed.data.releaseTime))) continue;
    const indexId = parsed.data.assetIndex?.id;
    const indexPath = indexId ? join(gameDir, 'assets', 'indexes', `${indexId}.json`) : null;
    found.push({
      gameDir,
      versionId: id,
      releaseTime: parsed.data.releaseTime,
      jarPath,
      assetIndexPath: indexPath && (await isFile(indexPath)) ? indexPath : null,
      objectsDir: join(gameDir, 'assets', 'objects'),
      type: parsed.data.type,
    });
  }
  found.sort((a, b) => Date.parse(b.releaseTime) - Date.parse(a.releaseTime) || (a.versionId < b.versionId ? 1 : -1));
  return found;
}

/**
 * 在一个游戏目录里找有 jar 且最新的正式版；找不到返回 null，不抛错。
 * 就是 listVersions 列出的正式版里排在最前的那个：自动挑选和版本列表用同一套判断，
 * 永远不会自动选中一个列表里没有、应用自己打不开的版本（以前这里另有一套更宽的过滤，挑中过带空格的目录）。
 */
export async function findLatestRelease(gameDir: string): Promise<VanillaInstall | null> {
  return (await listVersions(gameDir)).find((v) => v.type === 'release') ?? null;
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

/** 原版层多带的信息：版本和这一版的资源包格式号（jar 根目录的 version.json） */
export interface VanillaLayerExtras {
  vanilla: { versionId: string; releaseTime: string; type: string | null; resourceFormat: PackFormat | null; gameDir: string; hasAssetIndex: boolean };
}

export async function openVanillaLayer(install: VanillaInstall, options: VanillaLayerOptions & { id?: string } = {}): Promise<ClosableLayer & VanillaLayerExtras> {
  // 根目录的 version.json 只用来读格式号；其余只收录 assets/
  const jar = await openZip(install.jarPath, { includePrefixes: ['assets/', 'version.json'] });
  try {
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
    if (jar.has('version.json')) {
      const bytes = await jar.read('version.json').catch(() => null);
      if (bytes && bytes.byteLength <= 65_536) resourceFormat = parseJarVersionJson(new TextDecoder().decode(bytes))?.resourceFormat ?? null;
    }
    const all = [...new Set([...[...jar.paths].filter((p) => p.startsWith('assets/')), ...objects.keys()])].sort();
    return {
      id: options.id ?? VANILLA_LAYER_ID,
      kind: 'vanilla',
      name: install.versionId,
      enabled: true,
      ...(resourceFormat ? { packFormat: resourceFormat.major } : {}),
      vanilla: { versionId: install.versionId, releaseTime: install.releaseTime, type: install.type ?? null, resourceFormat, gameDir: install.gameDir, hasAssetIndex: objects.size > 0 },
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
