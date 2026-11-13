import { readFile, stat } from 'node:fs/promises';
import { basename } from 'node:path';
import { app, dialog, type BrowserWindow } from 'electron';
import type { AppInfo, PickedFile } from '../shared/ipc-contract';
import { IPC } from '../shared/ipc-channels';
import { TOPBAR_HEIGHT } from '../shared/theme-colors';
import type { FileGrants } from './file-grants';
import { IpcRejected, type createIpcRegistrar } from './ipc';
import type { SettingsStore } from './settings-store';

const MAX_IMAGE_BYTES = 64 * 1024 * 1024;

export interface HandlerDeps {
  registrar: ReturnType<typeof createIpcRegistrar>;
  settings: SettingsStore;
  grants: FileGrants;
  getMainWindow(): BrowserWindow | null;
}

export function registerHandlers({ registrar, settings, grants, getMainWindow }: HandlerDeps): void {
  const { handle } = registrar;

  handle(IPC.app.info, (): AppInfo => ({
    version: app.getVersion(),
    platform: process.platform,
    userDataDir: app.getPath('userData'),
    systemLocale: app.getPreferredSystemLanguages()[0] ?? app.getLocale(),
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
}
