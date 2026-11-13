import { join } from 'node:path';
import { app, session, type BrowserWindow } from 'electron';
import { IPC } from '../shared/ipc-channels';
import { handleAppProtocol, registerAppScheme } from './app-protocol';
import { FileGrants } from './file-grants';
import { registerHandlers } from './handlers';
import { createIpcRegistrar } from './ipc';
import { createLogger } from './logger';
import { APP_ENTRY_URL, assertLocalDevOrigin } from './security-policy';
import { hardenSession, installGlobalHardening } from './security';
import { SettingsStore } from './settings-store';
import { createMainWindow } from './window';

// ---- 必须在 ready 之前完成的事 ----

// 应用数据目录（1.9）：固定的内部目录名，不随包名或产品名变（换品牌时用户数据不丢）
app.setPath('userData', join(app.getPath('appData'), 'AllayMotion'));

// 仅限未打包的构建：测试用独立的数据目录，避免碰到开发者自己的设置
if (!app.isPackaged && process.env.ALLAY_USER_DATA_DIR) {
  app.setPath('userData', process.env.ALLAY_USER_DATA_DIR);
}

registerAppScheme();
app.enableSandbox();

// 开发服务器只在未打包时生效，且必须是本机地址（1.6 第 2、3 条）
const devOrigin = !app.isPackaged && process.env.ELECTRON_RENDERER_URL ? assertLocalDevOrigin(process.env.ELECTRON_RENDERER_URL) : null;

const log = createLogger(join(app.getPath('userData'), 'logs'));
installGlobalHardening(devOrigin, log);

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  let mainWindow: BrowserWindow | null = null;
  const settings = new SettingsStore(join(app.getPath('userData'), 'settings.json'), log);

  app.on('second-instance', () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  });

  app.on('window-all-closed', () => app.quit());

  // 退出前等设置写完
  let flushed = false;
  app.on('before-quit', (event) => {
    if (flushed) return;
    event.preventDefault();
    void settings.flush().finally(() => {
      flushed = true;
      app.quit();
    });
  });

  void app.whenReady().then(async () => {
    log.info('app', 'starting', { version: app.getVersion(), packaged: app.isPackaged, dev: devOrigin !== null });
    hardenSession(session.defaultSession, devOrigin, log);
    handleAppProtocol(join(__dirname, '../renderer'), log);

    await settings.load();

    const registrar = createIpcRegistrar({ getMainWindow: () => mainWindow, devOrigin, log });
    registerHandlers({ registrar, settings, grants: new FileGrants(), getMainWindow: () => mainWindow });
    settings.onUiChanged((ui) => {
      if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(IPC.settings.changed, ui);
    });

    mainWindow = createMainWindow({ settings, theme: settings.ui.theme, log });
    mainWindow.on('closed', () => {
      mainWindow = null;
    });
    await mainWindow.loadURL(devOrigin ?? APP_ENTRY_URL);
  });
}
