// 095 附魔光扫：光带扫过的位置、光带的轮廓、整体的淡入淡出。不依赖 ctx 的纯函数，验收测试直接导入。

/** 画面（半宽 halfW、半高 halfH）沿方向 angle（弧度）的半径：画面上离中心最远的点在这个方向上的投影 */
export function extentAlong(halfW: number, halfH: number, angle: number): number {
  return Math.abs(halfW * Math.cos(angle)) + Math.abs(halfH * Math.sin(angle));
}

/**
 * 光带中心的位置（沿扫过方向，设计单位）。q 是整段时长里的进度乘上扫过的次数；每扫一次从画面一侧外面走到另一侧外面
 * （extent + 光带半宽），q 是整数时光带正好在画外。
 */
export function bandCenter(q: number, extent: number, halfWidth: number): number {
  const u = q - Math.floor(q);
  const span = extent + halfWidth;
  return -span + u * 2 * span;
}

/** 光带的轮廓：离中心 x，半宽 w；中心为 1，边上平滑落到 0（着色器里是同一个式子） */
export function bandProfile(x: number, w: number): number {
  const d = Math.min(1, Math.abs(x) / Math.max(1e-6, w));
  return 1 - d * d * (3 - 2 * d);
}
