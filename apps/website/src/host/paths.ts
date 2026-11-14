// 构建时发出、页面运行时读取的几个静态文件的路径（相对站点根，构建插件和页面共用）。

/** 兜底像素字体：方舟像素字体的 BDF 原样外套一层 gzip（build/plugins.ts 的 pixelFont） */
export const PIXEL_FONT_PATH = 'fonts/ark-pixel-12px-proportional-zh_hans.bdf.gz';
