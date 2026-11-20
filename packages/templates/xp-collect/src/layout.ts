// 经验收集的版式、经验公式和经验球的运动（纯函数，T-TPL-C044 直接测）。坐标是界面像素、y 向下；依据见 docs/templates/xp-collect.md。

/** 经验条的宽高 */
export const BAR_W = 182;
export const BAR_H = 5;
/** 界面宽度不足时整体缩小：经验条两侧各至少留这么多界面像素 */
export const SIDE_MARGIN = 4;
/** 等级数字的颜色 */
export const LEVEL_COLOR = '#80FF20';
/** 没有任何贴图时经验条的纯色（近似值，不是从贴图里量出来的） */
export const PLAIN_TRACK = '#1C1C1C';
export const PLAIN_FILL = '#80FF20';
/** 一刻的秒数 */
export const TICK = 1 / 20;

/** 经验球贴图：64 × 64，4 × 4 格，每格 16 × 16 */
export const ORB_ATLAS = 64;
export const ORB_CELL = 16;
/** 经验球的 11 种大小：经验值达到第 i 个阈值就用第 i 格 */
export const ORB_THRESHOLDS = [1, 3, 7, 17, 37, 73, 149, 307, 617, 1237, 2477] as const;

/** 经验球到达的时刻落在停留阶段的这一段里（占停留的比例）：前面留给第一批球飞过来，后面留给看结果 */
export const ARRIVE_FROM = 0.15;
export const ARRIVE_TO = 0.8;
/** 一个经验球飞行的基准时长（秒），每个球在 ±20% 里取 */
export const FLIGHT = 0.7;
/** 等级数字“跳一下”的时长（秒）和最大放大量 */
export const POP_DURATION = 0.2;
export const POP_AMOUNT = 0.4;

export type OrbOrigin = 'top' | 'sides' | 'around' | 'center';
export const ORB_ORIGINS: readonly OrbOrigin[] = ['top', 'sides', 'around', 'center'];

/** 一个界面像素对应的设计单位：界面宽度放不下经验条加两侧边距时整体缩小 */
export function fitUnit(stageWidth: number, guiScale: number): number {
  return Math.max(0.1, Math.min(guiScale, stageWidth / (BAR_W + 2 * SIDE_MARGIN)));
}

export interface XpLayout {
  /** 经验条的左边、上边 */
  barX: number;
  barTop: number;
  /** 等级数字的水平中心、上边 */
  levelCenterX: number;
  levelTop: number;
  /** 经验球飞向的点：经验条的正中 */
  targetX: number;
  targetY: number;
}

/** 界面宽高 → 经验条和等级数字的位置。条的左边 = ⌊w / 2⌋ − 91，上边 = h − 32 + 3；数字的上边 = h − 31 − 4 */
export function xpLayout(width: number, height: number): XpLayout {
  const h = Math.floor(height);
  const barX = Math.floor(width / 2) - BAR_W / 2;
  const barTop = h - 32 + 3;
  return { barX, barTop, levelCenterX: width / 2, levelTop: h - 31 - 4, targetX: barX + BAR_W / 2, targetY: barTop + BAR_H / 2 };
}

/** 进度（0–1）→ 进度贴图露出的像素数：⌊进度 × 183⌋，不超过 182 */
export function filledWidth(progress: number): number {
  const p = Math.min(1, Math.max(0, Number.isFinite(progress) ? progress : 0));
  return Math.min(BAR_W, Math.floor(p * (BAR_W + 1)));
}

/** 从 level 级升到下一级需要的经验 */
export function xpForLevel(level: number): number {
  if (level >= 31) return 9 * level - 158;
  if (level >= 16) return 5 * level - 38;
  return 2 * level + 7;
}

/**
 * 一共要收集多少经验：从 levelFrom 级、进度 startProgress，到 levelFrom + levels 级、进度 endProgress。
 * levels 为 0（不升级）时结束进度不小于起始进度。
 */
export function totalXp(levelFrom: number, levels: number, startProgress: number, endProgress: number): number {
  if (levels <= 0) return Math.max(0, endProgress - startProgress) * xpForLevel(levelFrom);
  let total = (1 - startProgress) * xpForLevel(levelFrom);
  for (let l = levelFrom + 1; l < levelFrom + levels; l++) total += xpForLevel(l);
  return total + endProgress * xpForLevel(levelFrom + levels);
}

export interface XpState {
  level: number;
  /** 当前等级里的进度，0–1 */
  progress: number;
}

/** 从 levelFrom 级、进度 startProgress 起再得到 gained 点经验之后的等级和进度；不超过 maxLevel 级 */
export function xpStateAfter(levelFrom: number, startProgress: number, gained: number, maxLevel: number): XpState {
  let level = levelFrom;
  let xp = startProgress * xpForLevel(level) + Math.max(0, gained);
  // 容差：几个球的份额相加正好满一级时，浮点误差不该让它差一点升不上去
  while (level < maxLevel && xp >= xpForLevel(level) - 1e-6) {
    xp -= xpForLevel(level);
    level++;
  }
  return { level, progress: Math.min(1, Math.max(0, xp) / xpForLevel(level)) };
}

/** 经验值 → 经验球的大小序号（0–10） */
export function orbIconIndex(value: number): number {
  let n = 0;
  for (const threshold of ORB_THRESHOLDS) if (value >= threshold) n++;
  return Math.min(ORB_THRESHOLDS.length - 1, Math.max(0, n - 1));
}

/** 大小序号 → 贴图里的那一格（左上角和宽高，贴图像素） */
export function orbCell(index: number): readonly [number, number, number, number] {
  return [(index % 4) * ORB_CELL, Math.floor(index / 4) * ORB_CELL, ORB_CELL, ORB_CELL];
}

/** 经验球的染色（各分量 0–1）：绿恒为 1，红在 0–1 之间、蓝在 0–0.2 之间按正弦变化；ageTicks 是球的年龄（刻） */
export function orbTint(ageTicks: number): readonly [r: number, g: number, b: number] {
  const f = ageTicks / 2;
  return [(Math.sin(f) + 1) * 0.5, 1, (Math.sin(f + (4 * Math.PI) / 3) + 1) * 0.1];
}

/**
 * 第 k 个（从 0 数）经验球到达的时刻在停留阶段里的位置（0–1）：n 个球均匀排在 [ARRIVE_FROM, ARRIVE_TO] 里，
 * 每个在自己的那一格里按 jitter（−0.4 到 0.4 格）错开，所以先后顺序不变。
 */
export function arrivalFraction(k: number, n: number, jitter: number): number {
  const j = Math.min(0.4, Math.max(-0.4, jitter));
  return ARRIVE_FROM + ((ARRIVE_TO - ARRIVE_FROM) * (k + 0.5 + j)) / Math.max(1, n);
}

export interface Point {
  x: number;
  y: number;
}

/**
 * 经验球的出发点。r1、r2 是 [0, 1) 的随机数，size 是球的边长。
 * top：上边之外；sides：左右两边之外；around：上、左、右三边之外；center：画面中心附近的一小片。
 */
export function orbStart(origin: OrbOrigin, width: number, height: number, r1: number, r2: number, size: number): Point {
  switch (origin) {
    case 'top':
      return { x: width * (0.1 + 0.8 * r1), y: -size };
    case 'sides':
      return { x: r1 < 0.5 ? -size : width + size, y: height * (0.2 + 0.55 * r2) };
    case 'around':
      if (r1 < 0.5) return { x: width * r2, y: -size };
      return { x: r1 < 0.75 ? -size : width + size, y: height * 0.75 * r2 };
    case 'center': {
      const angle = 2 * Math.PI * r1;
      const radius = Math.sqrt(r2) * 0.12 * Math.min(width, height);
      return { x: width / 2 + Math.cos(angle) * radius, y: height / 2 + Math.sin(angle) * radius };
    }
  }
}

/**
 * 飞行进度 u（0–1）时经验球的位置：沿出发点到目标的连线加速前进（u²，像被玩家吸过去），
 * 再加一个侧向的弧（arc 是弧高占全程的比例，可正可负），两端弧高为 0。
 */
export function orbPosition(u: number, start: Point, target: Point, arc: number): Point {
  const c = Math.min(1, Math.max(0, u));
  const e = c * c;
  const dx = target.x - start.x;
  const dy = target.y - start.y;
  const bulge = arc * Math.sin(Math.PI * c);
  return { x: start.x + dx * e - dy * bulge, y: start.y + dy * e + dx * bulge };
}

/** 飞行进度 u 时经验球的不透明度：开头 10% 淡入，最后 12% 淡出；不在飞行中时为 0 */
export function orbAlpha(u: number): number {
  if (!(u > 0 && u < 1)) return 0;
  return Math.min(1, u / 0.1, (1 - u) / 0.12);
}

/** 等级数字“跳一下”的放大倍数：age 是升级后过了多久（秒），刚升级时最大，POP_DURATION 之后回到 1 */
export function levelPopScale(age: number): number {
  if (!(age >= 0 && age < POP_DURATION)) return 1;
  const left = 1 - age / POP_DURATION;
  return 1 + POP_AMOUNT * left * left;
}

/** n 个 cue 里最多取 max 个，按序号均匀抽样（含首尾） */
export function sampleIndices(n: number, max: number): number[] {
  if (n <= max) return Array.from({ length: n }, (_, i) => i);
  return Array.from({ length: max }, (_, i) => Math.round((i * (n - 1)) / (max - 1)));
}
