// pnpm dist 的前置步骤（docs/decisions.md M5b）：把悦灵的烘焙产物放到 electron-builder 取用的位置。
//
// 烘焙产物是原版贴图的派生图像，由 pnpm mascot:bake 生成到 packages/mascot/generated/；按用户决定（M8），
// 运行时和打包用到的那几个（COMMITTED_FILES）提交在仓库里，CI 直接用，不需要游戏。它们进安装包：
//   apps/desktop/build/mascot/  ← 图集、atlas.json、头像（extraResources → 安装目录的 resources/mascot）
//   apps/desktop/build/icon.ico ← 应用图标（electron-builder 默认从 buildResources 取 icon.ico，安装程序的图标也用它）
// 两处都被 git 忽略，每次先清空再复制，不会带上上一次的旧文件。
//
// 产物缺失时默认失败并说明怎么办：安装包是给人用的，悄悄换成占位图标和 CSS 占位的悦灵不容易被发现。
// 确实要在没有游戏的机器上（CI）打包时，设 ALLAY_DIST_ALLOW_PLACEHOLDER=1：不放产物、不放图标
// （electron-builder 用 Electron 的默认图标），应用运行时自动退回占位实现，并打印醒目的警告。
import { copyFileSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { ATLAS_SIZES, COMMITTED_FILES, HEAD_SIZES } from '../packages/mascot/src/atlas';

const ROOT = resolve(import.meta.dirname, '..');
const GENERATED = join(ROOT, 'packages/mascot/generated');
const BUILD = join(ROOT, 'apps/desktop/build');
const STAGE = join(BUILD, 'mascot');
const ICON = join(BUILD, 'icon.ico');

/** 应用运行时用到的文件（应用图标的各尺寸 PNG 不需要） */
export const RUNTIME_FILES: readonly string[] = [
  'allay.atlas.json',
  ...ATLAS_SIZES.map((s) => `allay-${s}.png`),
  ...HEAD_SIZES.flatMap((s) => [`allay-head-${s}.png`, `allay-head-${s}-closed.png`]),
];

export function stageMascot(opts: { generated?: string; build?: string; allowPlaceholder: boolean }): { mode: 'baked' | 'placeholder'; missing: string[] } {
  const generated = opts.generated ?? GENERATED;
  const build = opts.build ?? BUILD;
  const stage = join(build, 'mascot');
  const icon = join(build, 'icon.ico');
  rmSync(stage, { recursive: true, force: true });
  rmSync(icon, { force: true });
  mkdirSync(stage, { recursive: true });
  const missing = COMMITTED_FILES.filter((f) => !existsSync(join(generated, f)));
  if (missing.length > 0) {
    if (!opts.allowPlaceholder) {
      throw new Error(
        [
          `悦灵的烘焙产物不全（${generated}，缺 ${missing.length} 个文件，例如 ${missing.slice(0, 3).join('、')}）。`,
          '先运行 pnpm mascot:bake（需要本机装过 Minecraft Java 版，或加 --download），再运行 pnpm dist。',
          '只是想在没有游戏的机器上验证打包流程：设 ALLAY_DIST_ALLOW_PLACEHOLDER=1，安装包将使用占位图标和 CSS 占位的悦灵。',
        ].join('\n'),
      );
    }
    return { mode: 'placeholder', missing };
  }
  for (const f of RUNTIME_FILES) copyFileSync(join(generated, f), join(stage, f));
  copyFileSync(join(generated, 'icon.ico'), icon);
  return { mode: 'baked', missing: [] };
}

function main(): void {
  const allowPlaceholder = process.env.ALLAY_DIST_ALLOW_PLACEHOLDER === '1';
  try {
    const r = stageMascot({ allowPlaceholder });
    if (r.mode === 'baked') console.log(`悦灵的烘焙产物已放进 ${STAGE} 和 ${ICON}。`);
    else console.warn(`\n⚠ 警告：没有悦灵的烘焙产物（缺 ${r.missing.length} 个文件）。ALLAY_DIST_ALLOW_PLACEHOLDER=1：安装包使用占位图标和 CSS 占位的悦灵。\n`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(import.meta.filename)) main();
