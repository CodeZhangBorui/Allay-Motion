// 进度条：进度贴图按像素裁切时露出几个界面像素，以及界面宽度放不下一条栏时的整体缩小。
// 039 boss-bar、044 xp-collect 用。两种取整是这两个模板各自照游戏写的（依据见 docs/templates/boss-bar.md、xp-collect.md），
// 哪个条用哪种写在模板自己的 layout.ts。

/**
 * 进度取整的两种算法（width 是整条的像素数）：
 * - atLeastOne：0 时不画，大于 0 时至少 1 像素，1 时正好 width，也就是 ⌊进度 × (width − 1)⌋ + 1（Boss 栏）；
 * - floor：⌊进度 × (width + 1)⌋，不超过 width（经验条）。
 */
export type BarRounding = 'atLeastOne' | 'floor';

/** 进度（0–1，超出时截到两端，不是有限数时当 0）→ 进度贴图露出的像素数 */
export function filledWidth(progress: number, width: number, rounding: BarRounding): number {
  const p = Math.min(1, Math.max(0, Number.isFinite(progress) ? progress : 0));
  if (rounding === 'floor') return Math.min(width, Math.floor(p * (width + 1)));
  return p <= 0 ? 0 : Math.min(width, Math.floor(p * (width - 1)) + 1);
}

/**
 * 一个界面像素对应的设计单位：舞台宽度放不下 width 个界面像素、再加两侧各 margin 个界面像素时整体缩小（只看宽度），
 * 不小于 0.1。
 */
export function fitUnit(stageWidth: number, guiScale: number, width: number, margin = 0): number {
  return Math.max(0.1, Math.min(guiScale, stageWidth / (width + 2 * margin)));
}
