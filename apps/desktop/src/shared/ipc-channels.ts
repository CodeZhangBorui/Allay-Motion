// IPC 通道名。preload 和主进程共用；这里不放 zod，preload 保持最薄。
// 命名空间与 docs/01-product-architecture.md 1.8 一致；M0 实现了 app、settings、window、files，
// M1 加上 export 的 start、writeFrame、finish、cancel、ffmpegInfo（writeAudio、probeEncoders 在 M6、M7）；
// M2 加上 resources 和 cache（规格之外多出的几个方法见 docs/decisions.md M2b）；
// M3 加上 templates 和 presets（多出的 commitInstall、cancelInstall、saveDerived 见 docs/decisions.md M3）；
// M4 加上 project（没有 create：新建工程只是渲染进程里的状态，见 docs/decisions.md M4）；
// MD-a 在 templates 下加上模板开发模式的 copyBuiltin、writeDevFiles、openFolder 和 changed 事件（docs/decisions.md MD-a）。

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
  },
  files: {
    pickImage: 'files:pickImage',
    read: 'files:read',
  },
  export: {
    start: 'export:start',
    writeFrame: 'export:writeFrame',
    finish: 'export:finish',
    cancel: 'export:cancel',
    ffmpegInfo: 'export:ffmpegInfo',
  },
  resources: {
    layers: 'resources:layers',
    stamp: 'resources:stamp',
    read: 'resources:read',
    readTexture: 'resources:readTexture',
    list: 'resources:list',
    fontProviders: 'resources:fontProviders',
    fallbackFont: 'resources:fallbackFont',
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
    /** 主进程 → 渲染进程的事件 */
    changed: 'resources:changed',
  },
  templates: {
    list: 'templates:list',
    read: 'templates:read',
    readAsset: 'templates:readAsset',
    install: 'templates:install',
    installDropped: 'templates:installDropped',
    commitInstall: 'templates:commitInstall',
    cancelInstall: 'templates:cancelInstall',
    remove: 'templates:remove',
    exportPackage: 'templates:exportPackage',
    saveDerived: 'templates:saveDerived',
    copyBuiltin: 'templates:copyBuiltin',
    writeDevFiles: 'templates:writeDevFiles',
    openFolder: 'templates:openFolder',
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
    openRecent: 'project:openRecent',
    save: 'project:save',
    saveAs: 'project:saveAs',
    recents: 'project:recents',
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
  IPC.files.pickImage,
  IPC.files.read,
  IPC.export.start,
  IPC.export.writeFrame,
  IPC.export.finish,
  IPC.export.cancel,
  IPC.export.ffmpegInfo,
  IPC.resources.layers,
  IPC.resources.stamp,
  IPC.resources.read,
  IPC.resources.readTexture,
  IPC.resources.list,
  IPC.resources.fontProviders,
  IPC.resources.fallbackFont,
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
  IPC.templates.list,
  IPC.templates.read,
  IPC.templates.readAsset,
  IPC.templates.install,
  IPC.templates.installDropped,
  IPC.templates.commitInstall,
  IPC.templates.cancelInstall,
  IPC.templates.remove,
  IPC.templates.exportPackage,
  IPC.templates.saveDerived,
  IPC.templates.copyBuiltin,
  IPC.templates.writeDevFiles,
  IPC.templates.openFolder,
  IPC.presets.list,
  IPC.presets.save,
  IPC.presets.remove,
  IPC.presets.importFile,
  IPC.presets.exportFile,
  IPC.project.open,
  IPC.project.openRecent,
  IPC.project.save,
  IPC.project.saveAs,
  IPC.project.recents,
  IPC.cache.getThumb,
  IPC.cache.putThumb,
  IPC.cache.clear,
  IPC.cache.usage,
] as const;

export type InvokeChannel = (typeof INVOKE_CHANNELS)[number];
