import { z } from 'zod';

// folders 命名空间（docs/06-ui-design.md 6.11）：工程的默认保存文件夹、导出的输出文件夹。
// 渲染进程只传“哪一个”，从不传路径（1.6 第 6 条）；主进程回给它的路径只用于显示。

export const FOLDER_KINDS = ['project', 'export'] as const;
export const FolderKindSchema = z.enum(FOLDER_KINDS);
export type FolderKind = z.infer<typeof FolderKindSchema>;

/** unset：没设；ok：能用；missing：不存在或不是文件夹；readonly：不能在里面写文件 */
export type FolderState = 'unset' | 'ok' | 'missing' | 'readonly';

export interface FolderInfo {
  kind: FolderKind;
  path: string | null;
  state: FolderState;
}

export interface FoldersInfo {
  project: FolderInfo;
  export: FolderInfo;
}

export type FolderChooseResult = { canceled: true } | { ok: true; info: FolderInfo } | { ok: false; error: 'readonly' | 'missing' };
