import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';
import { IPC, type InvokeChannel } from '../shared/ipc-channels';
import type { AllayApi } from './api';
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
} as unknown as AllayApi;

contextBridge.exposeInMainWorld('allay', api);
