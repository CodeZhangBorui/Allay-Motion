import { join } from 'node:path';
import { dialog, type BrowserWindow } from 'electron';
import type { FolderChooseResult, FolderInfo, FolderKind, FoldersInfo } from '../shared/folders';
import { folderState } from './folder-state';
import type { Logger } from './logger';
import type { SettingsStore } from './settings-store';

// 默认文件夹（docs/06-ui-design.md 6.11、docs/decisions.md 界面增强）：工程的默认保存文件夹、导出的输出文件夹。
// 路径只来自主进程的文件夹对话框（1.6 第 6 条）；渲染进程只说“选哪一个”（kind），拿回来的路径只用于显示。
//
// 文件夹不存在或不可写时：设置里的值不动（可能是没插上的移动硬盘），设置页标出原因；
// - 工程：保存对话框退回系统默认位置；
// - 导出：和没选过一样，点“导出”时先弹文件夹对话框（M7 的做法）。

export interface FolderServiceOptions {
  settings: SettingsStore;
  log: Logger;
  getMainWindow(): BrowserWindow | null;
  /** 测试开关（只在未打包时非空）：文件夹对话框不弹出，直接“选中”这个路径 */
  pickForTests: string | null;
}

export class FolderService {
  constructor(private readonly opts: FolderServiceOptions) {}

  private stored(kind: FolderKind): string | null {
    return kind === 'project' ? this.opts.settings.projectSettings.folder : this.opts.settings.exportSettings.folder;
  }

  private async save(kind: FolderKind, folder: string | null): Promise<void> {
    if (kind === 'project') await this.opts.settings.updateProject({ folder });
    else await this.opts.settings.updateExport({ folder });
  }

  async info(kind: FolderKind): Promise<FolderInfo> {
    const path = this.stored(kind);
    return { kind, path, state: await folderState(path) };
  }

  async all(): Promise<FoldersInfo> {
    const [project, exportFolder] = await Promise.all([this.info('project'), this.info('export')]);
    return { project, export: exportFolder };
  }

  /** 能用的文件夹；不能用时为 null */
  async usable(kind: FolderKind): Promise<string | null> {
    const info = await this.info(kind);
    return info.state === 'ok' ? info.path : null;
  }

  /** 主进程的文件夹对话框；选中的文件夹可写才记进设置 */
  async choose(kind: FolderKind): Promise<FolderChooseResult> {
    let folder: string | null;
    if (this.opts.pickForTests) folder = this.opts.pickForTests;
    else {
      const win = this.opts.getMainWindow();
      if (!win || win.isDestroyed()) return { canceled: true };
      const current = await this.usable(kind);
      const result = await dialog.showOpenDialog(win, { properties: ['openDirectory', 'createDirectory'], ...(current ? { defaultPath: current } : {}) });
      folder = result.canceled ? null : (result.filePaths[0] ?? null);
    }
    if (!folder) return { canceled: true };
    const state = await folderState(folder);
    if (state !== 'ok') {
      this.opts.log.warn('folders', 'chosen folder is not usable', { kind, state });
      return { ok: false, error: state === 'readonly' ? 'readonly' : 'missing' };
    }
    await this.save(kind, folder);
    return { ok: true, info: { kind, path: folder, state } };
  }

  /** 清除（回到“未设置”：工程用系统默认位置，导出时再问） */
  async reset(kind: FolderKind): Promise<FolderInfo> {
    await this.save(kind, null);
    return { kind, path: null, state: 'unset' };
  }

  /** 工程保存对话框的默认路径：默认文件夹能用时放在里面，否则只给文件名（系统默认位置） */
  async projectSavePath(fileName: string): Promise<string> {
    const folder = await this.usable('project');
    return folder ? join(folder, fileName) : fileName;
  }

  /** 打开工程的对话框从哪里开始 */
  async projectOpenPath(): Promise<string | undefined> {
    return (await this.usable('project')) ?? undefined;
  }
}
