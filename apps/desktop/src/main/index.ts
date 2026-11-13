import { join } from 'node:path';
import { app, session, type BrowserWindow } from 'electron';
import { IPC } from '../shared/ipc-channels';
import { handleAppProtocol, registerAppScheme } from './app-protocol';
import { FileGrants } from './file-grants';
import { registerHandlers } from './handlers';
import { ExportService } from './export/export-service';
import { createIpcRegistrar } from './ipc';
import { createLogger } from './logger';
import { APP_ENTRY_URL, assertLocalDevOrigin } from './security-policy';
import { hardenSession, installGlobalHardening } from './security';
import { SettingsStore } from './settings-store';
import { readTestSwitches } from './test-switches';
import { createMainWindow } from './window';

// ---- 必须在 ready 之前完成的事 ----

// 应用数据目录（1.9）：固定的内部目录名，不随包名或产品名变（换品牌时用户数据不丢）
app.setPath('userData', join(app.getPath('appData'), 'AllayMotion'));

// 仅限未打包的构建：测试用独立的数据目录，以及后台运行（窗口不显示、不抢焦点）。
// 只影响数据放哪、窗口显不显示；1.6 的安全设置在两种情况下完全相同。
const testSwitches = readTestSwitches(app.isPackaged, process.env);
if (testSwitches.userDataDir) app.setPath('userData', testSwitches.userDataDir);
const hiddenForTests = testSwitches.hiddenWindow;

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
  const exports = new ExportService({
    log,
    getMainWindow: () => mainWindow,
    ffmpegOverride: testSwitches.ffmpeg,
    testTarget: testSwitches.exportTarget,
  });

  app.on('second-instance', () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  });

  app.on('window-all-closed', () => app.quit());

  // 退出前等设置写完、取消进行中的导出（不留临时文件）
  let flushed = false;
  app.on('before-quit', (event) => {
    if (flushed) return;
    event.preventDefault();
    void Promise.allSettled([settings.flush(), exports.cancelAll()]).finally(() => {
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
    registerHandlers({ registrar, settings, grants: new FileGrants(), exports, testHooks: testSwitches.testHooks, getMainWindow: () => mainWindow });
    // 启动时跑一次 ffmpeg -version 并记进日志（5.6），不阻塞窗口
    void exports.ffmpegInfo();
    settings.onUiChanged((ui) => {
      if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(IPC.settings.changed, ui);
    });

    mainWindow = createMainWindow({ settings, theme: settings.ui.theme, log, hiddenForTests });
    mainWindow.on('closed', () => {
      mainWindow = null;
    });
    await mainWindow.loadURL(devOrigin ?? APP_ENTRY_URL);
  });
}
