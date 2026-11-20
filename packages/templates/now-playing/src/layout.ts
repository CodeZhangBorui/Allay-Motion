// 正在播放的版式和时间公式（纯函数，T-TPL-C053 直接测）。坐标是界面像素、y 向下；依据见 docs/templates/now-playing.md。

/** 一刻的秒数 */
export const TICK = 1 / 20;
/** 动作栏文字：显示 60 刻，最后 20 刻淡出 */
export const ACTIONBAR_TICKS = 60;
export const ACTIONBAR_FADE_TICKS = 20;
/** 动作栏文字的上边在界面底边上方多少界面像素（以 (w / 2, h − 68) 为原点的 y = −4） */
export const ACTIONBAR_FROM_BOTTOM = 72;
/** 原版字体一行的内容高 */
export const TEXT_H = 8;
/** 文字离画面两侧至少留的界面像素 */
export const SIDE_MARGIN = 4;

/** 彩虹变色：色相 = 剩余刻数 / 50（取小数部分），饱和度 0.7，亮度 0.6 */
export const RAINBOW_HUE_TICKS = 50;
export const RAINBOW_SATURATION = 0.7;
export const RAINBOW_BRIGHTNESS = 0.6;
/** 预先建好的彩虹文字对象最多这么多个；时长更长时每一步跨多刻 */
export const RAINBOW_MAX_STEPS = 120;

const hex2 = (v: number): string => Math.min(255, Math.max(0, Math.floor(v * 255 + 0.5))).toString(16).padStart(2, '0').toUpperCase();

/** 色相、饱和度、亮度（都是 0–1，色相取小数部分）→ #RRGGBB。各通道按 ×255 加 0.5 取整 */
export function hsbToHex(hue: number, saturation: number, brightness: number): string {
  if (saturation === 0) return `#${hex2(brightness).repeat(3)}`;
  const h = (hue - Math.floor(hue)) * 6;
  const f = h - Math.floor(h);
  const p = brightness * (1 - saturation);
  const q = brightness * (1 - saturation * f);
  const u = brightness * (1 - saturation * (1 - f));
  const [r, g, b] = (
    [
      [brightness, u, p],
      [q, brightness, p],
      [p, brightness, u],
      [p, q, brightness],
      [u, p, brightness],
      [brightness, p, q],
    ] as const
  )[Math.min(5, Math.floor(h))]!;
  return `#${hex2(r)}${hex2(g)}${hex2(b)}`;
}

export interface RainbowSteps {
  /** 颜色的步数（也是文字对象的个数） */
  count: number;
  /** 每一步跨多少刻（整数，≥ 1） */
  stepTicks: number;
  /** 整段的刻数 */
  totalTicks: number;
}

/** 时长（秒）→ 彩虹分几步：每刻一步，超过 RAINBOW_MAX_STEPS 步时每步跨多刻 */
export function rainbowSteps(duration: number): RainbowSteps {
  const totalTicks = Math.max(1, duration / TICK);
  const whole = Math.max(1, Math.ceil(totalTicks - 1e-9));
  const stepTicks = Math.max(1, Math.ceil(whole / RAINBOW_MAX_STEPS));
  return { count: Math.max(1, Math.ceil(whole / stepTicks)), stepTicks, totalTicks };
}

/** 时刻 t（秒）用第几步的颜色 */
export function rainbowIndex(t: number, steps: RainbowSteps): number {
  const i = Math.floor((t / TICK + 1e-9) / steps.stepTicks);
  return Math.min(steps.count - 1, Math.max(0, i));
}

/** 第 index 步的颜色：这一步开始时还剩的刻数决定色相 */
export function rainbowColor(index: number, steps: RainbowSteps): string {
  const remaining = steps.totalTicks - index * steps.stepTicks;
  return hsbToHex(remaining / RAINBOW_HUE_TICKS, RAINBOW_SATURATION, RAINBOW_BRIGHTNESS);
}

/** 动作栏文字：水平中心和文字上边 */
export function actionbarLayout(width: number, height: number): { centerX: number; top: number } {
  return { centerX: Math.floor(width / 2), top: Math.floor(height) - ACTIONBAR_FROM_BOTTOM };
}

/** 一行字放不下时的缩小倍数（≤ 1）：两侧各留 SIDE_MARGIN 个界面像素。宽度都是界面像素 */
export function fitRow(textWidth: number, guiWidth: number): number {
  return Math.min(1, (guiWidth - 2 * SIDE_MARGIN) / Math.max(1, textWidth));
}

// ---- 音乐提示框（1.21.6 起）。除贴图尺寸外都是没把握的近似，见文档 ----

/** 提示框贴图的原生尺寸和九宫格边 */
export const TOAST_W = 160;
export const TOAST_H = 32;
export const TOAST_BORDER = 4;
/** 图标：左上角 (8, 8)，16 × 16 */
export const TOAST_ICON_X = 8;
export const TOAST_ICON_Y = 8;
export const TOAST_ICON_SIZE = 16;
/** 文字左边界和右侧留白 */
export const TOAST_TEXT_X = 30;
export const TOAST_TEXT_RIGHT = 8;
/** 滑入、滑出各 0.6 秒，共显示 5 秒（和其他提示框相同） */
export const TOAST_SLIDE = 0.6;
export const TOAST_VISIBLE = 5;

export interface ToastLayout {
  width: number;
  height: number;
  textX: number;
  /** 文字上边：竖直居中 */
  textTop: number;
}

/** 提示框的大小随文字宽度定：文字左边界 + 文字宽 + 右侧留白（向上取整） */
export function toastLayout(textWidth: number): ToastLayout {
  return { width: Math.ceil(TOAST_TEXT_X + Math.max(0, textWidth) + TOAST_TEXT_RIGHT), height: TOAST_H, textX: TOAST_TEXT_X, textTop: (TOAST_H - TEXT_H) / 2 };
}

/** 提示框露在画面里的比例：滑入 a²，滑出 1 − b²（a、b 是进入、退出阶段的线性进度） */
export function toastShown(a: number, b: number): number {
  return b > 0 ? 1 - b * b : a * a;
}

/** 提示框左上角的 x：贴着左边或右边，没露出的部分在画外；完全没露出时再多移 1 个界面像素 */
export function toastX(anchor: 'topLeft' | 'topRight', guiWidth: number, panelWidth: number, shown: number): number {
  const rest = anchor === 'topLeft' ? 0 : guiWidth - panelWidth;
  if (shown >= 1) return rest;
  const away = anchor === 'topLeft' ? -panelWidth - 1 : guiWidth + 1;
  return away + (rest - away) * Math.max(0, shown);
}
