import type { Theme } from './settings';

// 主进程在页面加载前需要的几个颜色（窗口底色、标题栏按钮区）。
// 必须与 packages/ui/src/styles/globals.css 里的设计变量一致，单元测试会核对。
// 顶栏用 --surface-1，所以系统窗口按钮区的底色也是 --surface-1，符号色是 --foreground。

export const THEME_CHROME_COLORS: Record<Theme, { background: string; titleBar: string; titleBarSymbol: string }> = {
  dark: { background: '#19181C', titleBar: '#242328', titleBarSymbol: '#ECE7DF' },
  light: { background: '#E9E3D8', titleBar: '#F4EFE6', titleBarSymbol: '#27231F' },
};

export const TOPBAR_HEIGHT = 40;

/** 系统窗口按钮区的高度：比顶栏少 2 px，让顶栏下缘那条 2 px 的线一直通到窗口右边（6.2 形状） */
export const TITLEBAR_OVERLAY_HEIGHT = TOPBAR_HEIGHT - 2;
