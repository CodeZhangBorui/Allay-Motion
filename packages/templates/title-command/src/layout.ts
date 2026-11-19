// 标题命令的版式和时间公式（纯函数，T-TPL-C038 直接测）。坐标是界面像素、y 向下；依据见 docs/templates/title-command.md。

/** 一刻的秒数 */
export const TICK = 1 / 20;
/** 标题、副标题相对界面像素的放大倍数 */
export const TITLE_SCALE = 4;
export const SUBTITLE_SCALE = 2;
/** 动作栏文字显示 60 刻，最后 20 刻淡出 */
export const ACTIONBAR_TICKS = 60;
export const ACTIONBAR_FADE_TICKS = 20;
/** 文字底板（辅助功能里的“文本背景”）向外扩的界面像素，以及一行字的高度 */
export const BACKDROP_PAD = 2;
export const LINE_H = 9;

export interface TitleLayout {
  /** 三行文字的水平中心 */
  centerX: number;
  /** 各行文字的上边 */
  titleTop: number;
  subtitleTop: number;
  actionbarTop: number;
}

/**
 * 界面宽高（界面像素）→ 三行文字的位置。标题画在以界面中心为原点、放大 4 倍的坐标系里的 y = −10，
 * 副标题在放大 2 倍的坐标系里的 y = 5，动作栏在 (w / 2, h − 68) 为原点的 y = −4。中心取整数（游戏里是整数除法）。
 */
export function titleLayout(width: number, height: number): TitleLayout {
  const cy = Math.floor(height / 2);
  return {
    centerX: Math.floor(width / 2),
    titleTop: cy - 10 * TITLE_SCALE,
    subtitleTop: cy + 5 * SUBTITLE_SCALE,
    actionbarTop: Math.floor(height) - 68 - 4,
  };
}

/** 标题和副标题的不透明度：淡入、停留、淡出都是线性的；age 从标题出现算起（秒） */
export function titleAlpha(age: number, fadeIn: number, stay: number, fadeOut: number): number {
  if (age <= 0 || age >= fadeIn + stay + fadeOut) return 0;
  if (age < fadeIn) return age / fadeIn;
  if (age <= fadeIn + stay) return 1;
  return 1 - (age - fadeIn - stay) / fadeOut;
}

/** 动作栏的不透明度：出现即不透明，寿命的最后 fade 秒线性淡出（fade 不超过寿命） */
export function actionbarAlpha(age: number, life: number, fade: number): number {
  if (age < 0 || age >= life) return 0;
  const f = Math.min(fade, life);
  const left = life - age;
  return left >= f ? 1 : left / f;
}
