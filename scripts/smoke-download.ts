// 手动冒烟：真的从 Mojang 官方服务器下载最新正式版的客户端 jar（会联网，不在 pnpm check 里跑）。
// 下载到仓库外的临时目录（或参数指定的目录），统计目录里能解析到多少贴图，并按需取一个音效对象。
// 下载物不进仓库。用法：pnpm exec tsx scripts/smoke-download.ts [缓存目录]
import { stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { expandSoundEvent, findMissing, mergeSoundDefinitions, parseSoundsJson, requiredTextures, soundNameToPaths } from '../packages/assets/src/index';
import { createVanillaDownloader, openVanillaLayer } from '../apps/desktop/src/main/resources';

async function main(): Promise<void> {
  const cacheDir = process.argv[2] ?? join(tmpdir(), 'allay-smoke-vanilla-cache');
  const dl = createVanillaDownloader({ cacheDir, packaged: false });
  const before = await dl.findCached();
  console.log(`smoke-download: 缓存目录 ${cacheDir}；已缓存 ${before ? before.versionId : '无'}`);
  let last = '';
  const t0 = Date.now();
  const got = await dl.downloadLatest({
    onProgress: (p) => {
      const line = `${p.phase} ${p.total ? Math.floor((p.received / p.total) * 10) * 10 : 0}%`;
      if (line !== last) console.log(`  ${line}`);
      last = line;
    },
  });
  const jarSize = (await stat(got.jarPath)).size;
  console.log(`smoke-download: 版本 ${got.versionId}（${got.releaseTime}），jar ${jarSize} 字节，用时 ${Date.now() - t0} ms`);
  const layer = await openVanillaLayer(got, { fetchObject: (h, s) => dl.fetchObject(h, s) });
  try {
    const required = requiredTextures();
    const missing = findMissing(required, layer.has);
    console.log(`  目录贴图：${required.length - missing.length}/${required.length}`);
    for (const m of missing) console.log(`  ✗ 缺 ${m.id}`);
    console.log(`  jar 中 assets/ 文件数：${layer.list('assets/').length}`);
    const soundsJson = await layer.read('assets/minecraft/sounds.json');
    if (soundsJson) {
      const defs = mergeSoundDefinitions([{ kind: 'vanilla', parsed: parseSoundsJson(new TextDecoder().decode(soundsJson), 'minecraft') }]);
      const v = expandSoundEvent(defs, 'minecraft:block.stone.place')[0];
      const path = v ? soundNameToPaths(v.file)[0] : undefined;
      const bytes = path ? await layer.read(path) : null;
      console.log(`  按需取音效 ${path ?? '（无）'}：${bytes ? `${bytes.length} 字节` : '失败'}`);
    } else {
      console.log('  资源索引里没有 sounds.json');
    }
  } finally {
    layer.close();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err: unknown) => {
    console.error('smoke-download 失败：', err);
    process.exit(1);
  });
}
