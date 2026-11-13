// pnpm mascot:bake [--download] [--game-dir <.minecraft>] [--texture <png>] [--out <目录>] [--review-out <目录>|--no-review]
// 烘焙悦灵的图集、头像、应用图标和联络图（docs/07-allay-mascot.md 7.3）。贴图来自原版 jar，产物不提交。
// 在不显示的 Electron 窗口里渲染，不弹窗、不抢焦点。只有加 --download 才会联网（Mojang 官方服务器）。
import { parseArgs } from 'node:util';
import { bake } from './mascot-bake/bake';

const { values } = parseArgs({
  options: {
    download: { type: 'boolean', default: false },
    'game-dir': { type: 'string' },
    texture: { type: 'string' },
    out: { type: 'string' },
    'review-out': { type: 'string' },
    'no-review': { type: 'boolean', default: false },
    quiet: { type: 'boolean', default: false },
  },
  strict: true,
});

try {
  const result = await bake({
    download: values.download,
    gameDir: values['game-dir'],
    texture: values.texture,
    outDir: values.out,
    reviewDir: values['no-review'] ? null : values['review-out'],
    log: values.quiet ? undefined : (m) => console.log(m),
  });
  console.log(`贴图来源：${result.origin}`);
  console.log(`产物（${result.files.length} 个）写进 ${result.outDir}`);
  if (result.reviewFiles.length > 0) console.log(`评审材料：${result.reviewFiles.join('、')}`);
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
