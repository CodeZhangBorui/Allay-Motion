// 手动冒烟：探测本机已装的 Minecraft Java 版，只读打开原版层，统计目录里能解析到多少贴图和音效事件。
// 不在 pnpm check 里跑（CI 和别的机器上没有游戏）。不复制、不写任何文件，只往控制台打印统计。
// 用法：pnpm exec tsx scripts/smoke-vanilla.ts [游戏目录]
import { homedir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { expandSoundEvent, findMissing, mergeSoundDefinitions, parseSoundsJson, requiredTextures, SOUND_EVENTS } from '../packages/assets/src/index';
import { detectMinecraft, openVanillaLayer } from '../apps/desktop/src/main/resources';

async function main(): Promise<void> {
  const install = await detectMinecraft({ platform: process.platform, appData: process.env.APPDATA, home: homedir() }, process.argv[2] ?? null);
  if (!install) {
    console.log('smoke-vanilla: 没有找到带 jar 的正式版');
    return;
  }
  console.log(`smoke-vanilla: 版本 ${install.versionId}（${install.releaseTime}），资源索引 ${install.assetIndexPath ? '有' : '无'}`);
  const layer = await openVanillaLayer(install);
  try {
    const required = requiredTextures();
    const missing = findMissing(required, layer.has);
    const by = (src: string) => required.filter((r) => r.source === src).length;
    const miss = (src: string) => missing.filter((r) => r.source === src).length;
    for (const src of ['block', 'item', 'gui']) console.log(`  ${src}：${by(src) - miss(src)}/${by(src)}`);
    for (const m of missing) console.log(`  ✗ 缺 ${m.id}`);
    const soundsJson = await layer.read('assets/minecraft/sounds.json');
    const defs = mergeSoundDefinitions(soundsJson ? [{ kind: 'vanilla', parsed: parseSoundsJson(new TextDecoder().decode(soundsJson), 'minecraft') }] : []);
    const events = SOUND_EVENTS.filter((e) => e.startsWith('minecraft:'));
    const ok = events.filter((e) => expandSoundEvent(defs, e).length > 0);
    console.log(`  音效事件：${ok.length}/${events.length}（allay:whoosh 是本项目自有 ID，原版没有）`);
    console.log(`  原版层文件总数：${layer.list('').length}；警告 ${layer.warnings?.length ?? 0} 条`);
  } finally {
    layer.close();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) void main();
