import { randomBytes } from 'node:crypto';
import { rm, stat, writeFile } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';
import type { FolderState } from '../shared/folders';

// 默认文件夹现在能不能用（docs/06-ui-design.md 6.11）。不依赖 Electron，单元测试直接用。

/** 文件夹现在能不能用：存在、是目录、能在里面建文件 */
export async function folderState(path: string | null): Promise<FolderState> {
  if (!path) return 'unset';
  if (!isAbsolute(path)) return 'missing';
  try {
    if (!(await stat(path)).isDirectory()) return 'missing';
  } catch {
    return 'missing';
  }
  // Windows 上目录的只读属性和 ACL 都不能靠 access(W_OK) 判断，直接试写一个空文件
  const probe = join(path, `.allay-write-test-${randomBytes(4).toString('hex')}`);
  try {
    await writeFile(probe, '', { flag: 'wx' });
  } catch {
    return 'readonly';
  }
  await rm(probe, { force: true }).catch(() => undefined);
  return 'ok';
}
