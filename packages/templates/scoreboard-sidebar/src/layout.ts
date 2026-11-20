// 记分板侧边栏的版式和时间公式（纯函数，T-TPL-C040 直接测）。坐标是界面像素、y 向下；依据见 docs/templates/scoreboard-sidebar.md。
import { plainText } from '../../_lib/src/gui-kit';

/** 每行的高度 */
export const LINE_H = 9;
/** 侧边栏最多显示分数最高的 15 条 */
export const MAX_ROWS = 15;
/** 行的黑底和标题的黑底的不透明度 */
export const BODY_ALPHA = 0.3;
export const HEADER_ALPHA = 0.4;
/** 分数的默认颜色（聊天格式码的红色） */
export const SCORE_COLOR = '#FF5555';
/** “滑动”换位用的秒数（游戏里没有这个动画，是这里加的） */
export const SLIDE_SECONDS = 0.3;
/** 原版字体里空格的宽度；名字和分数之间隔着“: ”（冒号加一个空格）的宽度 */
export const SPACE_W = 4;

export interface Row {
  /** 去掉格式码的名字：前后两个状态按它配对 */
  key: string;
  /** 带格式码的名字 */
  name: string;
  score: number;
}

/**
 * 多行文字 → 排好序的行（第一个是最上面那行）。每行“名字 分数”：最后一个用空白隔开的词是整数时当分数，否则整行是名字、分数 0。
 * 按分数从高到低排，同分按名字（不分大小写）；超过 15 条只留分数最高的 15 条。重名的只留第一条。
 */
export function parseRows(text: string): Row[] {
  const rows: Row[] = [];
  const seen = new Set<string>();
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (line === '') continue;
    const m = /^(.*\S)\s+([+-]?\d{1,9})$/.exec(line);
    const name = m ? m[1]! : line;
    const key = plainText(name);
    if (key.trim() === '' || seen.has(key)) continue;
    seen.add(key);
    rows.push({ key, name, score: m ? Number.parseInt(m[2]!, 10) : 0 });
  }
  const fold = (s: string) => s.toLowerCase();
  rows.sort((a, b) => b.score - a.score || (fold(a.key) < fold(b.key) ? -1 : fold(a.key) > fold(b.key) ? 1 : a.key < b.key ? -1 : 1));
  return rows.slice(0, MAX_ROWS);
}

/** 内容宽度：标题和各行（名字 + “: ” + 分数；不显示数字时只有名字）里最宽的。宽度都是界面像素 */
export function contentWidth(titleW: number, rows: readonly { nameW: number; scoreW: number }[], separatorW: number, showNumbers: boolean): number {
  let w = titleW;
  for (const r of rows) w = Math.max(w, r.nameW + (showNumbers && r.scoreW > 0 ? separatorW + r.scoreW : 0));
  return Math.ceil(w);
}

export interface SidebarLayout {
  /** 名字的左边 */
  left: number;
  /** 黑底的右边，也是分数的右边 */
  right: number;
  /** 黑底的左边 */
  backLeft: number;
  /** 最上面一行的上边 */
  top: number;
  /** 最下面一行的下边 */
  bottom: number;
  /** 标题黑底的上边（下边是 top − 1） */
  headerTop: number;
  /** 标题文字的上边 */
  titleTop: number;
}

/**
 * 界面宽高、行数、内容宽度 → 面板的位置。底边 = ⌊h / 2⌋ + ⌊行数 × 9 / 3⌋；名字左边 = w − 内容宽 − 3，黑底从它左边 2 到 w − 1。
 * side 为 left 时整块镜像到左边（离左边缘同样 1 个界面像素），面板内部不变。
 */
export function sidebarLayout(width: number, height: number, rowCount: number, contentW: number, side: 'left' | 'right' = 'right'): SidebarLayout {
  const w = Math.floor(width);
  const rowsH = rowCount * LINE_H;
  const bottom = Math.floor(height / 2) + Math.floor(rowsH / 3);
  const top = bottom - rowsH;
  const left = side === 'left' ? 3 : w - contentW - 3;
  return { left, right: left + contentW + 2, backLeft: left - 2, top, bottom, headerTop: top - LINE_H - 1, titleTop: top - LINE_H };
}

/** 第 index 行（0 是最上面）文字的上边 */
export const rowTop = (layout: Pick<SidebarLayout, 'top'>, index: number): number => layout.top + index * LINE_H;

/** 标题文字的左边：在内容宽度里居中（游戏里两个除法都取整） */
export const titleLeft = (layout: Pick<SidebarLayout, 'left'>, contentW: number, titleW: number): number => layout.left + Math.floor(contentW / 2) - Math.floor(titleW / 2);

/**
 * 放得下的缩小倍数（≤ 1）：面板连同两侧各 1 个界面像素的边要在界面里，标题的上边、最下一行的下边也要在界面里。
 * 缩小是把界面像素变小，界面的宽高相应变大，所以按“需要的界面宽高”算。
 */
export function fitFactor(width: number, height: number, rowCount: number, contentW: number): number {
  const rowsH = rowCount * LINE_H;
  const needW = contentW + 6;
  // 上半部分：行高 − ⌊行高 / 3⌋ + 标题 10 + 1；下半部分：⌊行高 / 3⌋ + 1。界面高度的一半要装得下较大的那个
  const needH = 2 * (Math.max(rowsH - Math.floor(rowsH / 3) + LINE_H + 1, Math.floor(rowsH / 3)) + 1) + 1;
  return Math.min(1, width / needW, height / needH);
}

/** 变化的进度：instant 在 changeAt 那一刻从 0 跳到 1；slide 在之后的 SLIDE_SECONDS 里平滑地走到 1（三次缓入缓出） */
export function changeProgress(t: number, changeAt: number, mode: 'instant' | 'slide'): number {
  if (t < changeAt) return 0;
  if (mode === 'instant') return 1;
  const p = (t - changeAt) / SLIDE_SECONDS;
  if (p >= 1) return 1;
  return p < 0.5 ? 4 * p * p * p : 1 - (-2 * p + 2) ** 3 / 2;
}
