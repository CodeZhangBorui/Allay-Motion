// 软件渲染的识别与它带来的放宽（docs/01-product-architecture.md 1.10：CI 上的 WebGL 是软件渲染；docs/decisions.md M8）。
//
// GitHub 的 Windows 机器没有显卡，Chromium 的 WebGL 走 WARP：渲染器字符串是
// “ANGLE (Microsoft, Microsoft Basic Render Driver … Direct3D11 …)”。本机可以用 ALLAY_ENGINE_ANGLE=d3d11-warp 复现。
// 判定只看渲染器自己报的名字（WEBGL_debug_renderer_info 的 UNMASKED_RENDERER_WEBGL），不看环境变量或 CI=true，
// 所以有显卡的机器上所有判定一条都不变。
//
// 实测 WARP 和显卡的差别，以及各自怎么处理：
// - 慢得多：T-TPL-3 在显卡上约 35 秒，在 WARP 上超过 10 分钟。只放宽测试自身的时限。
// - 曾经的 T-ENG-4 差 2（WARP 和 Intel 核显上 alpha ≥ 128 的直通颜色，RTX 5070 上是 1）：预览写 8 位预乘值、导出写 8 位直通值，
//   两边各自对不同的浮点值取整，换算回直通时误差相加、再放大 255 / a 倍，即使都就近取整也能差到 2（不是 WARP 截断，
//   WARP 的导出和就近取整逐字节相同）。现在 resolve 着色器自己把 8 位量化做掉、预览的预乘值由导出的同一组整数算出，
//   三种渲染器都 ≤ 1，那条放宽已经删掉（decisions.md“8 位量化由引擎自己做”）。
// - 曾经的剪辑点整帧 254 不是渲染器的问题，是方块着色器的 alpha 里混进了插值误差（已修，见 decisions.md），不放宽。
export const SOFTWARE_RENDERER = /swiftshader|llvmpipe|software|basic render/i;

export function isSoftwareRenderer(gpu: string): boolean {
  return SOFTWARE_RENDERER.test(gpu);
}
