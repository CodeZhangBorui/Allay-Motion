// 手动冒烟（2026-11 反馈）：只读打开本机某个游戏目录的某个版本（或最新正式版），统计 sounds.json 里有多少音效事件
// 能从语言文件推出中文名和英文名，列出推不出来的前若干个。不在 pnpm check 里跑；不复制、不写任何文件、不联网。
// 用法：pnpm exec tsx scripts/smoke-sound-names.ts <游戏目录> [版本号]
import { homedir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { deriveSoundName, mergeSoundDefinitions, parseLangJson, parseSoundsJson, soundCategory } from '../packages/assets/src/index';
import { detectMinecraft, listVersions, openVanillaLayer } from '../apps/desktop/src/main/resources/vanilla';

async function main(): Promise<void> {
  const [dir, version] = process.argv.slice(2);
  const install = dir && version ? ((await listVersions(dir)).find((v) => v.versionId === version) ?? null) : await detectMinecraft({ platform: process.platform, appData: process.env.APPDATA, home: homedir() }, dir ?? null);
  if (!install) {
    console.log('smoke-sound-names: 没有找到带 jar 的版本');
    return;
  }
  const layer = await openVanillaLayer(install);
  try {
    const read = async (p: string) => {
      const b = await layer.read(p);
      return b ? new TextDecoder().decode(b) : null;
    };
    const sounds = await read('assets/minecraft/sounds.json');
    const zhText = await read('assets/minecraft/lang/zh_cn.json');
    const enText = await read('assets/minecraft/lang/en_us.json');
    console.log(`smoke-sound-names: ${install.versionId}；sounds.json ${sounds ? '有' : '无'}，zh_cn ${zhText ? '有' : '无'}，en_us ${enText ? '有' : '无'}`);
    if (!sounds) return;
    const defs = mergeSoundDefinitions([{ kind: 'vanilla', parsed: parseSoundsJson(sounds, 'minecraft') }]);
    const zh = parseLangJson(zhText ?? '{}');
    const en = parseLangJson(enText ?? '{}');
    const missing: Record<string, string[]> = {};
    let zhOk = 0;
    let enOk = 0;
    for (const [id, def] of defs) {
      const z = deriveSoundName(id, def.subtitle, zh, 'zh-CN');
      const e = deriveSoundName(id, def.subtitle, en, 'en');
      if (z) zhOk++;
      if (e) enOk++;
      if (!z) (missing[soundCategory(id, def.sounds[0]?.name)] ??= []).push(id);
    }
    console.log(`  事件 ${defs.size} 个：中文名 ${zhOk}，英文名 ${enOk}`);
    for (const [cat, ids] of Object.entries(missing).sort((a, b) => b[1].length - a[1].length)) console.log(`  推不出中文名 · ${cat}：${ids.length} 个，例如 ${ids.slice(0, 5).join('、')}`);
  } finally {
    layer.close();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) void main();
