// 026 激流：旋涡中间那个洞的大小随时间怎么收、怎么放，转速和音效按激流等级取。不依赖 ctx 的纯函数，验收测试直接导入。

/** 洞的边缘按 arms 瓣起伏的幅度（相对半径） */
export const LOBE = 0.22;

/**
 * 洞完全张开时的基准半径：起伏最低的地方也要离画面的角远一点（画面中心到角的距离 / (1 − LOBE)，再加余量）。
 */
export function openRadius(halfW: number, halfH: number, pad: number): number {
  return (Math.hypot(halfW, halfH) + pad) / (1 - LOBE);
}

/**
 * 洞的基准半径：p 是“关上”的进度（0 张开，1 关上）。p ≥ 1 时是负数（连起伏最高的地方也小于 0，画面全满），
 * p ≤ 0 时是 open。中间按 (1 − p)² 收：一开始收得快，快关上时慢下来，像被卷进去。
 */
export function holeRadius(p: number, open: number): number {
  if (p <= 0) return open;
  if (p >= 1) return -1;
  return open * (1 - p) * (1 - p);
}

/** 激流等级 → 每秒转几圈 */
export function spinRate(level: number): number {
  const l = Math.min(3, Math.max(1, Math.round(level)));
  return 0.45 + 0.25 * l;
}

/** 激流的三个音效（对照过游戏文件）：参数保持某一级的默认值时，按当前等级换成对应的那一个 */
export const RIPTIDE_SOUNDS = ['minecraft:item.trident.riptide_1', 'minecraft:item.trident.riptide_2', 'minecraft:item.trident.riptide_3'] as const;

export function riptideSound(value: string | null, level: number): string | null {
  if (value === null) return null;
  const l = Math.min(3, Math.max(1, Math.round(level)));
  return (RIPTIDE_SOUNDS as readonly string[]).includes(value) ? RIPTIDE_SOUNDS[l - 1]! : value;
}
