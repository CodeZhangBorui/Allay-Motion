// 文件夹的只读索引：内置素材包和文件夹形式的资源包共用。
// 扫描时跳过符号链接（不跟着链接跑出目录）和超过上限的文件；读取只认索引里有的路径。
import { lstat, readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { isSafeRelativePath } from '@allay/assets';
import { MAX_ENTRIES, MAX_ENTRY_BYTES } from './zip';

export interface DirectoryIndex {
  readonly root: string;
  readonly files: ReadonlyMap<string, { abs: string; size: number; mtimeMs: number }>;
  readonly warnings: readonly string[];
  /** 文件数、最大修改时间、总大小拼成的版本标记 */
  readonly revision: string;
  has(path: string): boolean;
  read(path: string): Promise<Uint8Array | null>;
  list(prefix: string): string[];
}

export async function scanDirectory(root: string, maxEntryBytes = MAX_ENTRY_BYTES, maxEntries = MAX_ENTRIES): Promise<DirectoryIndex> {
  const files = new Map<string, { abs: string; size: number; mtimeMs: number }>();
  const warnings: string[] = [];
  let maxMtime = 0;
  let total = 0;
  const walk = async (dir: string, rel: string): Promise<void> => {
    const entries = await readdir(dir, { withFileTypes: true });
    entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    for (const e of entries) {
      const childRel = rel ? `${rel}/${e.name}` : e.name;
      const abs = join(dir, e.name);
      if (e.isSymbolicLink()) {
        warnings.push(`跳过符号链接：${childRel}`);
        continue;
      }
      if (!isSafeRelativePath(childRel)) {
        warnings.push(`跳过名字不合规的条目：${childRel}`);
        continue;
      }
      if (e.isDirectory()) {
        await walk(abs, childRel);
        continue;
      }
      if (!e.isFile()) continue;
      if (files.size >= maxEntries) throw new Error(`文件太多（超过 ${maxEntries} 个）：${root}`);
      const st = await lstat(abs);
      if (st.size > maxEntryBytes) {
        warnings.push(`跳过过大的文件（${st.size} 字节）：${childRel}`);
        continue;
      }
      files.set(childRel, { abs, size: st.size, mtimeMs: st.mtimeMs });
      maxMtime = Math.max(maxMtime, st.mtimeMs);
      total += st.size;
    }
  };
  await walk(root, '');
  const sorted = [...files.keys()].sort();
  return {
    root,
    files,
    warnings,
    revision: `${files.size}:${Math.round(maxMtime)}:${total}`,
    has: (path) => files.has(path),
    list: (prefix) => sorted.filter((p) => p.startsWith(prefix)),
    read: async (path) => {
      const f = files.get(path);
      if (!f) return null;
      // 扫描之后文件可能被换掉：读取前再确认一次不是链接、大小没超限
      const st = await lstat(f.abs).catch(() => null);
      if (!st || !st.isFile() || st.size > maxEntryBytes) return null;
      return new Uint8Array(await readFile(f.abs));
    },
  };
}
