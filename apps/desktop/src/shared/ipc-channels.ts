// IPC 通道名。preload 和主进程共用；这里不放 zod，preload 保持最薄。
// 命名空间与 docs/01-product-architecture.md 1.8 一致；M0 实现了 app、settings、window、files，
// M1 加上 export 的 start、writeFrame、finish、cancel、ffmpegInfo（writeAudio、probeEncoders 在 M6、M7）；
// M2 加上 resources 和 cache（规格之外多出的几个方法见 docs/decisions.md M2b）；
// M3 加上 templates 和 presets（多出的 commitInstall、cancelInstall、saveDerived 见 docs/decisions.md M3）；
// M4 加上 project（没有 create：新建工程只是渲染进程里的状态，见 docs/decisions.md M4）；
// M6b 加上 export.writeAudio 和 resources.soundVariants、soundLibrary、soundFiles（音效，docs/decisions.md M6b）；
// M7 在 export 下加上 probeEncoders，以及规格之外的 outputFolder、chooseFolder、reveal、copyDiagnostics（docs/decisions.md M7）；
// MD-a 在 templates 下加上模板开发模式的 copyBuiltin、writeDevFiles、openFolder 和 changed 事件（docs/decisions.md MD-a）；
// 2026-11 反馈在 templates 下加上 readSource、writeSource、createFromAnimation（内嵌代码编辑、自建动画转为模板）；
// 第二轮反馈加上 codeWindow（第二个窗口，消息经主进程转发）、editors、animations（外部编辑器与动画文档文件）；
// MD-b 加上 host：主进程到界面的命令通道（command 事件和交回结果的 commandResult，docs/decisions.md MD-b）；
// M8 加上 host.ready（界面就绪）和文件关联用的 project.openRequested、templates.installRequested（docs/decisions.md M8）；
// 修试用版崩溃时加上 window.reload（错误页的“重新载入”，docs/decisions.md “试用版的三个崩溃”）；
// 界面增强加上 folders：默认文件夹的查询、选择、清除（docs/decisions.md 界面增强）；
// 自动更新加上 updates：状态、检查、下载、取消、安装和 changed 事件（docs/decisions.md“自动更新”）；
// 2026-11 字体加上 resources.unihexTables 和 fonts（同时删掉 resources.fallbackFont：内置像素字体删了）：用户导入字体的列表、导入、删除、读取（docs/decisions.md“2026-11 反馈：原版动画还原与字体”）。

export const IPC = {
  app: {
    info: 'app:info',
  },
  settings: {
    get: 'settings:get',
    set: 'settings:set',
    /** 主进程 → 渲染进程的事件 */
    changed: 'settings:changed',
  },
  window: {
    setTitleBarColors: 'window:setTitleBarColors',
    /** 重新载入界面（错误页的“重新载入”）：渲染进程自己的 location.reload 被导航拦截挡住（1.6），由主进程 reload */
    reload: 'window:reload',
  },
  files: {
    pickImage: 'files:pickImage',
    read: 'files:read',
  },
  export: {
    start: 'export:start',
    writeFrame: 'export:writeFrame',
    writeAudio: 'export:writeAudio',
    finish: 'export:finish',
    cancel: 'export:cancel',
    ffmpegInfo: 'export:ffmpegInfo',
    probeEncoders: 'export:probeEncoders',
    outputFolder: 'export:outputFolder',
    chooseFolder: 'export:chooseFolder',
    reveal: 'export:reveal',
    copyDiagnostics: 'export:copyDiagnostics',
  },
  resources: {
    layers: 'resources:layers',
    stamp: 'resources:stamp',
    read: 'resources:read',
    readTexture: 'resources:readTexture',
    soundVariants: 'resources:soundVariants',
    soundLibrary: 'resources:soundLibrary',
    soundFiles: 'resources:soundFiles',
    list: 'resources:list',
    fontProviders: 'resources:fontProviders',
    unihexTables: 'resources:unihexTables',
    detectMinecraft: 'resources:detectMinecraft',
    setVanilla: 'resources:setVanilla',
    chooseGameDir: 'resources:chooseGameDir',
    downloadVanilla: 'resources:downloadVanilla',
    cancelDownload: 'resources:cancelDownload',
    addPack: 'resources:addPack',
    addDroppedPack: 'resources:addDroppedPack',
    removeLayer: 'resources:removeLayer',
    reorder: 'resources:reorder',
    setEnabled: 'resources:setEnabled',
    /** 版本检索（2026-11 反馈）：本机、已下载、取过的版本清单（离线） */
    versions: 'resources:versions',
    /** 联网：取 Mojang 版本清单（只在用户点了按钮后） */
    fetchRemoteVersions: 'resources:fetchRemoteVersions',
    addVanillaSource: 'resources:addVanillaSource',
    /** 联网：下载指定版本（只在用户点了按钮后） */
    downloadVanillaVersion: 'resources:downloadVanillaVersion',
    /** 本机 Minecraft 的资源包文件夹（只读本机文件） */
    localPacks: 'resources:localPacks',
    addLocalPack: 'resources:addLocalPack',
    /** 导入音效文件（主进程弹文件对话框） */
    importSounds: 'resources:importSounds',
    removeImportedSound: 'resources:removeImportedSound',
    /** 主进程 → 渲染进程的事件 */
    changed: 'resources:changed',
  },
  templates: {
    list: 'templates:list',
    read: 'templates:read',
    readAsset: 'templates:readAsset',
    install: 'templates:install',
    installDropped: 'templates:installDropped',
    /** 文件关联（M8）：按主进程发来的一次性令牌暂存模板包 */
    installRequested: 'templates:installRequested',
    commitInstall: 'templates:commitInstall',
    cancelInstall: 'templates:cancelInstall',
    remove: 'templates:remove',
    exportPackage: 'templates:exportPackage',
    saveDerived: 'templates:saveDerived',
    copyBuiltin: 'templates:copyBuiltin',
    writeDevFiles: 'templates:writeDevFiles',
    openFolder: 'templates:openFolder',
    /** 2026-11：内嵌代码编辑器读写模板源码（带内容版本），自建动画转为模板 */
    readSource: 'templates:readSource',
    writeSource: 'templates:writeSource',
    createFromAnimation: 'templates:createFromAnimation',
    /** 主进程 → 渲染进程的事件：用户模板文件夹在应用之外被改动 */
    changed: 'templates:changed',
  },
  presets: {
    list: 'presets:list',
    save: 'presets:save',
    remove: 'presets:remove',
    importFile: 'presets:importFile',
    exportFile: 'presets:exportFile',
  },
  project: {
    open: 'project:open',
    /** 文件关联（M8）：按主进程发来的一次性令牌打开工程 */
    openRequested: 'project:openRequested',
    openRecent: 'project:openRecent',
    save: 'project:save',
    saveAs: 'project:saveAs',
    recents: 'project:recents',
  },
  host: {
    /** 主进程 → 渲染进程的事件：请界面执行一个命令 */
    command: 'host:command',
    commandResult: 'host:commandResult',
    /** 界面就绪（首屏画完、初始模板装好、命令通道接好）：主进程据此开始执行排队的文件关联请求，并记下启动时间 */
    ready: 'host:ready',
  },
  folders: {
    get: 'folders:get',
    choose: 'folders:choose',
    reset: 'folders:reset',
  },
  /** 自动更新（docs/decisions.md“自动更新”） */
  updates: {
    state: 'updates:state',
    check: 'updates:check',
    download: 'updates:download',
    cancel: 'updates:cancel',
    install: 'updates:install',
    /** 主进程 → 渲染进程的事件 */
    changed: 'updates:changed',
  },
  fonts: {
    list: 'fonts:list',
    import: 'fonts:import',
    remove: 'fonts:remove',
    read: 'fonts:read',
  },
  /** 代码窗口（2026-11 第二轮反馈）：两个窗口之间的消息都经主进程转发 */
  codeWindow: {
    open: 'codeWindow:open',
    close: 'codeWindow:close',
    /** 主窗口 → 代码窗口（主窗口调用） */
    publish: 'codeWindow:publish',
    /** 代码窗口 → 主窗口（代码窗口调用；代码窗口只能调这一个通道，见 main/ipc-guard.ts） */
    send: 'codeWindow:send',
    /** 主进程 → 代码窗口的事件 */
    down: 'codeWindow:down',
    /** 主进程 → 主窗口的事件 */
    up: 'codeWindow:up',
  },
  /** 外部编辑器与动画文档文件（2026-11 第二轮反馈） */
  editors: {
    get: 'editors:get',
    setKind: 'editors:setKind',
    chooseProgram: 'editors:chooseProgram',
  },
  animations: {
    openExternal: 'animations:openExternal',
    syncFile: 'animations:syncFile',
    /** 主进程 → 主窗口的事件：外部编辑器改了动画文件 */
    fileChanged: 'animations:fileChanged',
  },
  cache: {
    getThumb: 'cache:getThumb',
    putThumb: 'cache:putThumb',
    clear: 'cache:clear',
    usage: 'cache:usage',
  },
} as const;

type Leaves<T> = T extends string ? T : { [K in keyof T]: Leaves<T[K]> }[keyof T];

/** 所有通道名 */
export type IpcChannel = Leaves<typeof IPC>;

/** 渲染进程可以 invoke 的通道（事件通道除外） */
export const INVOKE_CHANNELS = [
  IPC.app.info,
  IPC.settings.get,
  IPC.settings.set,
  IPC.window.setTitleBarColors,
  IPC.window.reload,
  IPC.files.pickImage,
  IPC.files.read,
  IPC.export.start,
  IPC.export.writeFrame,
  IPC.export.writeAudio,
  IPC.export.finish,
  IPC.export.cancel,
  IPC.export.ffmpegInfo,
  IPC.export.probeEncoders,
  IPC.export.outputFolder,
  IPC.export.chooseFolder,
  IPC.export.reveal,
  IPC.export.copyDiagnostics,
  IPC.resources.layers,
  IPC.resources.stamp,
  IPC.resources.read,
  IPC.resources.readTexture,
  IPC.resources.soundVariants,
  IPC.resources.soundLibrary,
  IPC.resources.soundFiles,
  IPC.resources.list,
  IPC.resources.fontProviders,
  IPC.resources.unihexTables,
  IPC.resources.detectMinecraft,
  IPC.resources.setVanilla,
  IPC.resources.chooseGameDir,
  IPC.resources.downloadVanilla,
  IPC.resources.cancelDownload,
  IPC.resources.addPack,
  IPC.resources.addDroppedPack,
  IPC.resources.removeLayer,
  IPC.resources.reorder,
  IPC.resources.setEnabled,
  IPC.resources.versions,
  IPC.resources.fetchRemoteVersions,
  IPC.resources.addVanillaSource,
  IPC.resources.downloadVanillaVersion,
  IPC.resources.localPacks,
  IPC.resources.addLocalPack,
  IPC.resources.importSounds,
  IPC.resources.removeImportedSound,
  IPC.templates.list,
  IPC.templates.read,
  IPC.templates.readAsset,
  IPC.templates.install,
  IPC.templates.installDropped,
  IPC.templates.installRequested,
  IPC.templates.commitInstall,
  IPC.templates.cancelInstall,
  IPC.templates.remove,
  IPC.templates.exportPackage,
  IPC.templates.saveDerived,
  IPC.templates.copyBuiltin,
  IPC.templates.writeDevFiles,
  IPC.templates.openFolder,
  IPC.templates.readSource,
  IPC.templates.writeSource,
  IPC.templates.createFromAnimation,
  IPC.presets.list,
  IPC.presets.save,
  IPC.presets.remove,
  IPC.presets.importFile,
  IPC.presets.exportFile,
  IPC.project.open,
  IPC.project.openRequested,
  IPC.project.openRecent,
  IPC.project.save,
  IPC.project.saveAs,
  IPC.project.recents,
  IPC.host.commandResult,
  IPC.host.ready,
  IPC.folders.get,
  IPC.folders.choose,
  IPC.folders.reset,
  IPC.updates.state,
  IPC.updates.check,
  IPC.updates.download,
  IPC.updates.cancel,
  IPC.updates.install,
  IPC.fonts.list,
  IPC.fonts.import,
  IPC.fonts.remove,
  IPC.fonts.read,
  IPC.codeWindow.open,
  IPC.codeWindow.close,
  IPC.codeWindow.publish,
  IPC.codeWindow.send,
  IPC.editors.get,
  IPC.editors.setKind,
  IPC.editors.chooseProgram,
  IPC.animations.openExternal,
  IPC.animations.syncFile,
  IPC.cache.getThumb,
  IPC.cache.putThumb,
  IPC.cache.clear,
  IPC.cache.usage,
] as const;

export type InvokeChannel = (typeof INVOKE_CHANNELS)[number];
