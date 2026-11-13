import { readFile, stat, writeFile } from 'node:fs/promises';
import { basename, isAbsolute } from 'node:path';
import { app, dialog, type BrowserWindow } from 'electron';
import type { AppInfo, PickedFile } from '../shared/ipc-contract';
import type { AddPackResult, ChooseGameDirResult } from '../shared/resources';
import { IPC } from '../shared/ipc-channels';
import { TITLEBAR_OVERLAY_HEIGHT } from '../shared/theme-colors';
import { UnknownJobError, type ExportService } from './export/export-service';
import type { FileGrants } from './file-grants';
import { IpcRejected, type createIpcRegistrar } from './ipc';
import type { ResourceService } from './resources/service';
import type { SettingsStore } from './settings-store';
import type { ThumbCache } from './thumb-cache';
import type { ExportFileResult, StageResult } from '../shared/templates';
import type { PresetStore } from './templates/preset-store';
import type { ProjectService } from './project/service';
import { PROJECT_EXTENSION, type ProjectOpenResult, type ProjectSaveResult } from '../shared/project';
import type { TemplateService } from './templates/service';
import type { TemplateDevService } from './templates/dev-service';
import type { HostCommandChannel } from './host-commands';

const MAX_IMAGE_BYTES = 64 * 1024 * 1024;

export interface HandlerDeps {
  registrar: ReturnType<typeof createIpcRegistrar>;
  settings: SettingsStore;
  grants: FileGrants;
  exports: ExportService;
  resources: ResourceService;
  thumbs: ThumbCache;
  templates: TemplateService;
  templateDev: TemplateDevService;
  hostCommands: HostCommandChannel;
  presets: PresetStore;
  projects: ProjectService;
  /** 测试开关：工程的打开、保存对话框不弹出，直接用这个路径（只在未打包时非空） */
  projectPathForTests: string | null;
  testHooks: boolean;
  getMainWindow(): BrowserWindow | null;
}

/** 主进程的保存对话框；取消时为 null */
async function pickSavePath(win: BrowserWindow | null, defaultName: string, ext: string): Promise<string | null> {
  if (!win) return null;
  const result = await dialog.showSaveDialog(win, { defaultPath: defaultName, filters: [{ name: ext, extensions: [ext] }] });
  return result.canceled || !result.filePath ? null : result.filePath;
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

export function registerHandlers({ registrar, settings, grants, exports, resources, thumbs, templates, templateDev, hostCommands, presets, projects, projectPathForTests, testHooks, getMainWindow }: HandlerDeps): void {
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
    win.setTitleBarOverlay({ color: colors.color, symbolColor: colors.symbolColor, height: TITLEBAR_OVERLAY_HEIGHT });
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

  // ---- templates（04-templates.md 4.7–4.9）----
  handle(IPC.templates.list, () => templates.list());
  handle(IPC.templates.read, (_event, id, version) => templates.read(id, version));
  handle(IPC.templates.readAsset, (_event, source, path) => templates.readAsset(source, path));
  handle(IPC.templates.install, async (): Promise<StageResult> => {
    const win = getMainWindow();
    if (!win) return { canceled: true };
    const result = await dialog.showOpenDialog(win, { properties: ['openFile'], filters: [{ name: 'Template', extensions: ['allaytpl'] }] });
    const path = result.filePaths[0];
    if (result.canceled || !path) return { canceled: true };
    return templates.stage(path);
  });
  // 拖放：路径由 preload 用 webUtils.getPathForFile 从真实的 File 取得（1.6 第 6 条）
  handle(IPC.templates.installDropped, (_event, path) => {
    if (!isAbsolute(path)) throw new IpcRejected('dropped file has no path');
    return templates.stage(path);
  });
  handle(IPC.templates.commitInstall, (_event, stagingId, report) => templates.commit(stagingId, report));
  handle(IPC.templates.cancelInstall, (_event, stagingId) => templates.cancel(stagingId));
  handle(IPC.templates.remove, (_event, id, version) => templates.remove(id, version));
  handle(IPC.templates.exportPackage, async (_event, id, version): Promise<ExportFileResult> => {
    const bytes = await templates.exportPackage(id, version);
    if (!bytes) throw new IpcRejected('unknown template');
    const path = await pickSavePath(getMainWindow(), `${id}-${version}.allaytpl`, 'allaytpl');
    if (!path) return { canceled: true };
    await writeFile(path, bytes);
    return { ok: true, path };
  });
  // 另存为派生模板：用户选的图片（file: 引用）由主进程按引用读出、复制进模板的 assets/（4.7）
  handle(IPC.templates.saveDerived, (_event, req) => templates.saveDerived(req, (ref) => grants.resolve(ref)));
  // 模板开发模式（MD）：路径全由主进程按 id 和版本决定，只认用户模板目录里的文件夹（1.6 第 6 条）
  handle(IPC.templates.copyBuiltin, (_event, req) => templateDev.copyBuiltin(req));
  handle(IPC.templates.writeDevFiles, (_event, id, version) => templateDev.writeDevFiles({ id, version }));
  handle(IPC.templates.openFolder, (_event, id, version) => templateDev.openFolder({ id, version }));

  // ---- 主进程到界面的命令通道（H11）：界面交回结果 ----
  handle(IPC.host.commandResult, (_event, result) => hostCommands.receive(result));

  // ---- project（1.9）----
  const pickProjectToOpen = async (): Promise<string | null> => {
    if (projectPathForTests) return projectPathForTests;
    const win = getMainWindow();
    if (!win) return null;
    const result = await dialog.showOpenDialog(win, { properties: ['openFile'], filters: [{ name: 'Project', extensions: [PROJECT_EXTENSION] }] });
    const path = result.filePaths[0];
    return result.canceled || !path ? null : path;
  };
  const pickProjectToSave = async (name: string): Promise<string | null> => {
    if (projectPathForTests) return projectPathForTests;
    return pickSavePath(getMainWindow(), `${name.replace(/[\\/:*?"<>|]/g, '_')}.${PROJECT_EXTENSION}`, PROJECT_EXTENSION);
  };
  handle(IPC.project.open, async (): Promise<ProjectOpenResult> => {
    const path = await pickProjectToOpen();
    return path ? projects.openPath(path) : { canceled: true };
  });
  handle(IPC.project.openRecent, (_event, id) => projects.openRecent(id));
  handle(IPC.project.save, async (_event, handle, data): Promise<ProjectSaveResult> => {
    const known = handle ? projects.pathOf(handle) : null;
    if (handle && !known) throw new IpcRejected('unknown project handle');
    const path = known ?? (await pickProjectToSave(data.name));
    return path ? projects.saveTo(path, data) : { canceled: true };
  });
  handle(IPC.project.saveAs, async (_event, data): Promise<ProjectSaveResult> => {
    const path = await pickProjectToSave(data.name);
    return path ? projects.saveTo(path, data) : { canceled: true };
  });
  handle(IPC.project.recents, () => projects.recents());

  // ---- presets（4.7）----
  handle(IPC.presets.list, () => presets.list());
  handle(IPC.presets.save, (_event, req) => presets.save(req));
  handle(IPC.presets.remove, (_event, id) => presets.remove(id));
  handle(IPC.presets.importFile, async () => {
    const win = getMainWindow();
    if (!win) return { canceled: true } as const;
    const result = await dialog.showOpenDialog(win, { properties: ['openFile'], filters: [{ name: 'Preset', extensions: ['allaypreset'] }] });
    const path = result.filePaths[0];
    if (result.canceled || !path) return { canceled: true } as const;
    return presets.importFrom(path);
  });
  handle(IPC.presets.exportFile, async (_event, id): Promise<ExportFileResult> => {
    const text = await presets.contents(id);
    if (text === null) throw new IpcRejected('unknown preset');
    const path = await pickSavePath(getMainWindow(), 'preset.allaypreset', 'allaypreset');
    if (!path) return { canceled: true };
    await writeFile(path, text, 'utf8');
    return { ok: true, path };
  });

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
