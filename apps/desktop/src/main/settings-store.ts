import { randomBytes } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import {
  SETTINGS_FORMAT_VERSION,
  SettingsFileSchema,
  applyUiPatch,
  defaultSettingsFile,
  type ExportAppSettings,
  type SettingsFile,
  type UiSettings,
  type UiSettingsPatch,
  type WindowState,
} from '../shared/settings';
import type { ResourceStackSettings } from '@allay/assets';
import type { Logger } from './logger';

// settings.json 的读写（docs/01-product-architecture.md 1.9）：
// 带 formatVersion；先写临时文件再改名；写入串行，后写的覆盖先写的。

/** 原子写：同目录临时文件 → rename。Windows 上 rename 会替换已存在的目标。 */
export async function writeJsonAtomic(file: string, value: unknown): Promise<void> {
  await mkdir(dirname(file), { recursive: true });
  const tmp = join(dirname(file), `.${randomBytes(6).toString('hex')}.tmp`);
  try {
    await writeFile(tmp, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
    await rename(tmp, file);
  } catch (error) {
    await rm(tmp, { force: true });
    throw error;
  }
}

export class SettingsStore {
  private current: SettingsFile = defaultSettingsFile();
  private queue: Promise<void> = Promise.resolve();
  private readonly listeners = new Set<(ui: UiSettings) => void>();

  constructor(
    readonly file: string,
    private readonly log: Logger,
  ) {}

  /** 读取设置；文件缺失、损坏、版本不对时用默认值，损坏的文件改名留档 */
  async load(): Promise<SettingsFile> {
    let raw: string;
    try {
      raw = await readFile(this.file, 'utf8');
    } catch {
      this.current = defaultSettingsFile();
      return this.current;
    }
    let json: unknown;
    try {
      json = JSON.parse(raw);
    } catch {
      await this.quarantine('invalid JSON');
      return this.current;
    }
    const parsed = SettingsFileSchema.safeParse(json);
    if (!parsed.success) {
      await this.quarantine(`schema mismatch (expected formatVersion ${SETTINGS_FORMAT_VERSION})`);
      return this.current;
    }
    this.current = parsed.data;
    return this.current;
  }

  private async quarantine(reason: string): Promise<void> {
    const backup = `${this.file}.bad-${Date.now()}`;
    this.log.warn('settings', 'settings file unusable, using defaults', { reason, backup });
    try {
      await rename(this.file, backup);
    } catch {
      // 留档失败就算了
    }
    this.current = defaultSettingsFile();
  }

  get ui(): UiSettings {
    return this.current.ui;
  }

  get window(): WindowState | undefined {
    return this.current.window;
  }

  onUiChanged(listener: (ui: UiSettings) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async updateUi(patch: UiSettingsPatch): Promise<UiSettings> {
    this.current = { ...this.current, ui: applyUiPatch(this.current.ui, patch) };
    const ui = this.current.ui;
    for (const listener of this.listeners) listener(ui);
    await this.persist();
    return ui;
  }

  get resources(): ResourceStackSettings {
    return this.current.resources;
  }

  async updateResources(next: ResourceStackSettings): Promise<void> {
    this.current = { ...this.current, resources: next };
    await this.persist();
  }

  /** 导出的应用级设置（输出文件夹、H.264 探测缓存） */
  get exportSettings(): ExportAppSettings {
    return this.current.export;
  }

  async updateExport(patch: Partial<ExportAppSettings>): Promise<void> {
    this.current = { ...this.current, export: { ...this.current.export, ...patch } };
    await this.persist();
  }

  async updateWindow(state: WindowState): Promise<void> {
    this.current = { ...this.current, window: state };
    await this.persist();
  }

  /** 串行写入：每次都写最新的完整快照 */
  private persist(): Promise<void> {
    const run = async () => {
      try {
        await writeJsonAtomic(this.file, this.current);
      } catch (error) {
        this.log.error('settings', 'failed to write settings', { error });
      }
    };
    this.queue = this.queue.then(run, run);
    return this.queue;
  }

  /** 等待所有已排队的写入完成 */
  flush(): Promise<void> {
    return this.queue;
  }
}
