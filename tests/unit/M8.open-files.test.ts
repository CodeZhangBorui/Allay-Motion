import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { filesFromArgv, filesFromOpenEvent, MAX_FILES_PER_LAUNCH, OPEN_COMMANDS, OpenFileQueue } from '../../apps/desktop/src/main/open-files';
import type { HostCommandOutcome } from '../../apps/desktop/src/shared/host-commands';
import { createLogger } from '../../apps/desktop/src/main/logger';

// M8 文件关联与第二实例参数：主进程这一侧（参数解析、排队、一次性令牌）。界面一侧和端到端在 tests/e2e/m8.spec.ts。

const log = createLogger(null, false);

describe('M8 文件关联：从进程参数里挑文件', () => {
  it('只认 .allay 和 .allaytpl，跳过可执行文件本身和开关，相对路径按启动目录解析', () => {
    const argv = [
      'C:\\Apps\\AllayMotion.exe',
      '--allow-file-access-from-files',
      'D:\\Videos\\intro.allay',
      'pack.ALLAYTPL',
      'D:\\Videos\\notes.txt',
      'out/main/index.js',
      '',
    ];
    expect(filesFromArgv(argv, 'D:\\Downloads')).toEqual([
      { kind: 'project', path: 'D:\\Videos\\intro.allay' },
      { kind: 'template', path: 'D:\\Downloads\\pack.ALLAYTPL' },
    ]);
  });
  it('第 0 项即使带关联的扩展名也不算；空参数表没有文件', () => {
    expect(filesFromArgv(['C:\\x.allay'], 'C:\\')).toEqual([]);
    expect(filesFromArgv([], 'C:\\')).toEqual([]);
  });
  it('带 NUL 或超长的参数忽略', () => {
    expect(filesFromArgv(['exe', 'C:\\a\0b.allay', `C:\\${'a'.repeat(5000)}.allay`], 'C:\\')).toEqual([]);
  });
});

describe('macOS 的 open-file 事件', () => {
  it('绝对路径、关联的扩展名才算；相对路径和别的扩展名忽略', () => {
    const project = resolve('/Users/x/Movies/intro.allay');
    const template = resolve('/Users/x/Downloads/pack.ALLAYTPL');
    expect(filesFromOpenEvent(project)).toEqual([{ kind: 'project', path: project }]);
    expect(filesFromOpenEvent(template)).toEqual([{ kind: 'template', path: template }]);
    expect(filesFromOpenEvent(resolve('/Users/x/notes.txt'))).toEqual([]);
    expect(filesFromOpenEvent('intro.allay')).toEqual([]);
    expect(filesFromOpenEvent(`${resolve('/a')}\0b.allay`)).toEqual([]);
  });
});

function fakeChannel() {
  const calls: { command: string; input: unknown }[] = [];
  let reply: (input: unknown) => HostCommandOutcome = () => ({ ok: true });
  return {
    calls,
    setReply(fn: (input: unknown) => HostCommandOutcome) {
      reply = fn;
    },
    run: (command: string, input: unknown) => {
      calls.push({ command, input });
      return Promise.resolve(reply(input));
    },
  };
}

const tick = () => new Promise((r) => setTimeout(r, 0));

describe('M8 文件关联：排队与一次性令牌', () => {
  it('界面就绪之前排队，就绪后按顺序经命令通道执行，参数只有令牌', async () => {
    const ch = fakeChannel();
    const q = new OpenFileQueue({ run: ch.run, log });
    q.enqueue([
      { kind: 'template', path: 'C:\\a.allaytpl' },
      { kind: 'project', path: 'C:\\b.allay' },
    ]);
    await tick();
    expect(ch.calls).toEqual([]);
    expect(q.pending).toBe(2);
    q.markReady();
    await tick();
    expect(ch.calls.map((c) => c.command)).toEqual([OPEN_COMMANDS.template, OPEN_COMMANDS.project]);
    for (const c of ch.calls) {
      expect(Object.keys(c.input as object)).toEqual(['token']);
      expect(JSON.stringify(c.input)).not.toContain('C:');
    }
    expect(q.pending).toBe(0);
  });

  it('令牌只能用一次、种类必须对上；命令结束后令牌作废', async () => {
    const ch = fakeChannel();
    const q = new OpenFileQueue({ run: ch.run, log });
    const taken: (string | null)[] = [];
    ch.setReply((input) => {
      const { token } = input as { token: string };
      taken.push(q.take(token, 'template'));
      taken.push(q.take(token, 'project'));
      taken.push(q.take(token, 'project'));
      return { ok: true };
    });
    q.markReady();
    q.enqueue([{ kind: 'project', path: 'C:\\b.allay' }]);
    await tick();
    expect(taken).toEqual([null, 'C:\\b.allay', null]);
    const { token } = ch.calls[0]!.input as { token: string };
    expect(q.take(token, 'project')).toBeNull();
    expect(q.take('00000000-0000-4000-8000-000000000000', 'project')).toBeNull();
  });

  it('界面没取令牌、命令失败：令牌照样作废，后面的请求继续', async () => {
    const ch = fakeChannel();
    const q = new OpenFileQueue({ run: ch.run, log });
    ch.setReply(() => ({ ok: false, error: 'timeout', message: 'x' }));
    q.markReady();
    q.enqueue([
      { kind: 'project', path: 'C:\\1.allay' },
      { kind: 'project', path: 'C:\\2.allay' },
    ]);
    await tick();
    await tick();
    expect(ch.calls).toHaveLength(2);
    for (const c of ch.calls) expect(q.take((c.input as { token: string }).token, 'project')).toBeNull();
  });

  it('页面重新加载期间（markNotReady）新来的请求等下一次就绪', async () => {
    const ch = fakeChannel();
    const q = new OpenFileQueue({ run: ch.run, log });
    q.markReady();
    q.markNotReady();
    q.enqueue([{ kind: 'project', path: 'C:\\x.allay' }]);
    await tick();
    expect(ch.calls).toHaveLength(0);
    q.markReady();
    await tick();
    expect(ch.calls).toHaveLength(1);
  });

  it(`一次最多 ${MAX_FILES_PER_LAUNCH} 个文件`, async () => {
    const ch = fakeChannel();
    const q = new OpenFileQueue({ run: ch.run, log });
    q.enqueue(Array.from({ length: MAX_FILES_PER_LAUNCH + 5 }, (_, i) => ({ kind: 'template' as const, path: `C:\\${i}.allaytpl` })));
    expect(q.pending).toBe(MAX_FILES_PER_LAUNCH);
  });
});
