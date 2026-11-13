import type { Theme } from './settings';

// 主进程在页面加载前需要的几个颜色（窗口底色、标题栏按钮区）。
// 必须与 packages/ui/src/styles/globals.css 里的设计变量一致，单元测试会核对。
// 顶栏直接坐在底色上（--background），所以系统窗口按钮区的底色也是 --background，符号色是 --foreground。

export const THEME_CHROME_COLORS: Record<Theme, { background: string; titleBar: string; titleBarSymbol: string }> = {
  dark: { background: '#0D0D0E', titleBar: '#0D0D0E', titleBarSymbol: '#F0F0F1' },
  light: { background: '#DCDCDF', titleBar: '#DCDCDF', titleBarSymbol: '#1B1B1D' },
};

export const TOPBAR_HEIGHT = 44;

/** 系统窗口按钮区的高度：和顶栏一样高 */
export const TITLEBAR_OVERLAY_HEIGHT = TOPBAR_HEIGHT;
