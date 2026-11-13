// H11：主进程到界面的命令通道（docs/code-editing-and-mcp-plan.md H11）。两端都按 schema 校验：
// 主进程一侧（HostCommandChannel）只认自己发出去的 requestId、格式对的结果；界面一侧先校验请求，再经 dispatch 执行。
import { describe, expect, it, vi } from 'vitest';
import { HostCommandChannel } from '../../apps/desktop/src/main/host-commands';
import type { Logger } from '../../apps/desktop/src/main/logger';
import { handleHostCommand } from '../../apps/desktop/src/renderer/app/mainCommands';
import { registerCommand } from '../../apps/desktop/src/renderer/app/registry';
import { RevisionConflictError } from '../../apps/desktop/src/renderer/stores/projectStore';
import type { HostCommandRequest } from '../../apps/desktop/src/shared/host-commands';
import { z } from 'zod';

const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } as unknown as Logger;

describe('H11 主进程一侧', () => {
  it('发请求、收结果；不认识的 requestId 和畸形结果被忽略', async () => {
    const sent: HostCommandRequest[] = [];
    const ch = new HostCommandChannel({ send: (r) => (sent.push(r), true), log });
    const p = ch.run('project.get');
    expect(sent).toHaveLength(1);
    const { requestId } = sent[0]!;
    expect(ch.receive({ requestId: '3f2504e0-4f89-41d3-9a0c-0305e82c3301', ok: true })).toBe(false);
    expect(ch.receive({ requestId, ok: true, output: { a: 1 }, extra: 1 })).toBe(false);
    expect(ch.receive({ requestId, ok: false, error: 'nope', message: 'x' })).toBe(false);
    expect(ch.receive({ requestId, ok: true, output: { revision: 3 } })).toBe(true);
    await expect(p).resolves.toEqual({ ok: true, output: { revision: 3 } });
    // 同一个 requestId 只收一次
    expect(ch.receive({ requestId, ok: true })).toBe(false);
  });

  it('没有窗口、超时、窗口关闭、命令 id 不合格式：明确的失败，不抛错', async () => {
    await expect(new HostCommandChannel({ send: () => false, log }).run('x')).resolves.toMatchObject({ ok: false, error: 'no-window' });
    await expect(new HostCommandChannel({ send: () => true, log, timeoutMs: 20 }).run('x')).resolves.toMatchObject({ ok: false, error: 'timeout' });
    const ch = new HostCommandChannel({ send: () => true, log });
    const p = ch.run('x');
    ch.cancelAll();
    await expect(p).resolves.toMatchObject({ ok: false, error: 'no-window' });
    await expect(ch.run('bad id; rm -rf')).resolves.toMatchObject({ ok: false, error: 'unknown-command' });
  });
});

describe('H11 界面一侧', () => {
  const requestId = '3f2504e0-4f89-41d3-9a0c-0305e82c3301';

  it('经 dispatch 执行：参数按命令的 schema 校验，返回值、各种失败都按约定的格式交回', async () => {
    const off = [
      registerCommand({ id: 'hc.add', titleKey: 'x', effect: 'read', input: z.strictObject({ a: z.number(), b: z.number() }), output: z.number(), run: ({ a, b }) => a + b }),
      registerCommand({ id: 'hc.void', titleKey: 'x', effect: 'read', run: () => undefined }),
      registerCommand({ id: 'hc.off', titleKey: 'x', effect: 'read', enabled: () => false, run: () => undefined }),
      registerCommand({ id: 'hc.conflict', titleKey: 'x', effect: 'write', run: () => { throw new RevisionConflictError(1, 2); } }),
      registerCommand({ id: 'hc.boom', titleKey: 'x', effect: 'read', run: () => { throw new Error('boom'); } }),
    ];
    try {
      expect(await handleHostCommand({ requestId, command: 'hc.add', input: { a: 1, b: 2 } })).toEqual({ requestId, ok: true, output: 3 });
      expect(await handleHostCommand({ requestId, command: 'hc.void' })).toEqual({ requestId, ok: true });
      expect(await handleHostCommand({ requestId, command: 'hc.add', input: { a: '1' } })).toMatchObject({ ok: false, error: 'invalid-input' });
      expect(await handleHostCommand({ requestId, command: 'hc.off' })).toMatchObject({ ok: false, error: 'disabled' });
      expect(await handleHostCommand({ requestId, command: 'nope' })).toMatchObject({ ok: false, error: 'unknown-command' });
      expect(await handleHostCommand({ requestId, command: 'hc.conflict' })).toMatchObject({ ok: false, error: 'conflict' });
      expect(await handleHostCommand({ requestId, command: 'hc.boom' })).toMatchObject({ ok: false, error: 'failed', message: 'boom' });
      // 畸形请求：读得出 requestId 的回一个 invalid-input，读不出的不回
      expect(await handleHostCommand({ requestId, command: 'hc add' })).toMatchObject({ ok: false, error: 'invalid-input' });
      expect(await handleHostCommand({ command: 'hc.void' })).toBeNull();
      expect(await handleHostCommand('hc.void')).toBeNull();
    } finally {
      for (const f of off) f();
    }
  });
});
