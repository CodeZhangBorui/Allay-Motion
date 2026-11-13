import { join } from 'node:path';
import { BrowserWindow, screen } from 'electron';
import type { Theme } from '../shared/settings';
import { THEME_CHROME_COLORS, TITLEBAR_OVERLAY_HEIGHT } from '../shared/theme-colors';
import type { Logger } from './logger';
import type { SettingsStore } from './settings-store';
import { MIN_WINDOW, restoreBounds } from './window-state';

export interface MainWindowOptions {
  settings: SettingsStore;
  theme: Theme;
  log: Logger;
  /**
   * 仅供自动化测试：窗口创建后不显示、不进任务栏、不抢焦点。页面照常加载和渲染。
   * 只影响“显不显示”，不碰任何安全设置；打包后的应用永远是 false（见 index.ts）。
   */
  hiddenForTests: boolean;
}

export function createMainWindow(opts: MainWindowOptions): BrowserWindow {
  const { settings, log } = opts;
  const colors = THEME_CHROME_COLORS[opts.theme];
  const saved = settings.window;
  const bounds = restoreBounds(
    saved,
    screen.getAllDisplays().map((d) => d.workArea),
  );

  const win = new BrowserWindow({
    ...bounds,
    minWidth: MIN_WINDOW.width,
    minHeight: MIN_WINDOW.height,
    show: false,
    skipTaskbar: opts.hiddenForTests,
    backgroundColor: colors.background,
    // 无边框窗口加系统窗口按钮（6.3）
    titleBarStyle: 'hidden',
    titleBarOverlay: { color: colors.titleBar, symbolColor: colors.titleBarSymbol, height: TITLEBAR_OVERLAY_HEIGHT },
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      // 1.6 第 1 条，一条都不许放宽
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      nodeIntegrationInWorker: false,
      nodeIntegrationInSubFrames: false,
      webSecurity: true,
      // 1.5：最小化时导出照常进行
      backgroundThrottling: false,
      spellcheck: false,
      // 不用 webview
      webviewTag: false,
    },
  });

  // 记的是内容区尺寸：无边框加 overlay 的窗口外框在高 DPI 下有 1 px 的取整误差，用外框尺寸会越存越大；
  // 构造参数 useContentSize 在这种窗口上也不准（实测差 1–3 px），创建后再设内容区尺寸是准的（见 docs/decisions.md）
  if (saved && bounds.x !== undefined) win.setContentSize(bounds.width, bounds.height);
  if (opts.hiddenForTests) {
    // 不调用 show / maximize（maximize 在 Windows 上会顺带显示窗口）
    // 自动化测试不能发出可听见的声音：整个页面静音（预览播放、试听照常调度，只是不出声，见 docs/decisions.md M6b）
    win.webContents.setAudioMuted(true);
    log.info('window', 'hidden window for automated tests');
  } else {
    if (saved?.maximized) win.maximize();
    win.once('ready-to-show', () => win.show());
  }

  // 位置和大小的记忆：位置用外框，大小用内容区；最大化时只记“最大化”，保留之前的普通尺寸
  let timer: NodeJS.Timeout | undefined;
  const save = () => {
    if (win.isDestroyed() || win.isMinimized()) return;
    const maximized = win.isMaximized();
    const prev = settings.window;
    if (maximized && prev) {
      void settings.updateWindow({ ...prev, maximized: true });
      return;
    }
    const outer = maximized ? win.getNormalBounds() : win.getBounds();
    const content = maximized ? outer : win.getContentBounds();
    void settings.updateWindow({
      x: Math.round(outer.x),
      y: Math.round(outer.y),
      width: Math.round(content.width),
      height: Math.round(content.height),
      maximized,
    });
  };
  const scheduleSave = () => {
    clearTimeout(timer);
    timer = setTimeout(save, 400);
  };
  win.on('resize', scheduleSave);
  win.on('move', scheduleSave);
  win.on('maximize', scheduleSave);
  win.on('unmaximize', scheduleSave);
  win.on('close', () => {
    clearTimeout(timer);
    save();
  });

  win.webContents.on('render-process-gone', (_e, details) => {
    log.error('window', 'renderer process gone', { reason: details.reason, exitCode: details.exitCode });
  });

  return win;
}
