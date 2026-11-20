// 声音字幕的版式和时间公式（纯函数，T-TPL-C055 直接测）。坐标是界面像素、y 向下；依据见 docs/templates/sound-subtitles.md。

/** 一行字的高度（行距 9）；一条字幕占 10 */
export const LINE_H = 9;
export const ROW_PITCH = 10;
/** 字的上边在这一条的中心上方 4（9 的整数一半） */
export const HALF_H = Math.floor(LINE_H / 2);
/** 最下面一条的中心在界面底边上方 35；框离界面右边缘 2 */
export const BOTTOM = 35;
export const EDGE = 2;
/** 底板比框向外各扩 1 */
export const PLATE_PAD = 1;
/** 原版字体里空格的宽度 */
export const SPACE_W = 4;
/** 字的灰度：出现时 255，寿命结束时 75 */
export const GRAY_NEW = 255;
export const GRAY_OLD = 75;
/** 灰度分成几级（文字对象的颜色建好后不能改，每一级一个文字对象；游戏里是连续变化的） */
export const GRAY_STEPS = 8;
/** 最多几条 */
export const MAX_LINES = 10;

export type Direction = 'left' | 'right' | 'front';

export interface Caption {
  text: string;
  direction: Direction;
}

/** 一行输入 → 文字和方向：行尾的“ <”“ >”表示声源在左、在右，没有则在正面 */
export function parseCaption(line: string): Caption {
  const m = /^(.*\S)\s+([<>])\s*$/.exec(line);
  if (m) return { text: m[1]!.trim(), direction: m[2] === '<' ? 'left' : 'right' };
  return { text: line.trim(), direction: 'front' };
}

/** 框的半宽：(最宽的字幕 + “<” + 空格 + “>” + 空格) / 2 */
export function halfWidth(maxTextWidth: number, ltWidth: number, gtWidth: number): number {
  return (maxTextWidth + ltWidth + SPACE_W + gtWidth + SPACE_W) / 2;
}

/** 年龄 / 寿命 → 灰度（0–255）：floor(lerp(255, 75, f)) */
export function grayAt(fraction: number): number {
  const f = Math.min(1, Math.max(0, fraction));
  return Math.floor(GRAY_NEW + (GRAY_OLD - GRAY_NEW) * f);
}

/** 第 step 级（0 … steps − 1）的灰度：第一级是 255，最后一级是 75 */
export function stepGray(step: number, steps = GRAY_STEPS): number {
  return grayAt(steps <= 1 ? 0 : step / (steps - 1));
}

/** 年龄 / 寿命 → 用第几级 */
export function stepAt(fraction: number, steps = GRAY_STEPS): number {
  return Math.min(steps - 1, Math.max(0, Math.floor(fraction * steps + 1e-9)));
}

export const grayHex = (gray: number): string => {
  const h = Math.min(255, Math.max(0, Math.round(gray))).toString(16).padStart(2, '0').toUpperCase();
  return `#${h}${h}${h}`;
};

export interface Slot {
  /** 字幕序号 */
  index: number;
  /** 第几排（0 在最下面，是还在显示的里面最老的） */
  row: number;
  /** 年龄 / 寿命，0–1 */
  fraction: number;
}

/** 时刻 t 还在显示的字幕：第 k 条在 k × interval 出现，显示 lifetime；最老的在最下面，它消失后其余的立刻下移 */
export function visibleAt(t: number, count: number, interval: number, lifetime: number): Slot[] {
  const out: Slot[] = [];
  for (let k = 0; k < count; k++) {
    const age = t - k * interval;
    if (age < 0 || age >= lifetime) continue;
    out.push({ index: k, row: out.length, fraction: age / lifetime });
  }
  return out;
}

export interface RowRect {
  /** 这一条的中心 */
  cx: number;
  cy: number;
  /** 底板 */
  x: number;
  y: number;
  w: number;
  h: number;
  /** 字的上边 */
  textTop: number;
  /** 左、右箭头的左边 */
  ltX: number;
  gtX: number;
}

/**
 * 第 row 排的位置。half 是框的半宽；side 是框靠界面的哪一边（游戏里是右边）；
 * pitch 是一条的高度（原版字体是 10，更高的字体时跟着变高）。
 */
export function rowRect(guiWidth: number, guiHeight: number, half: number, row: number, gtWidth: number, side: 'left' | 'right' = 'right', pitch = ROW_PITCH): RowRect {
  const cx = side === 'right' ? guiWidth - half - EDGE : half + EDGE;
  const cy = guiHeight - BOTTOM - row * pitch;
  const hh = pitch / 2;
  return {
    cx,
    cy,
    x: cx - half - PLATE_PAD,
    y: cy - hh,
    w: 2 * (half + PLATE_PAD),
    h: pitch,
    textTop: cy - hh + PLATE_PAD,
    ltX: cx - half,
    gtX: cx + half - gtWidth,
  };
}

/** 一个界面像素对应的设计单位：最宽的框（界面像素）连同边距、最多的排数放不下时缩小 */
export function fitUnit(stageWidth: number, stageHeight: number, guiScale: number, half: number, rows: number, pitch = ROW_PITCH): number {
  const needW = 2 * (half + PLATE_PAD + EDGE);
  const needH = BOTTOM + Math.max(1, rows) * pitch;
  return Math.max(0.1, Math.min(guiScale, stageWidth / needW, stageHeight / needH));
}

/** 同一种声音最多 12 个提示，多了按时刻均匀抽样 */
export function sampleCues(times: readonly number[], max = 12): number[] {
  if (times.length <= max) return [...times];
  return Array.from({ length: max }, (_, i) => times[Math.round((i * (times.length - 1)) / (max - 1))]!);
}
