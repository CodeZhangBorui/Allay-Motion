// 悦灵烘焙产物的约定（docs/07-allay-mascot.md 7.3）。只有常量和类型，不导入任何烘焙产物：
// 产物是原版贴图的派生图像，由 pnpm mascot:bake 生成到 packages/mascot/generated/。按用户决定（2026-11-13，docs/decisions.md M8），
// 运行时和打包用到的那几个（COMMITTED_FILES）提交进仓库；应用图标的各尺寸 PNG 只是中间产物，仍被 git 忽略。
// 这个包不导入任何产物，产物缺失时照样能通过类型检查和测试。
import type { ClipName } from '../model/allay.motions';

export type { ClipName };
export { CLIP_ORDER, CLIPS, FPS } from '../model/allay.motions';

/** 闭眼版头像用的贴图 ID（烘焙时由原版贴图派生，只在烘焙页里解析） */
export const CLOSED_TEXTURE_ID = 'mascot:allay-closed';

/** 图集：13 列，两套帧尺寸 */
export const ATLAS_COLUMNS = 13;
export const ATLAS_SIZES = [288, 96] as const;
/** 正面头像的尺寸，每个尺寸都有睁眼和闭眼两张 */
export const HEAD_SIZES = [16, 20, 24, 32, 48] as const;
/** 应用图标的 PNG 尺寸 */
export const ICON_SIZES = [16, 24, 32, 48, 64, 128, 256, 512, 1024] as const;
/** icon.ico 里放的尺寸（ICO 最大 256） */
export const ICO_SIZES = [16, 24, 32, 48, 64, 128, 256] as const;

export interface AtlasJson {
  fps: number;
  columns: number;
  /** 总帧数 */
  frames: number;
  /** 帧边长（像素），每个尺寸一张图集 allay-<size>.png */
  sizes: number[];
  clips: Record<ClipName, { start: number; count: number }>;
  /** 每帧一项：手部锚点 x、y（占帧边长的比例，左上为原点）和旋转角度（度，顺时针为正） */
  handAnchor: [number, number, number][];
}

/** 烘焙产物目录（相对 packages/mascot）与其中的全部文件名 */
export const GENERATED_DIR = 'generated';
export const GENERATED_FILES: readonly string[] = [
  ...ATLAS_SIZES.map((s) => `allay-${s}.png`),
  'allay.atlas.json',
  ...HEAD_SIZES.flatMap((s) => [`allay-head-${s}.png`, `allay-head-${s}-closed.png`]),
  ...ICON_SIZES.map((s) => `icon-${s}.png`),
  'icon.ico',
];

/** 提交进仓库的产物（运行时的图集、atlas.json、头像，加上打包用的 icon.ico）；pnpm dist 只要求这些 */
export const COMMITTED_FILES: readonly string[] = GENERATED_FILES.filter((f) => !/^icon-\d+\.png$/.test(f));
