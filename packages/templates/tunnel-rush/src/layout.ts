// 018 矿道穿梭的纯函数部分：矿道的长度、镜头的路径、矿石的分布、火把的光照、撞上尽头时镜头离墙多近。
// 不依赖 ctx，验收测试直接导入（tests/unit/T-TPL-C018.tunnel-rush.test.ts）。

/** 镜头的垂直视角（度）：游戏的默认视野是 70（经搜索确认，见文档） */
export const FOV = 70;
/** 镜头从矿道口外多远开始（格） */
export const APPROACH = 26;

/**
 * 矿石和它们出现的相对多少（凭记忆排的稀有程度，不是游戏的生成概率）：煤最多，绿宝石最少。
 * 都是方块目录里有的 ID。
 */
export const ORES: readonly { id: string; weight: number }[] = [
  { id: 'minecraft:coal_ore', weight: 30 },
  { id: 'minecraft:iron_ore', weight: 22 },
  { id: 'minecraft:copper_ore', weight: 16 },
  { id: 'minecraft:gold_ore', weight: 8 },
  { id: 'minecraft:redstone_ore', weight: 9 },
  { id: 'minecraft:lapis_ore', weight: 6 },
  { id: 'minecraft:diamond_ore', weight: 4 },
  { id: 'minecraft:emerald_ore', weight: 1 },
];

/** 按随机数 r 从带权重的列表里挑一个的下标 */
export function weightedPick(list: readonly { weight: number }[], r: number): number {
  const total = list.reduce((a, e) => a + e.weight, 0);
  let x = r * total;
  for (let i = 0; i < list.length; i++) {
    x -= list[i]!.weight;
    if (x < 0) return i;
  }
  return list.length - 1;
}

/** 矿道有多少节（格）：巡航速度（格 / 秒）× 进入阶段里在矿道里的那七成时间，至少 8 节、最多 120 节 */
export function tunnelLength(speed: number, inLen: number): number {
  return Math.max(8, Math.min(120, Math.round(speed * inLen * 0.7)));
}

/**
 * 撞上尽头时镜头离尽头的墙多近（格）：墙（里面 size × size 格）正好铺满画面，宽、高都只用到 97%。
 * aspect 是画面的宽高比。
 */
export function wallDistance(size: number, aspect: number, fovDeg = FOV): number {
  const t = Math.tan((fovDeg * Math.PI) / 360);
  return (0.97 * (size / 2)) / (t * Math.max(1, aspect));
}

/**
 * 进入阶段镜头走过的比例（0–1）：越走越快（u^1.6）。开头离矿道口还远，矿道口慢慢变大；最后一下撞上尽头的墙。
 */
export function rushProgress(u: number): number {
  if (u <= 0) return 0;
  if (u >= 1) return 1;
  return u ** 1.6;
}

/**
 * 火把的光照：游戏里火把的亮度是 14 级，每离开一格（曼哈顿距离）减 1 级；
 * 亮度到画面明暗的换算照游戏的光照表 b = (L/15) / (4 − 3 × L/15)（凭记忆），再垫一个最低亮度 ambient。
 */
export function torchLight(distance: number): number {
  const level = Math.max(0, 14 - distance);
  const f = level / 15;
  return f / (4 - 3 * f);
}

export function brightness(distances: readonly number[], ambient: number): number {
  let b = 0;
  for (const d of distances) b = Math.max(b, torchLight(d));
  return Math.max(ambient, b);
}

/** 火把在第几节（从矿道口算起），每隔 spacing 节一个，左右墙交替；spacing 为 0 时没有火把 */
export function torchSlices(length: number, spacing: number): number[] {
  if (spacing <= 0) return [];
  const out: number[] = [];
  for (let k = Math.max(1, Math.floor(spacing / 2)); k < length; k += spacing) out.push(k);
  return out;
}
