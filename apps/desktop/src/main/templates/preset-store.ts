// 预设的存取（docs/04-templates.md 4.7；01-product-architecture.md 1.9）：userData/presets/<id>.allaypreset。
// 每个文件是一个带 formatVersion 的 JSON，先写临时文件再改名。只存与默认值不同的参数（渲染进程按参数定义算好，
// 这里再按 schema 校验一次）。加载时的清洗（缺的补默认值、多的丢弃）在渲染进程按当前模板的参数定义做。
import { randomBytes } from 'node:crypto';
import { readdir, readFile, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { parsePreset, type Preset } from '@allay/template-sdk';
import type { PresetEntry, SavePresetRequest } from '../../shared/templates';
import type { Logger } from '../logger';
import { writeJsonAtomic } from '../settings-store';

export const PRESET_EXT = '.allaypreset';
const MAX_PRESET_BYTES = 1024 * 1024;

const entryOf = (id: string, p: Preset): PresetEntry => ({ id, name: p.name, template: p.template, params: p.params, createdAt: p.createdAt });

export class PresetStore {
  private readonly dir: string;

  constructor(
    userDataDir: string,
    private readonly log: Logger,
    private readonly now: () => Date = () => new Date(),
  ) {
    this.dir = join(userDataDir, 'presets');
  }

  async list(): Promise<PresetEntry[]> {
    const names = await readdir(this.dir).catch(() => [] as string[]);
    const out: PresetEntry[] = [];
    for (const name of names.sort()) {
      const id = name.endsWith(PRESET_EXT) ? name.slice(0, -PRESET_EXT.length) : '';
      if (!/^[0-9a-f]{32}$/.test(id)) continue;
      const result = await this.readFile(join(this.dir, name));
      if (result.ok) out.push(entryOf(id, result.preset));
      else this.log.warn('presets', 'skipped unreadable preset', { name, error: result.error });
    }
    return out.sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
  }

  async save(req: SavePresetRequest): Promise<PresetEntry> {
    const raw = { formatVersion: 1, template: req.template, name: req.name, params: req.params, createdAt: this.now().toISOString() };
    const parsed = parsePreset(raw);
    if (!parsed.ok) throw new Error(`invalid preset: ${parsed.error}`);
    return this.write(parsed.preset);
  }

  async remove(id: string): Promise<boolean> {
    const file = this.file(id);
    const exists = (await stat(file).catch(() => null))?.isFile() === true;
    await rm(file, { force: true });
    return exists;
  }

  /** 从任意路径（主进程对话框选的）导入：校验后存一份新的 */
  async importFrom(path: string): Promise<{ ok: true; entry: PresetEntry } | { ok: false; error: string }> {
    const result = await this.readFile(path);
    if (!result.ok) return result;
    return { ok: true, entry: await this.write(result.preset) };
  }

  /** 预设文件的内容（导出用）；不存在时为 null */
  async contents(id: string): Promise<string | null> {
    const result = await this.readFile(this.file(id));
    return result.ok ? `${JSON.stringify(result.preset, null, 2)}\n` : null;
  }

  private file(id: string): string {
    if (!/^[0-9a-f]{32}$/.test(id)) throw new Error('invalid preset id');
    return join(this.dir, `${id}${PRESET_EXT}`);
  }

  private async write(preset: Preset): Promise<PresetEntry> {
    const id = randomBytes(16).toString('hex');
    await writeJsonAtomic(this.file(id), preset);
    return entryOf(id, preset);
  }

  private async readFile(path: string): Promise<{ ok: true; preset: Preset } | { ok: false; error: string }> {
    const info = await stat(path).catch(() => null);
    if (!info?.isFile()) return { ok: false, error: 'not a file' };
    if (info.size > MAX_PRESET_BYTES) return { ok: false, error: 'file too large' };
    let json: unknown;
    try {
      json = JSON.parse(await readFile(path, 'utf8'));
    } catch {
      return { ok: false, error: 'not valid JSON' };
    }
    return parsePreset(json);
  }
}
