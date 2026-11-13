import { contextBridge, ipcRenderer, webUtils, type IpcRendererEvent } from 'electron';
import { IPC, type InvokeChannel } from '../shared/ipc-channels';
import type { AllayApi } from './api';
import type { ResourceState } from '../shared/resources';
import type { UiSettings } from '../shared/settings';

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
  },
  files: {
    pickImage: invoke(IPC.files.pickImage),
    read: invoke(IPC.files.read),
  },
  export: {
    start: invoke(IPC.export.start),
    writeFrame: invoke(IPC.export.writeFrame),
    finish: invoke(IPC.export.finish),
    cancel: invoke(IPC.export.cancel),
    ffmpegInfo: invoke(IPC.export.ffmpegInfo),
  },
  resources: {
    layers: invoke(IPC.resources.layers),
    stamp: invoke(IPC.resources.stamp),
    read: invoke(IPC.resources.read),
    readTexture: invoke(IPC.resources.readTexture),
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
  cache: {
    getThumb: invoke(IPC.cache.getThumb),
    putThumb: invoke(IPC.cache.putThumb),
    clear: invoke(IPC.cache.clear),
    usage: invoke(IPC.cache.usage),
  },
} as unknown as AllayApi;

contextBridge.exposeInMainWorld('allay', api);
