// 悦灵的几何（docs/07-allay-mascot.md 7.3，按用户决定改用原版贴图，见 docs/decisions.md 的 M5a 小节）。
//
// 贴图用原版的 assets/minecraft/textures/entity/allay/allay.png（32×32），烘焙时从原版 jar 里读，不进仓库。
// 模型在游戏里是代码而不是 jar 里的数据，这里按原版悦灵模型的布局写：长方体的位置、尺寸、
// 枢轴和贴图坐标都与那张贴图的布局对应（烘焙后对照联络图检查过各面对齐）。
//
// 坐标约定与游戏的实体模型相同：单位是“模型像素”，Y 朝下，正面朝 −Z，+X 是悦灵自己的左边。
// 换到 three 的坐标（Y 朝上、正面朝 +Z）由 allay.rig.ts 绕 X 轴转 180° 完成。
// 本文件只有数据，不导入任何东西：它会被打进内部模板（只在引擎 Worker 里运行）。

export const ALLAY_TEXTURE_ID = 'minecraft:entity/allay/allay';
/** 原版 jar 里贴图的路径 */
export const ALLAY_TEXTURE_PATH = 'assets/minecraft/textures/entity/allay/allay.png';
export const ALLAY_TEXTURE_SIZE = 32;

export type PartName = 'root' | 'head' | 'body' | 'rightArm' | 'leftArm' | 'rightWing' | 'leftWing';

export interface ModelBox {
  /** 贴图左上角（按游戏的盒子展开方式：上下面在第一行，四个侧面在第二行） */
  uv: readonly [number, number];
  /** 盒子最小角，相对所在部件的枢轴 */
  origin: readonly [number, number, number];
  /** 宽（X）× 高（Y）× 深（Z）；宽可以是 0（翅膀是一片） */
  size: readonly [number, number, number];
  /** 各方向向外扩（负数是缩），贴图坐标不变 */
  grow: number;
  /** 左右镜像（贴图水平翻转） */
  mirror: boolean;
  /** 半透明（alpha 在 0 与 255 之间）的盒子单独排序、不写深度 */
  translucent: boolean;
}

export interface ModelPart {
  name: PartName;
  parent: PartName | null;
  /** 枢轴，相对父部件的枢轴 */
  pivot: readonly [number, number, number];
  boxes: readonly ModelBox[];
}

const box = (
  uv: [number, number],
  origin: [number, number, number],
  size: [number, number, number],
  opts: { grow?: number; mirror?: boolean; translucent?: boolean } = {},
): ModelBox => ({ uv, origin, size, grow: opts.grow ?? 0, mirror: opts.mirror ?? false, translucent: opts.translucent ?? false });

/**
 * 部件按父在前的顺序排列。root 的枢轴在身体顶部（原版的 root 在脚下 23.5，
 * 这里把它挪到身体中上部，好让“前倾”“摇摆”绕身体转；子部件的位置相应换算，几何与原版相同）。
 */
export const ALLAY_PARTS: readonly ModelPart[] = [
  { name: 'root', parent: null, pivot: [0, 19.5, 0], boxes: [] },
  // 头 5×5×5，正面（−Z）在贴图 (5, 5)–(10, 10)，两只眼睛各 1×2
  { name: 'head', parent: 'root', pivot: [0, 0.01, 0], boxes: [box([0, 0], [-2.5, -5, -2.5], [5, 5, 5])] },
  // 身体 3×4×2，下面再套一个缩小 0.2、高 5 的半透明下摆
  {
    name: 'body',
    parent: 'root',
    pivot: [0, 0, 0],
    boxes: [box([0, 10], [-1.5, 0, -1], [3, 4, 2]), box([0, 16], [-1.5, 0, -1], [3, 5, 2], { grow: -0.2, translucent: true })],
  },
  { name: 'rightArm', parent: 'body', pivot: [-1.75, 0.5, 0], boxes: [box([23, 0], [-0.75, -0.5, -1], [1, 4, 2], { grow: -0.01 })] },
  { name: 'leftArm', parent: 'body', pivot: [1.75, 0.5, 0], boxes: [box([23, 6], [-0.25, -0.5, -1], [1, 4, 2], { grow: -0.01 })] },
  // 翅膀是宽为 0 的一片，从枢轴向后（+Z）伸 8、向下 1–6
  { name: 'rightWing', parent: 'body', pivot: [-0.5, 0, 0.6], boxes: [box([16, 14], [0, 1, 0], [0, 5, 8])] },
  { name: 'leftWing', parent: 'body', pivot: [0.5, 0, 0.6], boxes: [box([16, 14], [0, 1, 0], [0, 5, 8], { mirror: true })] },
];

/** 两只手的末端（相对手臂枢轴），捧东西的锚点取两者中点再往前一点 */
export const HAND_TIPS: Readonly<Record<'rightArm' | 'leftArm', readonly [number, number, number]>> = {
  rightArm: [-0.25, 3.5, -0.5],
  leftArm: [0.25, 3.5, -0.5],
};

/** 正面头像的取景：头的正面在贴图里的矩形（u, v, 宽, 高），也用来找眼睛做闭眼版 */
export const FACE_RECT = { u: 5, v: 5, w: 5, h: 5 } as const;
