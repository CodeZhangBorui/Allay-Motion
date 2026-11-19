// 用外部编辑器打开动画文档（docs/animation-editor.md 9.4；docs/decisions.md“动画编辑器的第二轮反馈”）。
//
// - 动画文档平时只在工程里。用户点“在外部编辑器中打开”时，主进程把它写成 userData/animations/<键>.json
//   （应用自己的数据目录，路径由主进程按键决定，渲染进程碰不到路径），然后打开它：
//   · system：shell.openPath(文件)。只会是 .json，绝不对 .js 调用（Windows 上可能交给 Windows Script Host 执行）；
//   · custom：用户在主进程的文件对话框里选的程序，参数数组启动（不经 shell、不拼命令行），只传这一个文件路径。
// - 监视这个文件：外部改了（内容和应用自己最后写的不同）就把新文本推给主窗口，主窗口走代码编辑的同一条路（命令、撤销）。
//   主窗口改了文档时 syncFile 把文件改成新文本（记下哈希，自己的写入不回推）。
// - 只在用户操作时启动外部程序；不联网；不放宽 1.6 的任何一条（第 6 条：路径来自主进程的对话框或应用自己的目录）。
import { spawn } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { watch, type FSWatcher } from 'node:fs';
import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { AnimationFileKeySchema, type AnimationFileChange, type CodeEditorKind, type EditorInfo, type OpenExternalResult } from '../shared/code-window';
import { MAX_ANIMATION_CHARS } from '../shared/animation/schema';
import type { Logger } from './logger';
import type { SettingsStore } from './settings-store';

const DEBOUNCE_MS = 150;

export interface ExternalEditorOptions {
  userDataDir: string;
  settings: SettingsStore;
  log: Logger;
  /** shell.openPath；返回错误信息（空串表示成功） */
  openPath(file: string): Promise<string>;
  /** 主进程的“选择程序”对话框；取消时为 null */
  pickProgram(): Promise<string | null>;
  /** 外部改了动画文件 */
  onFileChanged(change: AnimationFileChange): void;
  /** 测试替身：启动程序 */
  launch?(program: string, file: string): Promise<boolean>;
}

const sha = (text: string) => createHash('sha256').update(text).digest('hex');

function defaultLaunch(program: string, file: string): Promise<boolean> {
  return new Promise((resolve) => {
    try {
      const child = spawn(program, [file], { detached: true, stdio: 'ignore', shell: false, windowsHide: false });
      child.once('error', () => resolve(false));
      child.once('spawn', () => {
        child.unref();
        resolve(true);
      });
    } catch {
      resolve(false);
    }
  });
}

export class ExternalEditorService {
  private readonly dir: string;
  /** 键 → 应用自己最后写进文件的内容的哈希 */
  private readonly written = new Map<string, string>();
  private readonly watchers = new Map<string, FSWatcher>();
  private readonly timers = new Map<string, NodeJS.Timeout>();

  constructor(private readonly opts: ExternalEditorOptions) {
    this.dir = join(opts.userDataDir, 'animations');
  }

  info(): EditorInfo {
    const s = this.opts.settings.editorSettings;
    return { kind: s.kind, programName: s.program ? basename(s.program) : null };
  }

  async setKind(kind: CodeEditorKind): Promise<EditorInfo> {
    await this.opts.settings.updateEditor({ kind });
    return this.info();
  }

  /** 主进程的文件对话框里选程序；选了就把方式设成 custom */
  async chooseProgram(): Promise<EditorInfo & { canceled: boolean }> {
    const program = await this.opts.pickProgram();
    if (!program) return { ...this.info(), canceled: true };
    await this.opts.settings.updateEditor({ kind: 'custom', program });
    return { ...this.info(), canceled: false };
  }

  /** 文件路径：键已按 schema 校验过（user.<6 位十六进制>.animation），不会含路径分隔符 */
  fileOf(key: string): string {
    return join(this.dir, `${AnimationFileKeySchema.parse(key)}.json`);
  }

  /** 写文件、开始监视、用设置里的方式打开 */
  async openExternal(key: string, text: string): Promise<OpenExternalResult> {
    const { kind, program } = this.opts.settings.editorSettings;
    if (kind === 'custom' && !program) return { ok: false, error: 'no-program' };
    let file: string;
    try {
      file = await this.write(key, text);
      this.watchFile(key, file);
    } catch (error) {
      this.opts.log.warn('editor', 'could not write animation file', { error: String(error) });
      return { ok: false, error: 'io' };
    }
    if (kind === 'custom' && program) {
      const ok = await (this.opts.launch ?? defaultLaunch)(program, file);
      if (!ok) this.opts.log.warn('editor', 'could not launch external editor', { program: basename(program) });
      return ok ? { ok: true } : { ok: false, error: 'open-failed' };
    }
    // system（以及 builtin 时也允许“用系统默认程序打开”）
    const error = await this.opts.openPath(file);
    if (error) {
      this.opts.log.warn('editor', 'could not open animation file', { error });
      return { ok: false, error: 'open-failed' };
    }
    return { ok: true };
  }

  /** 主窗口改了文档：正在监视的文件跟着改（没在监视的不写） */
  async syncFile(key: string, text: string): Promise<void> {
    if (!this.watchers.has(key)) return;
    if (this.written.get(key) === sha(text)) return;
    await this.write(key, text);
  }

  close(): void {
    for (const w of this.watchers.values()) w.close();
    for (const t of this.timers.values()) clearTimeout(t);
    this.watchers.clear();
    this.timers.clear();
  }

  private async write(key: string, text: string): Promise<string> {
    const file = this.fileOf(key);
    await mkdir(this.dir, { recursive: true });
    const tmp = join(this.dir, `.${randomBytes(6).toString('hex')}.tmp`);
    try {
      await writeFile(tmp, text, 'utf8');
      this.written.set(key, sha(text));
      await rename(tmp, file);
    } catch (error) {
      await rm(tmp, { force: true });
      throw error;
    }
    return file;
  }

  private watchFile(key: string, file: string): void {
    if (this.watchers.has(key)) return;
    // 监视目录（编辑器的原子保存会换掉文件本身），只看这个文件名
    const name = basename(file);
    const w = watch(this.dir, { persistent: false }, (_type, filename) => {
      if (filename !== null && filename.toString() !== name) return;
      clearTimeout(this.timers.get(key));
      this.timers.set(key, setTimeout(() => void this.check(key, file), DEBOUNCE_MS));
    });
    w.on('error', (error) => this.opts.log.warn('editor', 'animation file watcher failed', { error: String(error) }));
    this.watchers.set(key, w);
  }

  private async check(key: string, file: string): Promise<void> {
    try {
      const info = await stat(file);
      if (info.size > MAX_ANIMATION_CHARS * 4) return;
      const text = await readFile(file, 'utf8');
      const h = sha(text);
      if (this.written.get(key) === h) return;
      this.written.set(key, h);
      this.opts.onFileChanged({ key, text });
    } catch {
      // 文件暂时不在（编辑器先删后写）：等下一个事件
    }
  }
}
