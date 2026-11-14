// 软件渲染（SwiftShader 等）的识别与放宽（docs/01-product-architecture.md 1.10：CI 上的 WebGL 是软件渲染；docs/decisions.md M8）。
//
// GitHub 的 Windows 机器没有显卡，WebGL 由 SwiftShader 模拟。实测它和显卡有三处不同，都是渲染器的性质，不是模板或引擎的逻辑：
// - 慢得多：T-TPL-3 在显卡上约 35 秒，在 SwiftShader 上超过 10 分钟。
// - 8 位预乘画布的取整：T-ENG-4 里 alpha ≥ 128 的像素换算回直通颜色后差 2（按就近取整的理论上限不到 2，差 2 只能是截断）。
// - 剪辑点的覆盖：块数多、快门角很小时，个别像素的 alpha 是 254（方块接缝处的多重采样覆盖差一点）。
// 下面的放宽只在识别出软件渲染时生效；在显卡上仍按规格原来的判定。
export const SOFTWARE_RENDERER = /swiftshader|llvmpipe|software|basic render/i;

export function isSoftwareRenderer(gpu: string): boolean {
  return SOFTWARE_RENDERER.test(gpu);
}

/** 软件渲染下的判定 */
export const SOFTWARE_LIMITS = {
  /** T-ENG-4：alpha ≥ 128 的像素直通颜色的差（显卡上 ≤ 1） */
  previewColorHigh: 2,
  /** 剪辑点最小 alpha（显卡上必须 = 255） */
  cutMinAlpha: 254,
} as const;
