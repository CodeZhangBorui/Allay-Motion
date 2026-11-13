// IPC 通道名。preload 和主进程共用；这里不放 zod，preload 保持最薄。
// 命名空间与 docs/01-product-architecture.md 1.8 一致；M0 实现了 app、settings、window、files，
// M1 加上 export 的 start、writeFrame、finish、cancel、ffmpegInfo（writeAudio、probeEncoders 在 M6、M7）；
// M2 加上 resources 和 cache（规格之外多出的几个方法见 docs/decisions.md M2b）。

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
  IPC.cache.getThumb,
  IPC.cache.putThumb,
  IPC.cache.clear,
  IPC.cache.usage,
] as const;

export type InvokeChannel = (typeof INVOKE_CHANNELS)[number];
