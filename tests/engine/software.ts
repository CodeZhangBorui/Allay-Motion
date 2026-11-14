// 软件渲染的识别与它带来的放宽（docs/01-product-architecture.md 1.10：CI 上的 WebGL 是软件渲染；docs/decisions.md M8）。
//
// GitHub 的 Windows 机器没有显卡，Chromium 的 WebGL 走 WARP：渲染器字符串是
// “ANGLE (Microsoft, Microsoft Basic Render Driver … Direct3D11 …)”。本机可以用 ALLAY_ENGINE_ANGLE=d3d11-warp 复现。
// 判定只看渲染器自己报的名字（WEBGL_debug_renderer_info 的 UNMASKED_RENDERER_WEBGL），不看环境变量或 CI=true，
// 所以有显卡的机器上所有判定一条都不变。
//
// 实测 WARP 和显卡的差别，以及各自怎么处理：
// - 慢得多：T-TPL-3 在显卡上约 35 秒，在 WARP 上超过 10 分钟。只放宽测试自身的时限。
// - 写 8 位预乘画布时按截断取整：T-ENG-4 里 alpha = 128、颜色 147 的像素，正确的预乘值是 147 × 128 / 255 = 73.79 → 74，
//   WARP 写的是 73，换算回直通是 145，与导出差 2。这是渲染器的取整方式，只放宽 T-ENG-4 里 alpha ≥ 128 那一项（≤ 2）。
// - 曾经的剪辑点整帧 254 不是渲染器的问题，是方块着色器的 alpha 里混进了插值误差（已修，见 decisions.md），不放宽。
export const SOFTWARE_RENDERER = /swiftshader|llvmpipe|software|basic render/i;

export function isSoftwareRenderer(gpu: string): boolean {
  return SOFTWARE_RENDERER.test(gpu);
}

/** 软件渲染下的判定 */
export const SOFTWARE_LIMITS = {
  /** T-ENG-4：alpha ≥ 128 的像素直通颜色的差（显卡上 ≤ 1） */
  previewColorHigh: 2,
} as const;
