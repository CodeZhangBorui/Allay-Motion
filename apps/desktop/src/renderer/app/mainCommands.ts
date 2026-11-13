// 界面这一端的命令通道（docs/code-editing-and-mcp-plan.md H11；格式见 shared/host-commands.ts）：
// 主进程发来的请求先按 schema 校验，再经 dispatch 执行（和菜单、快捷键走同一个命令层，参数按命令自己的 schema 校验），
// 结果或失败原因交回主进程。write 命令的改动在撤销记录上标为来自主进程（H6）。
import { HostCommandRequestSchema, type HostCommandError, type HostCommandResult } from '../../shared/host-commands';
import { RevisionConflictError } from '../stores/projectStore';
import { CommandError, dispatch } from './registry';

function errorOf(error: unknown): { error: HostCommandError; message: string } {
  const message = (error instanceof Error ? error.message : String(error)).slice(0, 2000);
  if (error instanceof CommandError) return { error: error.code, message };
  if (error instanceof RevisionConflictError) return { error: 'conflict', message };
  return { error: 'failed', message };
}

/** 命令的返回值变成可以过 IPC 的 JSON（undefined 表示没有返回值） */
function toJson(value: unknown): unknown {
  return value === undefined ? undefined : (JSON.parse(JSON.stringify(value)) as unknown);
}

export async function handleHostCommand(raw: unknown): Promise<HostCommandResult | null> {
  const parsed = HostCommandRequestSchema.safeParse(raw);
  if (!parsed.success) {
    console.warn('[host-commands] malformed request ignored');
    // 连 requestId 都读不出来的请求没法回复；主进程那边会超时
    const id = typeof raw === 'object' && raw !== null && 'requestId' in raw ? (raw as { requestId: unknown }).requestId : null;
    return typeof id === 'string' && /^[0-9a-f-]{36}$/i.test(id) ? { requestId: id, ok: false, error: 'invalid-input', message: 'malformed request' } : null;
  }
  const { requestId, command, input } = parsed.data;
  try {
    const output = toJson(await dispatch(command, input, { source: 'main' }));
    return (output === undefined ? { requestId, ok: true } : { requestId, ok: true, output }) as HostCommandResult;
  } catch (error) {
    return { requestId, ok: false, ...errorOf(error) };
  }
}

let installed = false;

/** 启动时接上（core.tsx） */
export function installHostCommands(): void {
  if (installed) return;
  installed = true;
  window.allay.host.onCommand((request) => {
    void handleHostCommand(request).then((result) => {
      if (result) void window.allay.host.commandResult(result).catch((error: unknown) => console.warn('[host-commands] result rejected', error));
    });
  });
}
