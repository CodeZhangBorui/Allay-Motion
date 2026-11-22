// 聊天消息的版式和时间公式（纯函数，T-TPL-C041 直接测）。坐标是界面像素、y 向下；依据见 docs/templates/chat-message.md。

/** 一刻的秒数 */
export const TICK = 1 / 20;
/** 聊天区左下角：x = 4，底边在界面底边上方 40 */
export const CHAT_X = 4;
export const CHAT_BOTTOM = 40;
/** 聊天宽度（选项默认值）；消息超过这个宽度换行 */
export const CHAT_WIDTH = 320;
/** 一行占的高度；文字上边在这一行上边下方 1 */
export const LINE_H = 9;
export const TEXT_DY = 1;
/** 未聚焦时的高度 90 → 最多 10 行 */
export const CHAT_HEIGHT = 90;
export const MAX_ROWS = Math.floor(CHAT_HEIGHT / LINE_H);
/** 行底板：左边到界面左边缘（文字左边再往左 4），右边到文字区右边再往右 8 */
export const BG_LEFT = CHAT_X - 4;
export const BG_RIGHT = CHAT_X + CHAT_WIDTH + 4 + 4;
/** 消息默认显示 200 刻；最后 1/10 按平方淡出 */
export const LIFETIME_TICKS = 200;
/** 不透明度低于这个值的行不画（游戏里是 255 级里不超过 3 级） */
export const MIN_ALPHA = 4 / 255;
/** 输入栏：左右下各留 2，高 12；文字在 (4, h − 12) */
export const INPUT_MARGIN = 2;
export const INPUT_H = 12;
export const INPUT_TEXT_X = 4;
export const INPUT_TEXT_DY = 2;
/** 输入栏的文字和光标的颜色 */
export const INPUT_TEXT_COLOR = '#E0E0E0';
export const CURSOR_COLOR = '#D0D0D0';
/** 光标每 6 刻亮灭一次 */
export const CURSOR_BLINK_TICKS = 6;
/** 打字最多显示的字数 */
export const MAX_TYPED = 48;
/** 打完字到发出之间的停顿（秒）。这是模板自己定的，游戏里取决于玩家什么时候按回车 */
export const SEND_PAUSE = 0.5;
/** 最多几条消息 */
export const MAX_MESSAGES = 12;

/** 放得下整个聊天区（行底板的右边缘、10 行加底边距）需要的界面宽高 */
export const NEED_W = BG_RIGHT;
export const NEED_H = CHAT_BOTTOM + CHAT_HEIGHT + 4;

/** 一个界面像素对应的设计单位：放不下时缩小（9:16 下界面宽只有 270，小于 332） */
export function fitUnit(stageWidth: number, stageHeight: number, guiScale: number): number {
  return Math.max(0.1, Math.min(guiScale, stageWidth / NEED_W, stageHeight / NEED_H));
}

/** 第 row 行（0 是最下面、最新的一行）的上边；rowH 是行高（原版字体是 9，更高的字体时行跟着变高） */
export function rowTop(guiHeight: number, row: number, rowH = LINE_H): number {
  return guiHeight - CHAT_BOTTOM - (row + 1) * rowH;
}

/** 消息的不透明度：p = 1 − 年龄 / 寿命，a = clamp(10p, 0, 1)²。前 90% 的时间不透明，最后 10% 按平方淡出 */
export function messageAlpha(age: number, lifetime: number): number {
  if (age < 0 || lifetime <= 0) return 0;
  const p = 1 - age / lifetime;
  const k = Math.min(1, Math.max(0, p * 10));
  return k * k;
}

/** 输入栏的矩形（界面像素） */
export function inputBar(guiWidth: number, guiHeight: number): { x: number; y: number; w: number; h: number; textX: number; textY: number } {
  return {
    x: INPUT_MARGIN,
    y: guiHeight - INPUT_MARGIN - INPUT_H,
    w: guiWidth - 2 * INPUT_MARGIN,
    h: INPUT_H,
    textX: INPUT_TEXT_X,
    textY: guiHeight - INPUT_MARGIN - INPUT_H + INPUT_TEXT_DY,
  };
}

/** 光标亮不亮：age 是输入栏打开了多久（秒） */
export function cursorOn(age: number): boolean {
  return Math.floor(Math.max(0, age) / TICK / CURSOR_BLINK_TICKS + 1e-6) % 2 === 0;
}

/** 打字时显示在输入栏里的文字：去掉开头的“<名字> ”，最多 MAX_TYPED 个字 */
export function typedText(plain: string): string[] {
  const body = plain.replace(/^<[^>]*>\s?/, '');
  return Array.from(body).slice(0, MAX_TYPED);
}

/** 打字开始后 age 秒时已经打出几个字 */
export function typedCount(age: number, speed: number, total: number): number {
  if (age <= 0) return 0;
  return Math.min(total, Math.floor(age * speed + 1e-6));
}

export interface Schedule {
  /** 输入栏显示到什么时刻（不含）；没有打字时是 −1 */
  inputEnd: number;
  /** 打字开始的时刻 */
  typeStart: number;
  /** 每条消息出现的时刻 */
  appear: number[];
}

/**
 * 各条消息出现的时刻（秒，模板的时间轴）。
 * 不打字：第 k 条在 k × interval（第一条从开头就在，由整体淡入带出来）。
 * 打字：输入栏从开头就在，整体淡入结束（typeStart）后开始打字，打完停 SEND_PAUSE，输入栏消失的同时第一条消息出现，之后每隔 interval 一条。
 */
export function schedule(count: number, interval: number, typing: { start: number; chars: number; speed: number } | null): Schedule {
  const base = typing ? typing.start + typing.chars / Math.max(0.1, typing.speed) + SEND_PAUSE : 0;
  return {
    inputEnd: typing ? base : -1,
    typeStart: typing ? typing.start : 0,
    appear: Array.from({ length: count }, (_, k) => base + k * interval),
  };
}

export interface RowSlot {
  /** 消息序号 */
  index: number;
  /** 这条消息最下面一行所在的行号（0 是最底下） */
  row: number;
  /** 占几行 */
  rows: number;
  alpha: number;
}

/**
 * 时刻 t 画哪些消息、各在第几行。新消息出现时旧的立刻上移；一条换成几行的消息占连续几行。
 * 超出 MAX_ROWS 的不画（一条消息只要有一行超出就整条不画，见文档“没做的”）；淡到 MIN_ALPHA 以下的不画，但仍然占着行。
 */
export function visibleRows(t: number, appear: readonly number[], rows: readonly number[], lifetime: number): RowSlot[] {
  const out: RowSlot[] = [];
  let row = 0;
  for (let i = appear.length - 1; i >= 0; i--) {
    const at = appear[i]!;
    if (t < at) continue;
    const n = Math.max(1, rows[i] ?? 1);
    if (row + n > MAX_ROWS) break;
    const alpha = messageAlpha(t - at, lifetime);
    if (alpha >= MIN_ALPHA) out.push({ index: i, row, rows: n, alpha });
    row += n;
  }
  return out;
}

/** 文字对象的高度（界面像素）→ 行数：n 行的高度是 n × 单行高 + (n − 1) */
export function rowCount(height: number, oneLine: number): number {
  return Math.max(1, Math.round((height + 1) / (oneLine + 1)));
}

/** 同一种声音最多 12 个提示，多了按时刻均匀抽样：在 _lib 里 */
export { sampleCues } from '../../_lib/src/cues';
