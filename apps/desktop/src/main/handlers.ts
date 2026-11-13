import { readFile, stat } from 'node:fs/promises';
import { basename, isAbsolute } from 'node:path';
import { app, dialog, type BrowserWindow } from 'electron';
import type { AppInfo, PickedFile } from '../shared/ipc-contract';
import type { AddPackResult, ChooseGameDirResult } from '../shared/resources';
import { IPC } from '../shared/ipc-channels';
import { TOPBAR_HEIGHT } from '../shared/theme-colors';
import { UnknownJobError, type ExportService } from './export/export-service';
import type { FileGrants } from './file-grants';
import { IpcRejected, type createIpcRegistrar } from './ipc';
import type { ResourceService } from './resources/service';
import type { SettingsStore } from './settings-store';
import type { ThumbCache } from './thumb-cache';

const MAX_IMAGE_BYTES = 64 * 1024 * 1024;

export interface HandlerDeps {
  registrar: ReturnType<typeof createIpcRegistrar>;
  settings: SettingsStore;
  grants: FileGrants;
  exports: ExportService;
  resources: ResourceService;
  thumbs: ThumbCache;
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

export function registerHandlers({ registrar, settings, grants, exports, resources, thumbs, testHooks, getMainWindow }: HandlerDeps): void {
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

  // ---- resources（03-assets.md）----
  handle(IPC.resources.layers, async () => {
    await resources.whenOpened();
    return resources.state();
  });
  handle(IPC.resources.stamp, async () => {
    await resources.whenOpened();
    return resources.resourceStamp;
  });
  handle(IPC.resources.read, (_event, path) => resources.read(path));
  handle(IPC.resources.readTexture, (_event, id) => resources.readTexture(id));
  handle(IPC.resources.list, (_event, prefix) => resources.list(prefix));
  handle(IPC.resources.fontProviders, (_event, id) => resources.fontProviders(id));
  handle(IPC.resources.fallbackFont, () => resources.fallbackFontTables());
  handle(IPC.resources.detectMinecraft, () => resources.detectMinecraft());
  handle(IPC.resources.setVanilla, (_event, patch) => resources.setVanilla(patch));
  handle(IPC.resources.chooseGameDir, async (): Promise<ChooseGameDirResult> => {
    const win = getMainWindow();
    if (!win) return { canceled: true };
    const result = await dialog.showOpenDialog(win, { properties: ['openDirectory'] });
    const dir = result.filePaths[0];
    if (result.canceled || !dir) return { canceled: true };
    return resources.useGameDir(dir);
  });
  handle(IPC.resources.downloadVanilla, () => resources.downloadVanilla());
  handle(IPC.resources.cancelDownload, () => resources.cancelDownload());
  handle(IPC.resources.addPack, async (_event, kind): Promise<AddPackResult> => {
    const win = getMainWindow();
    if (!win) return { canceled: true };
    const result = await dialog.showOpenDialog(
      win,
      kind === 'zip' ? { properties: ['openFile'], filters: [{ name: 'Resource pack', extensions: ['zip'] }] } : { properties: ['openDirectory'] },
    );
    const path = result.filePaths[0];
    if (result.canceled || !path) return { canceled: true };
    return resources.addPackFromPath(path);
  });
  // 拖放：路径由 preload 用 webUtils.getPathForFile 从真实的 File 取得（1.6 第 6 条）
  handle(IPC.resources.addDroppedPack, (_event, path) => {
    if (!isAbsolute(path)) throw new IpcRejected('dropped file has no path');
    return resources.addPackFromPath(path);
  });
  handle(IPC.resources.removeLayer, (_event, id) => resources.removeLayer(id));
  handle(IPC.resources.reorder, (_event, ids) => resources.reorder(ids));
  handle(IPC.resources.setEnabled, (_event, id, enabled) => resources.setEnabled(id, enabled));

  // ---- cache（缩略图，3.10）----
  handle(IPC.cache.getThumb, (_event, stamp, key) => thumbs.get(stamp, key));
  handle(IPC.cache.putThumb, async (_event, stamp, key, png) => {
    if (!(await thumbs.put(stamp, key, png))) throw new IpcRejected('thumbnail is not a PNG');
  });
  handle(IPC.cache.clear, () => thumbs.clear());
  handle(IPC.cache.usage, () => thumbs.usage());

  handle(IPC.export.ffmpegInfo, () => exports.ffmpegInfo());
  handle(IPC.export.start, (_event, req) => exports.start(req));
  handle(IPC.export.writeFrame, (_event, jobId, pixels) => knownJob(() => exports.writeFrame(jobId, pixels)));
  handle(IPC.export.finish, (_event, jobId) => knownJob(() => exports.finish(jobId)));
  // 取消一个已经结束或不存在的任务不算错
  handle(IPC.export.cancel, (_event, jobId) => exports.cancel(jobId));
}
