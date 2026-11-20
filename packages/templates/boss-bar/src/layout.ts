// Boss 栏的版式和时间公式（纯函数，T-TPL-C039 直接测）。坐标是界面像素、y 向下；依据见 docs/templates/boss-bar.md。

/** 一条栏的宽高 */
export const BAR_W = 182;
export const BAR_H = 5;
/** 第一条栏的上边 */
export const FIRST_BAR_TOP = 12;
/** 名字的上边在栏的上边之上多少 */
export const NAME_ABOVE = 9;
/** 相邻两条栏上边的间距（栏和名字的 10 + 一行字的 9） */
export const BAR_PITCH = 19;
/** 一次最多画几条（参数上限；游戏里还受“不超过界面高度三分之一”的限制） */
export const MAX_BARS = 4;
/** 界面宽度不足时整体缩小：栏两侧各至少留这么多界面像素 */
export const SIDE_MARGIN = 4;

/** 七种颜色，顺序就是旧图集 gui/bars 里从上到下的顺序 */
export const BAR_COLORS = ['pink', 'blue', 'red', 'green', 'yellow', 'purple', 'white'] as const;
export type BarColor = (typeof BAR_COLORS)[number];
/** 分段刻度的段数，顺序就是旧图集里从上到下的顺序 */
export const NOTCH_COUNTS = [6, 10, 12, 20] as const;

/** 没有任何贴图时的纯色：fill 是进度的颜色，track 是底的颜色。只是看着接近的近似值，不是从贴图里量出来的 */
export const PLAIN_COLORS: Readonly<Record<BarColor, { fill: string; track: string }>> = {
  pink: { fill: '#EC00B8', track: '#4A0039' },
  blue: { fill: '#00B7EC', track: '#00394A' },
  red: { fill: '#EC3500', track: '#4A1100' },
  green: { fill: '#1DEC00', track: '#094A00' },
  yellow: { fill: '#E9EC00', track: '#494A00' },
  purple: { fill: '#7B00EC', track: '#27004A' },
  white: { fill: '#ECECEC', track: '#4A4A4A' },
};

export type AtlasRegion = readonly [x: number, y: number, w: number, h: number];

/** 旧图集 gui/bars（256 × 256）里某种颜色的底和进度；width 是要画的宽度（进度按像素裁切，不压扁） */
export function atlasColorRegion(color: BarColor, part: 'background' | 'progress', width = BAR_W): AtlasRegion {
  const i = BAR_COLORS.indexOf(color);
  return [0, i * 10 + (part === 'progress' ? BAR_H : 0), width, BAR_H];
}

/** 旧图集里分段刻度的两张：盖在底上的和盖在进度上的 */
export function atlasNotchRegion(notches: number, part: 'background' | 'progress', width = BAR_W): AtlasRegion | null {
  const j = (NOTCH_COUNTS as readonly number[]).indexOf(notches);
  if (j < 0) return null;
  return [0, 80 + j * 10 + (part === 'progress' ? BAR_H : 0), width, BAR_H];
}

/** 一个界面像素对应的设计单位：界面宽度放不下一条栏加两侧边距时整体缩小 */
export function fitUnit(stageWidth: number, guiScale: number): number {
  return Math.max(0.1, Math.min(guiScale, stageWidth / (BAR_W + 2 * SIDE_MARGIN)));
}

/**
 * 实际画几条：每画完一条往下挪 19，挪完后的上边到了界面高度的三分之一就不再画（游戏的规则）。
 * 第一条总是画。
 */
export function visibleBars(height: number, requested: number): number {
  let n = 0;
  let top = FIRST_BAR_TOP;
  while (n < Math.min(requested, MAX_BARS)) {
    n++;
    top += BAR_PITCH;
    if (top >= height / 3) break;
  }
  return n;
}

export interface BarLayout {
  /** 栏的左边 */
  x: number;
  /** 名字的水平中心 */
  centerX: number;
  /** 各条栏的上边 */
  barTops: number[];
  /** 各条栏名字的上边 */
  nameTops: number[];
}

/** 界面宽度和条数 → 各条栏和名字的位置 */
export function barLayout(width: number, count: number): BarLayout {
  const centerX = Math.floor(width / 2);
  const barTops = Array.from({ length: count }, (_, i) => FIRST_BAR_TOP + i * BAR_PITCH);
  return { x: centerX - BAR_W / 2, centerX, barTops, nameTops: barTops.map((y) => y - NAME_ABOVE) };
}

/**
 * 进度（0–1）→ 进度贴图露出的像素数：0 时不画，大于 0 时至少 1 像素，1 时正好 182。
 * 相当于在 0–182 之间取整的离散插值。
 */
export function filledWidth(progress: number): number {
  const p = Math.min(1, Math.max(0, Number.isFinite(progress) ? progress : 0));
  return p <= 0 ? 0 : Math.min(BAR_W, Math.floor(p * (BAR_W - 1)) + 1);
}

/**
 * 停留阶段开始后 age 秒时第一条栏的进度：changeAt 之前是 from，之后在 changeDuration 里匀速走到 to。
 * 游戏里每次进度更新用大约 0.1 秒插值过去；一场 Boss 战是很多次小更新，这里合成一段匀速的变化。
 */
export function progressAt(age: number, from: number, to: number, changeAt: number, changeDuration: number): number {
  if (age <= changeAt) return from;
  if (changeDuration <= 0 || age >= changeAt + changeDuration) return to;
  return from + ((to - from) * (age - changeAt)) / changeDuration;
}
