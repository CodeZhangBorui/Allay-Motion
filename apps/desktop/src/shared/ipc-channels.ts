// IPC 通道名。preload 和主进程共用；这里不放 zod，preload 保持最薄。
// 命名空间与 docs/01-product-architecture.md 1.8 一致；M0 只实现其中的 app、settings、window、files。

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
] as const;

export type InvokeChannel = (typeof INVOKE_CHANNELS)[number];
