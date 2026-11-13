import { ipcMain, type BrowserWindow, type IpcMainInvokeEvent } from 'electron';
import type { z } from 'zod';
import { IPC_ARGS, type IpcArgs } from '../shared/ipc-contract';
import type { InvokeChannel } from '../shared/ipc-channels';
import { checkSender } from './ipc-guard';
import type { Logger } from './logger';

// IPC 注册：每个处理函数先确认来源，再用 zod 校验整个参数列表，然后才执行。
// 校验失败只拒绝这一次调用（renderer 的 Promise 被 reject），主进程照常运行。

export class IpcRejected extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'IpcRejected';
  }
}

export interface IpcContext {
  getMainWindow(): BrowserWindow | null;
  devOrigin: string | null;
  log: Logger;
}

type Handler<C extends InvokeChannel> = (event: IpcMainInvokeEvent, ...args: IpcArgs<C>) => unknown;

export function createIpcRegistrar(ctx: IpcContext) {
  const registered = new Set<InvokeChannel>();

  function handle<C extends InvokeChannel>(channel: C, handler: Handler<C>): void {
    const schema: z.ZodTuple = IPC_ARGS[channel];
    registered.add(channel);
    ipcMain.handle(channel, async (event, ...rawArgs: unknown[]) => {
      const win = ctx.getMainWindow();
      const sender = checkSender(
        event,
        win && !win.isDestroyed() ? { webContents: win.webContents, mainFrame: win.webContents.mainFrame } : null,
        ctx.devOrigin,
      );
      if (!sender.ok) {
        ctx.log.warn('ipc', 'rejected call from untrusted sender', { channel, reason: sender.reason });
        throw new IpcRejected('untrusted sender');
      }
      const parsed = schema.safeParse(rawArgs);
      if (!parsed.success) {
        ctx.log.warn('ipc', 'rejected malformed arguments', {
          channel,
          issues: parsed.error.issues.slice(0, 3).map((i) => `${i.path.join('.')}: ${i.message}`),
        });
        throw new IpcRejected('invalid arguments');
      }
      try {
        return await handler(event, ...(parsed.data as IpcArgs<C>));
      } catch (error) {
        if (error instanceof IpcRejected) {
          ctx.log.warn('ipc', 'rejected call', { channel, reason: error.message });
          throw error;
        }
        ctx.log.error('ipc', 'handler failed', { channel, error });
        // 渲染进程只会收到 message，cause 留在主进程
        throw new Error('internal error', { cause: error });
      }
    });
  }

  return { handle, registered };
}
