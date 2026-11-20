// 代码窗口（docs/animation-editor.md 6.11）：动画文档的代码单独开一个窗口，和主窗口实时双向同步。
// 安全设置与主窗口完全相同（1.6）：同一份 webPreferences（window.ts 的 secureWebPreferences）、同一个 preload、
// app:// 页面与同一份 CSP（app-protocol.ts 对所有页面一样）、导航和新窗口拦截（security.ts 对所有 webContents 生效）。
// IPC 来源校验多认一个窗口：只认这里创建的那一个（按 webContents id 登记，关闭时注销），只放行一个通道
// （ipc-guard.ts 的 CODE_WINDOW_CHANNELS），页面必须正好是 code.html。
// 两个窗口不直接通信：主窗口 publish → 这里 → 代码窗口；代码窗口 send → 这里 → 主窗口。两端都按 shared/code-window.ts 校验。
import { BrowserWindow } from 'electron';
import { IPC } from '../shared/ipc-channels';
import { CODE_WINDOW_PAGE, type CodeWindowDown, type CodeWindowUp } from '../shared/code-window';
import type { Theme } from '../shared/settings';
import { THEME_CHROME_COLORS } from '../shared/theme-colors';
import type { Logger } from './logger';
import { APP_ORIGIN } from './security-policy';
import { secureWebPreferences } from './window';

export interface CodeWindowOptions {
  getMainWindow(): BrowserWindow | null;
  devOrigin: string | null;
  theme(): Theme;
  log: Logger;
  /** 自动化测试：窗口不显示、不抢焦点 */
  hiddenForTests: boolean;
}

export class CodeWindowService {
  private win: BrowserWindow | null = null;
  /** 登记的 webContents id（窗口在、没被换掉时才有） */
  private registeredId: number | null = null;
  /** 页面就绪前主窗口发来的最后一份整状态：就绪后补发 */
  private lastState: CodeWindowDown | null = null;

  constructor(private readonly opts: CodeWindowOptions) {}

  window(): BrowserWindow | null {
    return this.win && !this.win.isDestroyed() ? this.win : null;
  }

  /** IPC 来源白名单（ipc.ts）：登记过的代码窗口；没有时为 null */
  registered(): { window: BrowserWindow; id: number } | null {
    const win = this.window();
    return win && this.registeredId !== null ? { window: win, id: this.registeredId } : null;
  }

  /** 打开（已经开着就拿到前面） */
  async open(): Promise<void> {
    const existing = this.window();
    if (existing && this.registeredId !== null) {
      if (!this.opts.hiddenForTests) existing.focus();
      return;
    }
    // 渲染进程没了的旧窗口已经注销、不能再通信：关掉重开
    if (existing) existing.destroy();
    const main = this.opts.getMainWindow();
    const colors = THEME_CHROME_COLORS[this.opts.theme()];
    const win = new BrowserWindow({
      width: 760,
      height: 820,
      minWidth: 420,
      minHeight: 320,
      show: false,
      skipTaskbar: this.opts.hiddenForTests,
      backgroundColor: colors.background,
      autoHideMenuBar: true,
      title: '',
      webPreferences: secureWebPreferences(),
    });
    win.setMenu(null);
    this.win = win;
    // 按 webContents id 登记；窗口关闭、渲染进程没了都注销
    const id = win.webContents.id;
    this.registeredId = id;
    const unregister = () => {
      if (this.registeredId === id) this.registeredId = null;
    };
    win.webContents.once('destroyed', unregister);
    win.webContents.on('render-process-gone', unregister);
    win.on('closed', () => {
      unregister();
      if (this.win === win) this.win = null;
      this.toMain({ type: 'closed' });
    });
    // 主窗口关了，代码窗口跟着关
    main?.once('closed', () => {
      if (!win.isDestroyed()) win.close();
    });
    if (!this.opts.hiddenForTests) win.once('ready-to-show', () => win.show());
    else win.webContents.setAudioMuted(true);
    const url = this.opts.devOrigin ? `${this.opts.devOrigin}/${CODE_WINDOW_PAGE}` : `${APP_ORIGIN}/${CODE_WINDOW_PAGE}`;
    await win.loadURL(url);
    this.opts.log.info('codeWindow', 'opened');
  }

  close(): void {
    this.window()?.close();
  }

  /** 主窗口 → 代码窗口 */
  publish(message: CodeWindowDown): void {
    if (message.type === 'state') this.lastState = message;
    const win = this.window();
    if (win && !win.webContents.isLoading()) win.webContents.send(IPC.codeWindow.down, message);
  }

  /** 代码窗口 → 主窗口。代码窗口不能冒充“窗口关了” */
  receive(message: CodeWindowUp): void {
    if (message.type === 'closed') return;
    // 就绪时先把手里最新的状态给它，再请主窗口推一份新的
    if (message.type === 'ready' && this.lastState) this.window()?.webContents.send(IPC.codeWindow.down, this.lastState);
    this.toMain(message);
  }

  private toMain(message: CodeWindowUp): void {
    const main = this.opts.getMainWindow();
    if (main && !main.isDestroyed()) main.webContents.send(IPC.codeWindow.up, message);
  }
}
