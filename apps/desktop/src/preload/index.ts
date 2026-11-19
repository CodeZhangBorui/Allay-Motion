import { contextBridge, ipcRenderer, webUtils, type IpcRendererEvent } from 'electron';
import { IPC, type InvokeChannel } from '../shared/ipc-channels';
import type { AllayApi } from './api';
import type { ResourceState } from '../shared/resources';
import type { UiSettings } from '../shared/settings';
import type { TemplateDevChange } from '../shared/templates';
import type { HostCommandRequest } from '../shared/host-commands';
import type { UpdateState } from '../shared/updates';

// preload 只做转发，不做判断：所有参数原样交给主进程，由主进程的 zod schema 校验。
// 不暴露 ipcRenderer 本身，也不暴露任何通用的“发消息”函数。

function invoke(channel: InvokeChannel) {
  return (...args: unknown[]): Promise<unknown> => ipcRenderer.invoke(channel, ...args);
}

function subscribe<T>(channel: string) {
  return (callback: (payload: T) => void): (() => void) => {
    if (typeof callback !== 'function') throw new TypeError('callback must be a function');
    const listener = (_event: IpcRendererEvent, payload: T) => callback(payload);
    ipcRenderer.on(channel, listener);
    return () => {
      ipcRenderer.removeListener(channel, listener);
    };
  };
}

const api = {
  app: {
    info: invoke(IPC.app.info),
  },
  settings: {
    get: invoke(IPC.settings.get),
    set: invoke(IPC.settings.set),
    onChanged: subscribe<UiSettings>(IPC.settings.changed),
  },
  window: {
    setTitleBarColors: invoke(IPC.window.setTitleBarColors),
    reload: invoke(IPC.window.reload),
  },
  files: {
    pickImage: invoke(IPC.files.pickImage),
    read: invoke(IPC.files.read),
  },
  export: {
    start: invoke(IPC.export.start),
    writeFrame: invoke(IPC.export.writeFrame),
    writeAudio: invoke(IPC.export.writeAudio),
    finish: invoke(IPC.export.finish),
    cancel: invoke(IPC.export.cancel),
    ffmpegInfo: invoke(IPC.export.ffmpegInfo),
    probeEncoders: invoke(IPC.export.probeEncoders),
    outputFolder: invoke(IPC.export.outputFolder),
    chooseFolder: invoke(IPC.export.chooseFolder),
    reveal: invoke(IPC.export.reveal),
    copyDiagnostics: invoke(IPC.export.copyDiagnostics),
  },
  resources: {
    layers: invoke(IPC.resources.layers),
    stamp: invoke(IPC.resources.stamp),
    read: invoke(IPC.resources.read),
    readTexture: invoke(IPC.resources.readTexture),
    soundVariants: invoke(IPC.resources.soundVariants),
    soundLibrary: invoke(IPC.resources.soundLibrary),
    soundFiles: invoke(IPC.resources.soundFiles),
    list: invoke(IPC.resources.list),
    fontProviders: invoke(IPC.resources.fontProviders),
    fallbackFont: invoke(IPC.resources.fallbackFont),
    detectMinecraft: invoke(IPC.resources.detectMinecraft),
    setVanilla: invoke(IPC.resources.setVanilla),
    chooseGameDir: invoke(IPC.resources.chooseGameDir),
    downloadVanilla: invoke(IPC.resources.downloadVanilla),
    cancelDownload: invoke(IPC.resources.cancelDownload),
    addPack: invoke(IPC.resources.addPack),
    removeLayer: invoke(IPC.resources.removeLayer),
    reorder: invoke(IPC.resources.reorder),
    setEnabled: invoke(IPC.resources.setEnabled),
    // 1.6 第 6 条：页面只能交来 File 对象，路径在这里用 webUtils 取。
    // 页面自己构造的 File 没有路径（返回空串），主进程会拒绝。
    addDroppedPack: (file: unknown): Promise<unknown> => {
      if (!(file instanceof File)) return Promise.reject(new TypeError('expected a File'));
      return ipcRenderer.invoke(IPC.resources.addDroppedPack, webUtils.getPathForFile(file));
    },
    onChanged: subscribe<ResourceState>(IPC.resources.changed),
  },
  templates: {
    list: invoke(IPC.templates.list),
    read: invoke(IPC.templates.read),
    readAsset: invoke(IPC.templates.readAsset),
    install: invoke(IPC.templates.install),
    // 1.6 第 6 条：同 addDroppedPack，只接受 File，路径由 webUtils 取
    installRequested: invoke(IPC.templates.installRequested),
    installDropped: (file: unknown): Promise<unknown> => {
      if (!(file instanceof File)) return Promise.reject(new TypeError('expected a File'));
      return ipcRenderer.invoke(IPC.templates.installDropped, webUtils.getPathForFile(file));
    },
    commitInstall: invoke(IPC.templates.commitInstall),
    cancelInstall: invoke(IPC.templates.cancelInstall),
    remove: invoke(IPC.templates.remove),
    exportPackage: invoke(IPC.templates.exportPackage),
    saveDerived: invoke(IPC.templates.saveDerived),
    copyBuiltin: invoke(IPC.templates.copyBuiltin),
    writeDevFiles: invoke(IPC.templates.writeDevFiles),
    openFolder: invoke(IPC.templates.openFolder),
    readSource: invoke(IPC.templates.readSource),
    writeSource: invoke(IPC.templates.writeSource),
    createFromAnimation: invoke(IPC.templates.createFromAnimation),
    onChanged: subscribe<TemplateDevChange>(IPC.templates.changed),
  },
  presets: {
    list: invoke(IPC.presets.list),
    save: invoke(IPC.presets.save),
    remove: invoke(IPC.presets.remove),
    importFile: invoke(IPC.presets.importFile),
    exportFile: invoke(IPC.presets.exportFile),
  },
  project: {
    open: invoke(IPC.project.open),
    openRequested: invoke(IPC.project.openRequested),
    openRecent: invoke(IPC.project.openRecent),
    save: invoke(IPC.project.save),
    saveAs: invoke(IPC.project.saveAs),
    recents: invoke(IPC.project.recents),
  },
  host: {
    onCommand: subscribe<HostCommandRequest>(IPC.host.command),
    commandResult: invoke(IPC.host.commandResult),
    ready: invoke(IPC.host.ready),
  },
  folders: {
    get: invoke(IPC.folders.get),
    choose: invoke(IPC.folders.choose),
    reset: invoke(IPC.folders.reset),
  },
  updates: {
    state: invoke(IPC.updates.state),
    check: invoke(IPC.updates.check),
    download: invoke(IPC.updates.download),
    cancel: invoke(IPC.updates.cancel),
    install: invoke(IPC.updates.install),
    onChanged: subscribe<UpdateState>(IPC.updates.changed),
  },
  cache: {
    getThumb: invoke(IPC.cache.getThumb),
    putThumb: invoke(IPC.cache.putThumb),
    clear: invoke(IPC.cache.clear),
    usage: invoke(IPC.cache.usage),
  },
} as unknown as AllayApi;

contextBridge.exposeInMainWorld('allay', api);
