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
/** “滑动”时和别的行交叉的行、消失和新增的行淡出、淡入各用的秒数 */
export const SLIDE_FADE_SECONDS = 0.15;
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

/** 一行在变化里怎么动 */
export interface Motion {
  /** 变化前、变化后的行号（0 是最上面）；null 表示那个状态里没有这一行 */
  from: number | null;
  to: number | null;
  /** true：从旧位置滑到新位置；false：先在旧位置淡出，滑动结束后在新位置淡入，滑动时不显示 */
  slide: boolean;
}

export interface ChangePlan {
  mode: 'instant' | 'slide';
  changeAt: number;
  /** 按 Row.key 查 */
  motions: Map<string, Motion>;
  /** slide 时三段的结束时刻：淡出（有要淡出的行时 SLIDE_FADE_SECONDS，否则不占时间）、滑动、淡入 */
  outEnd: number;
  slideEnd: number;
  inEnd: number;
}

/**
 * 两个状态里都有的行（moves 按变化前的行号排好，每项是 [变化前, 变化后] 的行号）里哪些一起滑动：变化后相对顺序也不变的最多的一组。
 * 这组行一路上彼此不交叉，间距也不会小于一行；一样多时优先选往上走的行，让超过别人的那一行滑上去。返回 moves 的下标
 */
export function slidingRows(moves: readonly (readonly [from: number, to: number])[]): Set<number> {
  const n = moves.length;
  // 多一行的分量（n + 1）总是大于所有“往上走”的加分之和（≤ n），所以先比行数，再比往上走的有几行
  const weight = (i: number) => n + 1 + (moves[i]![1] < moves[i]![0] ? 1 : 0);
  const best: number[] = [];
  const prev: number[] = [];
  for (let i = 0; i < n; i++) {
    best[i] = weight(i);
    prev[i] = -1;
    for (let j = 0; j < i; j++) {
      if (moves[j]![1] < moves[i]![1] && best[j]! + weight(i) > best[i]!) {
        best[i] = best[j]! + weight(i);
        prev[i] = j;
      }
    }
  }
  let end = -1;
  for (let i = 0; i < n; i++) if (end < 0 || best[i]! > best[end]!) end = i;
  const out = new Set<number>();
  for (let i = end; i >= 0; i = prev[i]!) out.add(i);
  return out;
}

/**
 * 变化前后两组行 → 每行怎么动、几段的时刻。instant 时所有行都“滑”（进度在 changeAt 跳变）。
 * slide 时只有 slidingRows 选中的行滑动；和它们交叉的行、只在一个状态里的行先淡出、后淡入，
 * 和滑动错开，所以任何时刻显示着的两行都不会叠在一起（docs/templates/scoreboard-sidebar.md 第 1 节）
 */
export function planChange(before: readonly Row[], after: readonly Row[], changeAt: number, mode: 'instant' | 'slide'): ChangePlan {
  const motions = new Map<string, Motion>();
  const indexIn = (rows: readonly Row[], key: string) => {
    const i = rows.findIndex((r) => r.key === key);
    return i < 0 ? null : i;
  };
  for (const key of new Set([...before, ...after].map((r) => r.key))) motions.set(key, { from: indexIn(before, key), to: indexIn(after, key), slide: mode === 'instant' });
  let hasOut = false;
  let hasIn = false;
  if (mode === 'slide') {
    const both = [...motions.values()].filter((m) => m.from !== null && m.to !== null).sort((a, b) => a.from! - b.from!);
    const sliding = slidingRows(both.map((m) => [m.from!, m.to!] as const));
    both.forEach((m, i) => (m.slide = sliding.has(i)));
    for (const m of motions.values()) {
      if (m.slide) continue;
      if (m.from !== null) hasOut = true;
      if (m.to !== null) hasIn = true;
    }
  }
  const outEnd = changeAt + (hasOut ? SLIDE_FADE_SECONDS : 0);
  const slideEnd = mode === 'slide' ? outEnd + SLIDE_SECONDS : changeAt;
  return { mode, changeAt, motions, outEnd, slideEnd, inEnd: slideEnd + (hasIn ? SLIDE_FADE_SECONDS : 0) };
}

/** 时刻 t 滑动的进度（0–1）：面板的高度和滑动的行都按它插值。slide 时淡出那一段结束才开始滑 */
export const motionProgress = (t: number, plan: ChangePlan): number =>
  plan.mode === 'instant' ? changeProgress(t, plan.changeAt, 'instant') : changeProgress(t, plan.outEnd, 'slide');

/**
 * 时刻 t 一段文字（名字或分数）的上边和不透明度系数（0–1，还要乘整体的淡入淡出）。yBefore、yAfter 是它在变化前、变化后的上边；
 * before、after 是它在变化前、变化后显不显示：同一行前后的文字不同时各有一段，在变化那一刻互换
 */
export function pieceAt(t: number, plan: ChangePlan, m: Motion, yBefore: number, yAfter: number, before: boolean, after: boolean): { y: number; fade: number } {
  const p = motionProgress(t, plan);
  if (m.slide) {
    const both = m.from !== null && m.to !== null;
    // 两个状态里都有的行：文字在变化那一刻互换。instant 下只在一个状态里的行直接出现、消失
    const fade = both ? (t >= plan.changeAt ? (after ? 1 : 0) : before ? 1 : 0) : before ? 1 - p : p;
    return { y: yBefore + (yAfter - yBefore) * p, fade };
  }
  if (t < plan.slideEnd) {
    const out = t < plan.changeAt ? 1 : Math.max(0, 1 - (t - plan.changeAt) / SLIDE_FADE_SECONDS);
    return { y: yBefore, fade: before ? out : 0 };
  }
  return { y: yAfter, fade: after ? Math.min(1, (t - plan.slideEnd) / SLIDE_FADE_SECONDS) : 0 };
}

/** 变化的进度：instant 在 changeAt 那一刻从 0 跳到 1；slide 在之后的 SLIDE_SECONDS 里平滑地走到 1（三次缓入缓出） */
export function changeProgress(t: number, changeAt: number, mode: 'instant' | 'slide'): number {
  if (t < changeAt) return 0;
  if (mode === 'instant') return 1;
  const p = (t - changeAt) / SLIDE_SECONDS;
  if (p >= 1) return 1;
  return p < 0.5 ? 4 * p * p * p : 1 - (-2 * p + 2) ** 3 / 2;
}
