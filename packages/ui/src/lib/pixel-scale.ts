// 像素字的实际字号（6.2 字体）：方舟像素字体 12px 的字形是 12 像素见方的点阵，只有当它占用的设备像素是 12 的整数倍时，
// 每个字形像素才落在整数个设备像素上、边缘锐利。缩放比例不是整数时（Windows 常见的 150%），
// 把 12px 改成 round(dpr) 个字形像素：150% 下是 16 CSS px（24 个设备像素，正好放大 2 倍），而不是糊成 18 个设备像素。

/** 名义字号（12 或 24）在给定缩放比例下的 CSS 字号 */
export function pixelFontSize(nominal: number, dpr: number): number {
  const ratio = Number.isFinite(dpr) && dpr > 0 ? dpr : 1;
  const glyphScale = Math.max(1, Math.round((nominal / 12) * ratio));
  return (12 * glyphScale) / ratio;
}

/** 把 --px-12、--px-24 写到 <html> 上，并在缩放比例变化时（拖到另一块屏幕、改系统缩放）更新 */
export function installPixelScale(doc: Document = document): () => void {
  const win = doc.defaultView;
  if (!win) return () => undefined;
  let query: MediaQueryList | null = null;
  const apply = () => {
    const dpr = win.devicePixelRatio || 1;
    doc.documentElement.style.setProperty('--px-12', `${pixelFontSize(12, dpr)}px`);
    doc.documentElement.style.setProperty('--px-24', `${pixelFontSize(24, dpr)}px`);
    query?.removeEventListener('change', apply);
    query = win.matchMedia(`(resolution: ${dpr}dppx)`);
    query.addEventListener('change', apply);
  };
  apply();
  return () => query?.removeEventListener('change', apply);
}
