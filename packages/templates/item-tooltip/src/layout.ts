// 物品提示框的版式和时间公式（纯函数，T-TPL-C045 直接测）。坐标是界面像素、y 向下；依据见 docs/templates/item-tooltip.md。

/** 稀有度决定名字的颜色 */
export const RARITY_COLORS: Readonly<Record<string, string>> = { common: '#FFFFFF', uncommon: '#FFFF55', rare: '#55FFFF', epic: '#FF55FF' };
/** 说明行没写格式码时的样子：lore 是深紫色斜体，plain 是灰色（附魔行的颜色） */
export const LORE_COLOR = '#AA00AA';
export const PLAIN_COLOR = '#AAAAAA';

/** 一行字高 8；第二行起每行占 10，第一行下面多空 2 */
export const FIRST_LINE_H = 8;
export const LINE_STEP = 10;
export const TITLE_GAP = 2;
/** 文字到框内缘的距离 */
export const PADDING = 3;
/** 提示框的文字原点相对鼠标的偏移 */
export const MOUSE_OFFSET = 12;
/** 物品图标的边长，物品栏格子的间距 */
export const ITEM_SIZE = 16;
export const SLOT_PITCH = 18;
/** 旧样式（Java 版 1.21.1 及更早，代码画的）：底色和它的不透明度，边框上下两端的颜色和不透明度 */
export const CLASSIC_BACKGROUND = '#100010';
export const CLASSIC_BACKGROUND_ALPHA = 0xf0 / 255;
export const CLASSIC_BORDER_TOP = '#5000FF';
export const CLASSIC_BORDER_BOTTOM = '#28007F';
export const CLASSIC_BORDER_ALPHA = 0x50 / 255;
/** 新样式（Java 版 1.21.2 起，两张九宫格贴图）：贴图比“文字 + 内边距”的框每边再大 9；九宫格的边分别是 9 和 10 */
export const SPRITE_MARGIN = 9;
export const SPRITE_BACKGROUND_BORDER = 9;
export const SPRITE_FRAME_BORDER = 10;
/** 说明最多几行（不含名字） */
export const MAX_LORE_LINES = 12;
/** “跟随”时从一个格子移到下一个格子用的秒数 */
export const MOVE_SECONDS = 0.35;

/** 一个矩形：左上角和宽高，相对文字原点（第一行文字的左上角） */
export type Rect = readonly [x: number, y: number, w: number, h: number];

/** 多行说明 → 各行（保留中间的空行，去掉末尾的空行），最多 MAX_LORE_LINES 行 */
export function loreLines(text: string): string[] {
  const lines = text.split('\n').map((l) => l.replace(/\s+$/, ''));
  while (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();
  return lines.slice(0, MAX_LORE_LINES);
}

/** n 行文字的总高：一行是 8，多行是 8 + (n − 1) × 10 + 2 */
export const textHeight = (lineCount: number): number => (lineCount <= 1 ? FIRST_LINE_H : FIRST_LINE_H + (lineCount - 1) * LINE_STEP + TITLE_GAP);

/** 第 index 行（0 是名字）文字的上边：0、12、22、32…… */
export const lineTop = (index: number): number => (index <= 0 ? 0 : TITLE_GAP + index * LINE_STEP);

/** 旧样式的底：中间一块，加上下左右各 1 像素宽的边（四个角各缺 1 像素） */
export function classicBackground(tw: number, th: number): Rect[] {
  return [
    [-3, -4, tw + 6, 1],
    [-3, th + 3, tw + 6, 1],
    [-3, -3, tw + 6, th + 6],
    [-4, -3, 1, th + 6],
    [tw + 3, -3, 1, th + 6],
  ];
}

/** 旧样式的边框（画在底的里面一圈，1 像素宽）：上边、下边是纯色，左右两条竖线从上到下渐变 */
export function classicBorder(tw: number, th: number): { top: Rect; bottom: Rect; left: Rect; right: Rect } {
  return {
    top: [-3, -3, tw + 6, 1],
    bottom: [-3, th + 2, tw + 6, 1],
    left: [-3, -2, 1, th + 4],
    right: [tw + 2, -2, 1, th + 4],
  };
}

/** 旧样式看得见的外框（放置、防出画用它）：文字四周各 4 */
export const outerBox = (tw: number, th: number): Rect => [-4, -4, tw + 8, th + 8];

/** 新样式两张贴图盖住的矩形：文字四周各 3 + 9 */
export const spriteBox = (tw: number, th: number): Rect => [-PADDING - SPRITE_MARGIN, -PADDING - SPRITE_MARGIN, tw + 2 * (PADDING + SPRITE_MARGIN), th + 2 * (PADDING + SPRITE_MARGIN)];

const channel = (hex: string, i: number): number => Number.parseInt(hex.slice(1 + i * 2, 3 + i * 2), 16);

/** 两个 #RRGGBB 按 0–255 的数值线性混合（游戏里的渐变是按这样的数值插的），返回 #RRGGBB */
export function mixHex(a: string, b: string, p: number): string {
  const q = Math.min(1, Math.max(0, p));
  return `#${[0, 1, 2].map((i) => Math.round(channel(a, i) + (channel(b, i) - channel(a, i)) * q).toString(16).padStart(2, '0')).join('')}`.toUpperCase();
}

/** 竖线渐变切成 1 个界面像素高的小条，第 index 条（共 count 条）取它中点处的颜色 */
export const gradientSlice = (index: number, count: number): string => mixHex(CLASSIC_BORDER_TOP, CLASSIC_BORDER_BOTTOM, (index + 0.5) / Math.max(1, count));

export interface GroupLayout {
  /** 整组（提示框，加上物品图标）的宽高 */
  width: number;
  height: number;
  /** 文字原点、鼠标位置相对这一组左上角的坐标；没有物品时鼠标位置仍按提示框倒推 */
  textX: number;
  textY: number;
  cursorX: number;
  cursorY: number;
}

/**
 * 提示框和物品图标合在一起的外接框。鼠标在图标正中，文字原点 = 鼠标 + (12, −12)；
 * 所以图标占鼠标四周各 8，提示框的外框从鼠标右边 8、上边 16 开始。
 */
export function groupLayout(tw: number, th: number, withItem: boolean): GroupLayout {
  const [bx, by, bw, bh] = outerBox(tw, th);
  // 以鼠标为原点的各边
  const tipLeft = MOUSE_OFFSET + bx;
  const tipTop = -MOUSE_OFFSET + by;
  const half = ITEM_SIZE / 2;
  const left = withItem ? Math.min(-half, tipLeft) : tipLeft;
  const top = withItem ? Math.min(-half, tipTop) : tipTop;
  const right = tipLeft + bw;
  const bottom = withItem ? Math.max(half, tipTop + bh) : tipTop + bh;
  return { width: right - left, height: bottom - top, textX: MOUSE_OFFSET - left, textY: -MOUSE_OFFSET - top, cursorX: -left, cursorY: -top };
}

const easeInOut = (p: number): number => (p < 0.5 ? 4 * p * p * p : 1 - (-2 * p + 2) ** 3 / 2);

/** “漂移”：两个方向各一条正弦，幅度 3 和 2 个界面像素，周期 5 秒和 3.7 秒；t = 0 时在原位 */
export function driftOffset(t: number): { x: number; y: number } {
  return { x: 3 * Math.sin((2 * Math.PI * t) / 5), y: 2 * Math.sin((2 * Math.PI * t) / 3.7) };
}

/**
 * “跟随”：在 stops 这几个位置之间依次停留、移动。[start, end] 平分成 stops.length 段，
 * 第 i 次移动以第 i 段的分界为中心，用 MOVE_SECONDS（不超过半段）走完，三次缓入缓出。
 */
export function followOffset(t: number, stops: readonly { x: number; y: number }[], start: number, end: number): { x: number; y: number } {
  const first = stops[0];
  if (!first) return { x: 0, y: 0 };
  const span = (end - start) / stops.length;
  if (!(span > 0)) return { x: first.x, y: first.y };
  const move = Math.min(MOVE_SECONDS, span / 2);
  let at = first;
  for (let i = 1; i < stops.length; i++) {
    const next = stops[i]!;
    const begin = start + span * i - move / 2;
    if (t <= begin) break;
    const p = Math.min(1, (t - begin) / move);
    const e = p >= 1 ? 1 : easeInOut(p);
    at = { x: at.x + (next.x - at.x) * e, y: at.y + (next.y - at.y) * e };
    if (p < 1) break;
  }
  return { x: at.x, y: at.y };
}

/**
 * “跟随”的停留点：从原位出发，每一步沿一个轴移动一格（18 个界面像素）。每个轴只在 0 和 dir × 18 之间来回，
 * dir 是这个轴上朝画面里面的方向（靠边停靠时不会走出画面）。picks 是预先抽好的随机数（0–1），每一步用一个。
 */
export function followStops(count: number, dirX: number, dirY: number, picks: readonly number[]): { x: number; y: number }[] {
  const stops = [{ x: 0, y: 0 }];
  let cx = 0;
  let cy = 0;
  for (let i = 1; i < count; i++) {
    if ((picks[i - 1] ?? 0) < 0.6) cx = cx === 0 ? dirX : 0;
    else cy = cy === 0 ? dirY : 0;
    stops.push({ x: cx * SLOT_PITCH, y: cy * SLOT_PITCH });
  }
  return stops;
}
