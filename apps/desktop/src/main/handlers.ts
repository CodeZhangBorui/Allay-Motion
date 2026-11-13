import { readFile, stat } from 'node:fs/promises';
import { basename } from 'node:path';
import { app, dialog, type BrowserWindow } from 'electron';
import type { AppInfo, PickedFile } from '../shared/ipc-contract';
import { IPC } from '../shared/ipc-channels';
import { TOPBAR_HEIGHT } from '../shared/theme-colors';
import { UnknownJobError, type ExportService } from './export/export-service';
import type { FileGrants } from './file-grants';
import { IpcRejected, type createIpcRegistrar } from './ipc';
import type { SettingsStore } from './settings-store';

const MAX_IMAGE_BYTES = 64 * 1024 * 1024;

export interface HandlerDeps {
  registrar: ReturnType<typeof createIpcRegistrar>;
  settings: SettingsStore;
  grants: FileGrants;
  exports: ExportService;
  testHooks: boolean;
  getMainWindow(): BrowserWindow | null;
}

/** 未知的任务 ID 是调用方的错，拒绝这次调用，不当成主进程内部错误 */
async function knownJob<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    if (error instanceof UnknownJobError) throw new IpcRejected('unknown export job');
    throw error;
  }
}

export function registerHandlers({ registrar, settings, grants, exports, testHooks, getMainWindow }: HandlerDeps): void {
  const { handle } = registrar;

  handle(IPC.app.info, (): AppInfo => ({
    version: app.getVersion(),
    platform: process.platform,
    userDataDir: app.getPath('userData'),
    systemLocale: app.getPreferredSystemLanguages()[0] ?? app.getLocale(),
    testHooks,
  }));

  handle(IPC.settings.get, () => settings.ui);
  handle(IPC.settings.set, (_event, patch) => settings.updateUi(patch));

  handle(IPC.window.setTitleBarColors, (_event, colors) => {
    const win = getMainWindow();
    if (!win || win.isDestroyed()) return;
    win.setTitleBarOverlay({ color: colors.color, symbolColor: colors.symbolColor, height: TOPBAR_HEIGHT });
  });

  handle(IPC.files.pickImage, async (): Promise<PickedFile | null> => {
    const win = getMainWindow();
    if (!win) return null;
    const result = await dialog.showOpenDialog(win, {
      properties: ['openFile'],
      filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp'] }],
    });
    const path = result.filePaths[0];
    if (result.canceled || !path) return null;
    return { ref: grants.grant(path), name: basename(path) };
  });

  handle(IPC.files.read, async (_event, ref) => {
    const path = grants.resolve(ref);
    if (!path) throw new IpcRejected('unknown file reference');
    const info = await stat(path);
    if (!info.isFile() || info.size > MAX_IMAGE_BYTES) throw new IpcRejected('file not readable');
    return new Uint8Array(await readFile(path));
  });

  handle(IPC.export.ffmpegInfo, () => exports.ffmpegInfo());
  handle(IPC.export.start, (_event, req) => exports.start(req));
  handle(IPC.export.writeFrame, (_event, jobId, pixels) => knownJob(() => exports.writeFrame(jobId, pixels)));
  handle(IPC.export.finish, (_event, jobId) => knownJob(() => exports.finish(jobId)));
  // 取消一个已经结束或不存在的任务不算错
  handle(IPC.export.cancel, (_event, jobId) => exports.cancel(jobId));
}
