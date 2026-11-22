// 缩略图的磁盘缓存（docs/03-assets.md 3.10、01-product-architecture.md 1.9 的 cache/thumbs/）。
// 按 resourceStamp 分目录：cache/thumbs/<stamp>/<键>.png。写入新 stamp 时删掉旧 stamp 的目录（资源栈一变就失效）。
// 键和 stamp 都已由 IPC 的 schema 校验过（只含安全字符），这里再确认一次路径落在缓存目录里。
// 总量有上限（MAX_CACHE_BYTES）：写入后超过就按最近用到的先后删掉最久没用的，删到上限的 80%。“最近用到”记在文件的修改时间上
// （读到一次就更新），重启后照样认得出（docs/decisions.md“模板库撑到一百个模板”）。单个文件的上限在 IPC 的 schema 里（MAX_THUMB_BYTES）。
import { randomBytes } from 'node:crypto';
import { mkdir, readdir, readFile, rename, rm, stat, utimes, writeFile } from 'node:fs/promises';
import { join, relative, resolve, sep } from 'node:path';
import { readPngHeader } from '@allay/assets';
import type { CacheUsage } from '../shared/resources';

/**
 * 缓存目录的总量上限。依据（docs/decisions.md“模板库撑到一百个模板”里有量出来的数）：一百个模板用 26.2 的原版贴图，
 * 封面全部生成约 1.1 MB，悬停预览全部生成约 37 MB（一张平均 0.4 MB、最大约 1 MB），一共约 40 MB；两种界面语言各一份约 80 MB。
 * 128 MB 放得下这些再留一些给高清资源包（画面细、PNG 大）；平时碰不到，真的超了，删掉的是最久没看的，下次看到时再生成。
 */
export const MAX_CACHE_BYTES = 128 * 1024 * 1024;
/** 超过上限时删到这个比例：不在上限附近每写一张就删一张 */
const LOW_WATER = 0.8;

interface IndexEntry {
  bytes: number;
  /** 最近用到（写入或读到）的时刻，毫秒 */
  used: number;
}

export class ThumbCache {
  private readonly root: string;
  /** 当前 stamp 目录里的文件（文件名 → 大小、最近用到），第一次写入时扫一遍目录 */
  private index: { stamp: string; files: Map<string, IndexEntry>; total: number } | null = null;
  /** 写入、淘汰串行（读不用排队：写入是先写临时文件再改名） */
  private queue: Promise<unknown> = Promise.resolve();

  constructor(
    userDataDir: string,
    private readonly limit = MAX_CACHE_BYTES,
    private readonly now: () => number = Date.now,
  ) {
    this.root = resolve(userDataDir, 'cache', 'thumbs');
  }

  get dir(): string {
    return this.root;
  }

  private file(stamp: string, key: string): string {
    const f = resolve(this.root, stamp, `${key}.png`);
    const rel = relative(this.root, f);
    if (rel.startsWith('..') || rel.split(sep).length !== 2) throw new Error('thumbnail path escapes the cache');
    return f;
  }

  async get(stamp: string, key: string): Promise<Uint8Array | null> {
    let data: Uint8Array;
    try {
      data = new Uint8Array(await readFile(this.file(stamp, key)));
    } catch {
      return null;
    }
    this.touch(stamp, key);
    return data;
  }

  /** 读到一次：记成最近用到（内存里的索引和文件的修改时间） */
  private touch(stamp: string, key: string): void {
    const at = this.now();
    const entry = this.index?.stamp === stamp ? this.index.files.get(`${key}.png`) : undefined;
    if (entry) entry.used = at;
    const time = new Date(at);
    void utimes(this.file(stamp, key), time, time).catch(() => undefined);
  }

  put(stamp: string, key: string, png: Uint8Array): Promise<boolean> {
    if (!readPngHeader(png)) return Promise.resolve(false);
    const run = this.queue.then(() => this.write(stamp, key, png));
    this.queue = run.catch(() => undefined);
    return run;
  }

  private async write(stamp: string, key: string, png: Uint8Array): Promise<boolean> {
    const dir = join(this.root, stamp);
    await mkdir(dir, { recursive: true });
    await this.prune(stamp);
    const index = await this.loadIndex(stamp);
    const target = this.file(stamp, key);
    const tmp = join(dir, `.${randomBytes(6).toString('hex')}.tmp`);
    try {
      await writeFile(tmp, png);
      await rename(tmp, target);
    } catch (error) {
      await rm(tmp, { force: true });
      throw error;
    }
    const name = `${key}.png`;
    const old = index.files.get(name);
    if (old) index.total -= old.bytes;
    index.files.set(name, { bytes: png.byteLength, used: this.now() });
    index.total += png.byteLength;
    if (index.total > this.limit) await this.evict(index, name);
    return true;
  }

  /** 按最近用到的先后，从最久没用的删起，删到上限的 LOW_WATER；刚写入的那个不删 */
  private async evict(index: NonNullable<ThumbCache['index']>, keep: string): Promise<void> {
    const goal = this.limit * LOW_WATER;
    const order = [...index.files.entries()].filter(([name]) => name !== keep).sort((a, b) => a[1].used - b[1].used);
    for (const [name, entry] of order) {
      if (index.total <= goal) break;
      // 删不掉的（被占用、没有权限）留在账上，接着删下一个
      const removed = await rm(join(this.root, index.stamp, name), { force: true }).then(
        () => true,
        () => false,
      );
      if (!removed) continue;
      index.files.delete(name);
      index.total -= entry.bytes;
    }
  }

  /** 当前 stamp 目录的索引；换了 stamp 就重扫（顺手删掉上次异常退出留下的临时文件） */
  private async loadIndex(stamp: string): Promise<NonNullable<ThumbCache['index']>> {
    if (this.index?.stamp === stamp) return this.index;
    const dir = join(this.root, stamp);
    const files = new Map<string, IndexEntry>();
    let total = 0;
    for (const d of await readdir(dir, { withFileTypes: true }).catch(() => [])) {
      if (!d.isFile()) continue;
      if (d.name.endsWith('.tmp')) {
        await rm(join(dir, d.name), { force: true }).catch(() => undefined);
        continue;
      }
      if (!d.name.endsWith('.png')) continue;
      const info = await stat(join(dir, d.name)).catch(() => null);
      if (!info) continue;
      files.set(d.name, { bytes: info.size, used: info.mtimeMs });
      total += info.size;
    }
    this.index = { stamp, files, total };
    return this.index;
  }

  /** 只留当前 stamp 的目录 */
  private async prune(keep: string): Promise<void> {
    const entries = await readdir(this.root, { withFileTypes: true }).catch(() => []);
    for (const e of entries) if (e.name !== keep) await rm(join(this.root, e.name), { recursive: true, force: true }).catch(() => undefined);
  }

  clear(): Promise<void> {
    const run = this.queue.then(async () => {
      this.index = null;
      await rm(this.root, { recursive: true, force: true });
    });
    this.queue = run.catch(() => undefined);
    return run;
  }

  async usage(): Promise<CacheUsage> {
    let files = 0;
    let bytes = 0;
    const walk = async (dir: string): Promise<void> => {
      for (const e of await readdir(dir, { withFileTypes: true }).catch(() => [])) {
        const p = join(dir, e.name);
        if (e.isDirectory()) await walk(p);
        else if (e.isFile()) {
          files++;
          bytes += (await stat(p).catch(() => ({ size: 0 }))).size;
        }
      }
    };
    await walk(this.root);
    return { files, bytes, limit: this.limit };
  }
}
