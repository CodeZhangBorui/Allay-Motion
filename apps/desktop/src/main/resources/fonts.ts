// 主进程里的字体：
// 1. unihex 提供器（1.20 起游戏里中日韩等字形的来源）：hex_file 是资源栈里的一个 zip（原版是 jar 里的 assets/minecraft/font/unifont.zip），
//    在内存里解开其中的 .hex，解析成定长字形表交给渲染进程（docs/03-assets.md 3.9，decisions.md“2026-11 反馈：原版动画还原与字体”）。
//    不往磁盘写任何东西，zip 的安全规则同 zip.ts：不安全的条目名整个拒绝，单个条目、条目数都有上限。
// 2. 内嵌的 GNU Unifont（随应用分发的 resources/fonts/unifont/ 里那一份 OTF）：第一次用到时读出来、还原成点阵字形表，之后一直留着
//    （docs/decisions.md“内嵌 Unifont 与两种字体模式”）。所有模板共用这一份，模板包里不带字体。
// 3. 用户导入的字体文件：复制进 userData/fonts/<sha256>.<扩展名>，字体族 ID 是 user:<sha256 前 32 位>。
//    渲染进程只拿到 ID；读文件时主进程按 ID 在这个目录里找，ID 的格式由正则限定，拼不出目录外的路径（01 1.6 第 6 条）。
import { createHash, randomUUID } from 'node:crypto';
import { copyFile, mkdir, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { basename, extname, join } from 'node:path';
import { isSafeRelativePath, parseBdf, parseUnifontOtfChunked, parseUnihex, type BitmapFontTables, type UnihexOverride, type UnihexTables } from '@allay/assets';
import yauzl, { type Entry, type ZipFile } from 'yauzl';
import { z } from 'zod';

/** unifont.zip 里的条目数、单个 .hex 的大小上限（原版的 .hex 约 3–10 MB） */
const MAX_HEX_ENTRIES = 64;
const MAX_HEX_BYTES = 32 * 1024 * 1024;
/** zip 本身的大小上限 */
export const MAX_UNIHEX_ZIP_BYTES = 64 * 1024 * 1024;

function openBuffer(buf: Buffer): Promise<ZipFile> {
  return new Promise((resolve, reject) => {
    yauzl.fromBuffer(buf, { lazyEntries: true, decodeStrings: true, validateEntrySizes: true, strictFileNames: true }, (err, zip) => (err || !zip ? reject(err ?? new Error('no zip')) : resolve(zip)));
  });
}

function readEntry(zip: ZipFile, entry: Entry, maxBytes: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    zip.openReadStream(entry, (err, stream) => {
      if (err || !stream) {
        reject(err ?? new Error('no stream'));
        return;
      }
      const chunks: Buffer[] = [];
      let total = 0;
      stream.on('data', (chunk: Buffer) => {
        total += chunk.length;
        if (total > maxBytes) {
          stream.destroy(new Error(`entry larger than ${maxBytes} bytes`));
          return;
        }
        chunks.push(chunk);
      });
      stream.on('error', reject);
      stream.on('end', () => resolve(Buffer.concat(chunks, total)));
    });
  });
}

/**
 * 解开内存里的 zip，按条目在中央目录里的顺序读出全部 .hex 的文本（游戏也是按顺序读、先出现的码位胜出）。
 * 条目名不安全时整个拒绝。
 */
export async function readHexEntries(zipBytes: Uint8Array): Promise<string[]> {
  if (zipBytes.byteLength > MAX_UNIHEX_ZIP_BYTES) throw new Error('unihex zip too large');
  const zip = await openBuffer(Buffer.from(zipBytes.buffer, zipBytes.byteOffset, zipBytes.byteLength));
  try {
    if (zip.entryCount > 10_000) throw new Error('too many entries');
    const texts: string[] = [];
    await new Promise<void>((resolve, reject) => {
      zip.on('error', reject);
      zip.on('end', () => resolve());
      zip.on('entry', (entry: Entry) => {
        const name = entry.fileName.endsWith('/') ? entry.fileName.slice(0, -1) : entry.fileName;
        if (!isSafeRelativePath(name)) {
          reject(new Error(`unsafe entry name: ${entry.fileName}`));
          return;
        }
        if (entry.fileName.endsWith('/') || !name.toLowerCase().endsWith('.hex') || texts.length >= MAX_HEX_ENTRIES || entry.uncompressedSize > MAX_HEX_BYTES || entry.isEncrypted()) {
          zip.readEntry();
          return;
        }
        readEntry(zip, entry, MAX_HEX_BYTES).then(
          (buf) => {
            texts.push(buf.toString('latin1'));
            zip.readEntry();
          },
          reject,
        );
      });
      zip.readEntry();
    });
    return texts;
  } finally {
    zip.close();
  }
}

/** 读资源栈里一个 unihex 提供器的字形表；read 按资源包路径从资源栈取文件 */
export async function loadUnihexTables(read: (path: string) => Promise<Uint8Array | null>, file: string, overrides: readonly UnihexOverride[]): Promise<UnihexTables | null> {
  const bytes = await read(file);
  if (!bytes) return null;
  return parseUnihex(await readHexEntries(bytes), overrides);
}

/** unihex 字形表的缓存：按（资源栈 stamp、文件、覆盖）记，栈一变就丢掉旧的 */
export class UnihexCache {
  private stamp = '';
  private readonly entries = new Map<string, Promise<UnihexTables | null>>();

  get(stamp: string, file: string, overrides: readonly UnihexOverride[], load: () => Promise<UnihexTables | null>): Promise<UnihexTables | null> {
    if (stamp !== this.stamp) {
      this.stamp = stamp;
      this.entries.clear();
    }
    const key = `${file}|${JSON.stringify(overrides)}`;
    let p = this.entries.get(key);
    if (!p) {
      p = load().catch(() => null);
      this.entries.set(key, p);
    }
    return p;
  }
}

// ---- 内嵌的 Unifont ----

/** 随应用分发的 Unifont 在资源目录里的位置（打包后是 process.resourcesPath 下，开发时是仓库的 resources/ 下） */
export const EMBEDDED_UNIFONT_FILE = ['fonts', 'unifont', 'unifont_t-18.0.01.otf'] as const;

/** 内嵌 Unifont 的字形表：第一次调用时读文件、分块解析（约 1.5 秒），之后都给同一份；读不了时为 null 并记日志 */
export class EmbeddedUnifont {
  private tables: Promise<UnihexTables | null> | null = null;

  constructor(
    private readonly file: string,
    private readonly log: (message: string, data?: Record<string, unknown>) => void,
  ) {}

  get(): Promise<UnihexTables | null> {
    this.tables ??= readFile(this.file).then(
      async (bytes) => {
        const t0 = performance.now();
        // 分块解析，块与块之间把事件循环让出去：主进程在这 1–2 秒里照常响应别的 IPC
        const t = await parseUnifontOtfChunked(new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength), () => new Promise<void>((r) => setImmediate(r)));
        this.log('embedded unifont loaded', { version: t.version, glyphs: t.codepoints.length, ms: Math.round(performance.now() - t0), bytes: t.bits.byteLength + t.metrics.byteLength + t.codepoints.byteLength + t.offsets.byteLength });
        return { ascent: t.ascent, descent: t.descent, codepoints: t.codepoints, metrics: t.metrics, offsets: t.offsets, bits: t.bits, oversample: t.oversample };
      },
      (error: unknown) => {
        this.log('embedded unifont unavailable', { error: error instanceof Error ? error.message : String(error) });
        return null;
      },
    );
    return this.tables;
  }
}

// ---- 用户导入的字体 ----

export const USER_FONTS_DIR = 'fonts';
/** 可导入的字体文件 */
export const USER_FONT_EXTENSIONS = ['.ttf', '.otf', '.woff', '.woff2', '.bdf'] as const;
export const MAX_USER_FONT_BYTES = 32 * 1024 * 1024;
export const USER_FONT_ID_RE = /^user:([0-9a-f]{32})$/;

export interface UserFontInfo {
  /** 字体族 ID：user:<sha256 前 32 位> */
  id: string;
  /** 导入时的文件名（不含目录），界面上显示 */
  name: string;
  format: 'ttf' | 'otf' | 'woff' | 'woff2' | 'bdf';
}

const IndexSchema = z.array(
  z.strictObject({
    id: z.string().regex(USER_FONT_ID_RE),
    name: z.string().min(1).max(200),
    format: z.enum(['ttf', 'otf', 'woff', 'woff2', 'bdf']),
  }),
);

/** 按文件头认格式，扩展名只用来挑选候选；认不出就拒绝 */
export function sniffFontFormat(head: Uint8Array, ext: string): UserFontInfo['format'] | null {
  const tag = String.fromCharCode(...head.subarray(0, 4));
  if (tag === 'wOFF') return 'woff';
  if (tag === 'wOF2') return 'woff2';
  if (tag === 'OTTO') return 'otf';
  if ((head[0] === 0 && head[1] === 1 && head[2] === 0 && head[3] === 0) || tag === 'true') return ext === '.otf' ? 'otf' : 'ttf';
  if (tag === 'STAR' && ext === '.bdf') return 'bdf';
  return null;
}

export type ImportFontResult = { ok: true; font: UserFontInfo } | { ok: false; error: 'unsupported' | 'too-large' | 'unreadable' };

export class UserFontStore {
  private readonly dir: string;
  private index: UserFontInfo[] | null = null;
  private readonly bdf = new Map<string, Promise<BitmapFontTables | null>>();

  constructor(userDataDir: string) {
    this.dir = join(userDataDir, USER_FONTS_DIR);
  }

  private fileOf(id: string, format: UserFontInfo['format']): string | null {
    const m = USER_FONT_ID_RE.exec(id);
    return m ? join(this.dir, `${m[1]}.${format}`) : null;
  }

  async list(): Promise<UserFontInfo[]> {
    if (this.index) return [...this.index];
    let parsed: UserFontInfo[];
    try {
      parsed = IndexSchema.parse(JSON.parse(await readFile(join(this.dir, 'index.json'), 'utf8')));
    } catch {
      parsed = [];
    }
    // 只留文件还在的
    const present = new Set(await readdir(this.dir).catch(() => [] as string[]));
    this.index = parsed.filter((f) => {
      const file = this.fileOf(f.id, f.format);
      return file !== null && present.has(basename(file));
    });
    return [...this.index];
  }

  private async saveIndex(list: UserFontInfo[]): Promise<void> {
    this.index = list;
    await mkdir(this.dir, { recursive: true });
    const tmp = join(this.dir, `index.${randomUUID()}.tmp`);
    await writeFile(tmp, JSON.stringify(list, null, 2));
    await rename(tmp, join(this.dir, 'index.json'));
  }

  /** 导入一个字体文件（路径来自主进程自己的对话框）：先复制成临时文件，对副本校验、算哈希，再改名 */
  async importFile(src: string): Promise<ImportFontResult> {
    const ext = extname(src).toLowerCase();
    if (!(USER_FONT_EXTENSIONS as readonly string[]).includes(ext)) return { ok: false, error: 'unsupported' };
    try {
      const st = await stat(src);
      if (!st.isFile()) return { ok: false, error: 'unreadable' };
      if (st.size > MAX_USER_FONT_BYTES) return { ok: false, error: 'too-large' };
    } catch {
      return { ok: false, error: 'unreadable' };
    }
    await mkdir(this.dir, { recursive: true });
    const tmp = join(this.dir, `import.${randomUUID()}.tmp`);
    try {
      await copyFile(src, tmp);
      const bytes = await readFile(tmp);
      if (bytes.byteLength > MAX_USER_FONT_BYTES) return { ok: false, error: 'too-large' };
      const format = sniffFontFormat(bytes.subarray(0, 4), ext);
      if (!format) return { ok: false, error: 'unsupported' };
      if (format === 'bdf') parseBdf(bytes.toString('utf8'));
      const id = `user:${createHash('sha256').update(bytes).digest('hex').slice(0, 32)}`;
      const file = this.fileOf(id, format)!;
      await rename(tmp, file);
      const font: UserFontInfo = { id, name: basename(src).slice(0, 200), format };
      const list = (await this.list()).filter((f) => f.id !== id);
      await this.saveIndex([...list, font]);
      return { ok: true, font };
    } catch {
      return { ok: false, error: 'unreadable' };
    } finally {
      await rm(tmp, { force: true }).catch(() => undefined);
    }
  }

  async remove(id: string): Promise<void> {
    const list = await this.list();
    const hit = list.find((f) => f.id === id);
    if (!hit) return;
    const file = this.fileOf(hit.id, hit.format);
    if (file) await rm(file, { force: true });
    this.bdf.delete(id);
    await this.saveIndex(list.filter((f) => f.id !== id));
  }

  /** 读一个已导入的字体：BDF 解析成字形表，矢量字体给原样字节；不认识的 ID 或文件丢了为 null */
  async read(id: string): Promise<{ kind: 'bdf'; tables: BitmapFontTables } | { kind: 'vector'; data: Uint8Array } | null> {
    if (!USER_FONT_ID_RE.test(id)) return null;
    const hit = (await this.list()).find((f) => f.id === id);
    if (!hit) return null;
    const file = this.fileOf(hit.id, hit.format);
    if (!file) return null;
    if (hit.format === 'bdf') {
      let p = this.bdf.get(id);
      if (!p) {
        p = readFile(file, 'utf8').then(
          (t) => parseBdf(t),
          () => null,
        );
        this.bdf.set(id, p);
      }
      const tables = await p;
      return tables ? { kind: 'bdf', tables } : null;
    }
    const data = await readFile(file).catch(() => null);
    return data && data.byteLength <= MAX_USER_FONT_BYTES ? { kind: 'vector', data: new Uint8Array(data.buffer, data.byteOffset, data.byteLength) } : null;
  }
}
