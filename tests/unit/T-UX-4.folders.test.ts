import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { folderState } from '../../apps/desktop/src/main/folder-state';
import { IPC_ARGS } from '../../apps/desktop/src/shared/ipc-contract';

// T-UX-4 默认文件夹：能不能用的判断，以及 IPC 只收“哪一个”、不收路径（docs/06-ui-design.md 6.11、1.6 第 6 条）

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'allay-ux-folders-'));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe('T-UX-4 默认文件夹', () => {
  it('没设、能用、不存在、不是文件夹、相对路径', async () => {
    expect(await folderState(null)).toBe('unset');
    expect(await folderState(dir)).toBe('ok');
    // 试写的临时文件不留下
    expect(readdirSync(dir)).toEqual([]);
    expect(await folderState(join(dir, 'gone'))).toBe('missing');
    const file = join(dir, 'file.txt');
    writeFileSync(file, 'x');
    expect(await folderState(file)).toBe('missing');
    expect(await folderState('relative/dir')).toBe('missing');
    mkdirSync(join(dir, 'sub'));
    expect(await folderState(join(dir, 'sub'))).toBe('ok');
  });

  it('folders 的 IPC：只接受 project / export，不接受路径或多余参数', () => {
    expect(IPC_ARGS['folders:get'].safeParse([]).success).toBe(true);
    expect(IPC_ARGS['folders:choose'].safeParse(['project']).success).toBe(true);
    expect(IPC_ARGS['folders:choose'].safeParse(['export']).success).toBe(true);
    expect(IPC_ARGS['folders:choose'].safeParse(['C:\\Windows']).success).toBe(false);
    expect(IPC_ARGS['folders:choose'].safeParse(['project', 'C:\\x']).success).toBe(false);
    expect(IPC_ARGS['folders:reset'].safeParse([]).success).toBe(false);
    expect(IPC_ARGS['folders:reset'].safeParse(['templates']).success).toBe(false);
  });
});
