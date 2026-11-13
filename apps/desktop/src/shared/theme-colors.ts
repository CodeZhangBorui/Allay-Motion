import type { Theme } from './settings';

// 主进程在页面加载前需要的几个颜色（窗口底色、标题栏按钮区）。
// 必须与 packages/ui/src/styles/globals.css 里的设计变量一致，单元测试会核对。
// 顶栏用 --surface-1，所以系统窗口按钮区的底色也是 --surface-1，符号色是 --foreground。

export const THEME_CHROME_COLORS: Record<Theme, { background: string; titleBar: string; titleBarSymbol: string }> = {
  dark: { background: '#0B0F13', titleBar: '#14171D', titleBarSymbol: '#F2F4F6' },
  light: { background: '#F5F7F9', titleBar: '#FFFFFF', titleBarSymbol: '#141B24' },
};

export const TOPBAR_HEIGHT = 40;
