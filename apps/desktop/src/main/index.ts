import { homedir } from 'node:os';
import { join } from 'node:path';
import { app, session, shell, type BrowserWindow } from 'electron';
import { IPC } from '../shared/ipc-channels';
import { handleAppProtocol, registerAppScheme } from './app-protocol';
import { FileGrants } from './file-grants';
import { registerHandlers } from './handlers';
import { ProjectService } from './project/service';
import { ExportService } from './export/export-service';
import { createIpcRegistrar } from './ipc';
import { createLogger } from './logger';
import { createVanillaDownloader, MOJANG_HOSTS } from './resources/download';
import { ResourceService } from './resources/service';
import { APP_ENTRY_URL, APP_ORIGIN, assertLocalDevOrigin } from './security-policy';
import { hardenSession, installGlobalHardening } from './security';
import { SettingsStore } from './settings-store';
import { readTestSwitches } from './test-switches';
import { ThumbCache } from './thumb-cache';
import { PresetStore } from './templates/preset-store';
import { TemplateService } from './templates/service';
import { TemplateDevService } from './templates/dev-service';
import { TemplateWatcher } from './templates/dev-watcher';
import { TEMPLATE_API_DTS } from './templates/template-api-dts';
import { HostCommandChannel } from './host-commands';
import { Splash } from './splash';
import { createMainWindow } from './window';

// ---- 必须在 ready 之前完成的事 ----

// 应用数据目录（1.9）：固定的内部目录名，不随包名或产品名变（换品牌时用户数据不丢）
app.setPath('userData', join(app.getPath('appData'), 'AllayMotion'));

// 仅限未打包的构建：测试用独立的数据目录，以及后台运行（窗口不显示、不抢焦点）。
// 只影响数据放哪、窗口显不显示；1.6 的安全设置在两种情况下完全相同。
const testSwitches = readTestSwitches(app.isPackaged, process.env);
if (testSwitches.userDataDir) app.setPath('userData', testSwitches.userDataDir);
const hiddenForTests = testSwitches.hiddenWindow;
// 不显示的窗口没有显示器的垂直同步，Chromium 退回每秒 1 帧的帧时钟；主线程有时要等到下一帧才继续处理消息，
// 可见窗口里这个等待不超过一帧（约 16 ms），隐藏窗口里会被拉长到将近 1 秒（docs/decisions.md M2b“T-ARC-5 的 1 秒空洞”）。
// 测试窗口去掉帧率限制，让帧时钟和可见窗口一样快。只影响帧的节拍，不碰 1.6 的任何安全设置；打包后 hiddenForTests 恒为假。
if (hiddenForTests) app.commandLine.appendSwitch('disable-frame-rate-limit');

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

  const userData = app.getPath('userData');
  // 仓库根目录下的 resources/（开发）或安装目录的 resources/（打包后）
  const bundledResources = app.isPackaged ? process.resourcesPath : join(app.getAppPath(), '../../resources');
  // 悦灵的烘焙产物（docs/decisions.md M5a、M5b）：打包后在安装目录的 resources/mascot，开发时在 packages/mascot/generated；
  // 测试可以换成自己生成的假图集或空目录。缺了界面就用占位实现
  const mascotDir = app.isPackaged ? join(process.resourcesPath, 'mascot') : (testSwitches.mascotDir ?? join(app.getAppPath(), '../../packages/mascot/generated'));
  const resources = new ResourceService({
    userDataDir: userData,
    builtinDir: join(bundledResources, 'builtin-pack'),
    fallbackFontFile: join(bundledResources, 'fonts', 'ark-pixel', 'ark-pixel-12px-proportional-zh_hans.bdf'),
    settings,
    log,
    // 测试用 ALLAY_E2E_GAME_APPDATA 代替 %APPDATA%（只在未打包时生效），不碰这台机器上真装的游戏
    gameEnv: { platform: process.platform, appData: testSwitches.gameAppData ?? process.env.APPDATA, home: testSwitches.gameAppData ?? homedir() },
    // 运行时下载原版 jar：只在主进程、只在用户点了按钮后（decisions.md M2a）。
    // 假服务器只有未打包且设了测试环境变量时才会传入；打包后 createVanillaDownloader 拒绝 testOrigins
    downloader: createVanillaDownloader({
      cacheDir: join(userData, 'vanilla-cache'),
      packaged: app.isPackaged,
      ...(testSwitches.mojangOrigin ? { testOrigins: Object.fromEntries(MOJANG_HOSTS.map((h) => [h, testSwitches.mojangOrigin!])) } : {}),
    }),
    onChanged: (state) => {
      if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(IPC.resources.changed, state);
    },
  });
  const thumbs = new ThumbCache(userData);
  // 模板：内置的来自 resources/templates/（pnpm templates:build 的产物），用户的在 userData/templates/（4.8、4.9）
  const templates = new TemplateService({ builtinDir: join(bundledResources, 'templates'), userDataDir: userData, appVersion: app.getVersion(), log });
  const presets = new PresetStore(userData, log);
  const templatesReady = templates.init().catch((error: unknown) => log.error('templates', 'init failed', { error }));
  // 模板开发模式（MD）：监视 userData/templates/，外部改动经 templates:changed 推给渲染进程。
  // shell.openPath 只会收到模板的文件夹（dev-service 里按 id 和版本解析、确认在用户模板目录之内）
  const templateDev = new TemplateDevService({
    templates,
    watcher: new TemplateWatcher({ root: join(userData, 'templates'), log }),
    templateApiDts: TEMPLATE_API_DTS,
    openFolder: (dir) => shell.openPath(dir),
    log,
  });
  templateDev.onChange((change) => {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(IPC.templates.changed, change);
  });

  // 主进程到界面的命令通道（H11）。测试开关打开时（只在未打包时）挂到全局，e2e 从主进程一侧调用它
  const hostCommands = new HostCommandChannel({
    send: (request) => {
      if (!mainWindow || mainWindow.isDestroyed()) return false;
      mainWindow.webContents.send(IPC.host.command, request);
      return true;
    },
    log,
  });
  if (testSwitches.testHooks) (globalThis as { __allayHostCommands?: HostCommandChannel }).__allayHostCommands = hostCommands;

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
    resources.cancelDownload();
    void Promise.allSettled([settings.flush(), exports.cancelAll()]).finally(() => {
      resources.close();
      templateDev.close();
      flushed = true;
      app.quit();
    });
  });

  void app.whenReady().then(async () => {
    log.info('app', 'starting', { version: app.getVersion(), packaged: app.isPackaged, dev: devOrigin !== null });
    hardenSession(session.defaultSession, devOrigin, log);
    handleAppProtocol(join(__dirname, '../renderer'), log, mascotDir);

    await settings.load();

    // 启动画面（7.6 C）：设置读完就显示（要按主题和语言挑页面），主窗口就绪后淡出。后台测试默认不建，设了开关才建（不显示）
    let splash: Splash | null =
      !hiddenForTests || testSwitches.splash
        ? new Splash({ origin: devOrigin ?? APP_ORIGIN, ui: settings.ui, mascotDir, log, hiddenForTests })
        : null;

    const registrar = createIpcRegistrar({ getMainWindow: () => mainWindow, devOrigin, log });
    // 模板列表在注册 IPC 之前准备好：渲染进程第一次 templates.list 就能拿到内置模板
    await templatesReady;
    // 监视在模板列表就绪之后开始，不阻塞窗口（只读一遍现有用户模板的文件算哈希）
    void templateDev.start().catch((error: unknown) => log.warn('templates', 'template folder watcher did not start', { error: String(error) }));
    const grants = new FileGrants();
    const projects = new ProjectService({ userDataDir: userData, appVersion: app.getVersion(), grants, log });
    registerHandlers({
      registrar,
      settings,
      grants,
      exports,
      resources,
      thumbs,
      templates,
      templateDev,
      hostCommands,
      presets,
      projects,
      projectPathForTests: testSwitches.projectPath,
      testHooks: testSwitches.testHooks,
      getMainWindow: () => mainWindow,
    });
    // 资源栈：内置层和资源包先打开，原版层在后台离线探测（3.4），结果经 resources:changed 推给渲染进程
    void resources.init();
    // 启动时跑一次 ffmpeg -version 并记进日志（5.6），不阻塞窗口
    void exports.ffmpegInfo();
    settings.onUiChanged((ui) => {
      if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(IPC.settings.changed, ui);
    });

    mainWindow = createMainWindow({
      settings,
      theme: settings.ui.theme,
      log,
      hiddenForTests,
      beforeShow: () => splash?.ready() ?? Promise.resolve(),
      onShown: () => {
        splash?.close();
        splash = null;
      },
    });
    // 后台测试的窗口不显示，没有 onShown：页面加载完就关掉启动画面（仍然等满最短时长）
    if (hiddenForTests && splash) {
      const s = splash;
      mainWindow.once('ready-to-show', () => void s.ready().then(() => s.close()));
    }
    // 文件夹形式的资源包：窗口重新获得焦点时重扫（3.5）
    mainWindow.on('focus', () => void resources.rescanFolders());
    mainWindow.on('closed', () => {
      mainWindow = null;
      hostCommands.cancelAll();
      splash?.close();
    });
    await mainWindow.loadURL(devOrigin ?? APP_ENTRY_URL);
  });
}
