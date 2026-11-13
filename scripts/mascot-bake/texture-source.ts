// 悦灵贴图从哪里来（用户决定，见 docs/decisions.md 的 M5a 小节）：烘焙时从原版 jar 里读，不进仓库。
//
// 顺序：
//   1. --texture <png>：显式给一张图（自动化测试用脚本生成的假贴图，仓库里没有这样的文件）；
//   2. 本机已装游戏的 jar（复用应用的探测逻辑 vanilla.ts）；
//   3. 应用的下载缓存里的 jar（离线，download.ts 的 findCached）；
//   4. 只有加了 --download 才联网，用应用同一个下载器从 Mojang 官方服务器取 jar（白名单、校验都相同）。
// jar 和取出的贴图都不复制到任何地方，只在内存里解码。
import { homedir } from 'node:os';
import { join } from 'node:path';
import { readFile } from 'node:fs/promises';
import { createVanillaDownloader } from '../../apps/desktop/src/main/resources/download';
import { detectMinecraft, type VanillaInstall } from '../../apps/desktop/src/main/resources/vanilla';
import { openZip } from '../../apps/desktop/src/main/resources/zip';
import { ALLAY_TEXTURE_PATH } from '../../packages/mascot/model/allay.model';

export interface TextureSourceOptions {
  texture?: string;
  gameDir?: string;
  download?: boolean;
  log(message: string): void;
}

export interface TextureSource {
  bytes: Uint8Array;
  /** 写进汇报的来源说明 */
  origin: string;
}

/** 应用的数据目录（与主进程相同：未打包时可以用 ALLAY_USER_DATA_DIR 改） */
function userDataDir(): string {
  if (process.env.ALLAY_USER_DATA_DIR) return process.env.ALLAY_USER_DATA_DIR;
  const appData = process.env.APPDATA ?? join(homedir(), 'AppData', 'Roaming');
  return join(appData, 'AllayMotion');
}

async function readFromJar(install: VanillaInstall): Promise<Uint8Array> {
  const zip = await openZip(install.jarPath, { includePrefixes: ['assets/minecraft/textures/entity/allay/'] });
  try {
    const bytes = await zip.read(ALLAY_TEXTURE_PATH);
    if (!bytes) throw new Error(`${install.jarPath} 里没有 ${ALLAY_TEXTURE_PATH}（这个版本可能早于 1.19）`);
    return bytes;
  } finally {
    zip.close();
  }
}

export async function findAllayTexture(opts: TextureSourceOptions): Promise<TextureSource> {
  if (opts.texture) return { bytes: await readFile(opts.texture), origin: `file ${opts.texture}` };

  const local = await detectMinecraft({ platform: process.platform, appData: process.env.APPDATA, home: homedir() }, opts.gameDir ?? null);
  if (local) {
    opts.log(`使用本机游戏 ${local.versionId}：${local.jarPath}`);
    return { bytes: await readFromJar(local), origin: `local ${local.versionId}` };
  }

  const downloader = createVanillaDownloader({ cacheDir: join(userDataDir(), 'vanilla-cache'), packaged: false });
  const cached = await downloader.findCached();
  if (cached) {
    opts.log(`使用下载缓存 ${cached.versionId}：${cached.jarPath}`);
    return { bytes: await readFromJar(cached), origin: `cached ${cached.versionId}` };
  }

  if (!opts.download) {
    throw new Error(
      [
        '找不到原版悦灵贴图：本机没有装 Minecraft Java 版（或没有带 jar 的正式版），应用的下载缓存里也没有。',
        '可以：',
        '  - 用 --game-dir <.minecraft 目录> 指定游戏目录；',
        '  - 或加 --download，从 Mojang 官方服务器下载最新正式版的客户端 jar（约 30 MB，存进应用的下载缓存）。',
      ].join('\n'),
    );
  }
  opts.log('从 Mojang 官方服务器下载最新正式版的客户端 jar…');
  const got = await downloader.downloadLatest({
    onProgress: (p) => {
      if (p.phase === 'jar' && p.total) opts.log(`  jar ${Math.round((p.received / p.total) * 100)}%`);
    },
  });
  return { bytes: await readFromJar(got), origin: `downloaded ${got.versionId}` };
}
