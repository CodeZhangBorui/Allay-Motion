// 文件关联与第二实例参数（docs/01-product-architecture.md 1.5、docs/08-milestones.md M8）：
// 双击 .allay / .allaytpl（或把它们拖到 exe 上、命令行带上路径）时，路径出现在进程参数里；
// 应用已经开着时，新进程拿不到单实例锁就退出，参数经 second-instance 交给已有的进程。
//
// 路径只留在主进程（1.6 第 6 条）：每个文件换成一次性的令牌，经命令通道（H11）请界面执行
// project.openAssociated / templates.installAssociated，界面再拿令牌调 project.openRequested /
// templates.installRequested，由主进程按令牌找回路径去读。渲染进程从头到尾看不到路径，也造不出令牌。
// 界面准备好之前（host.ready 之前）来的请求排队，准备好后按顺序一个一个执行。
import { randomUUID } from 'node:crypto';
import { extname, isAbsolute, resolve } from 'node:path';
import type { HostCommandOutcome } from '../shared/host-commands';
import type { Logger } from './logger';

export type OpenFileKind = 'project' | 'template';

export interface OpenFileRequest {
  kind: OpenFileKind;
  path: string;
}

/** 关联的扩展名（不带点、小写）→ 种类 */
export const ASSOCIATED_EXTENSIONS: Readonly<Record<string, OpenFileKind>> = { allay: 'project', allaytpl: 'template' };

/** 每次启动（或每个第二实例）最多处理的文件数；多出来的忽略并记日志 */
export const MAX_FILES_PER_LAUNCH = 16;
/**
 * 一个文件的命令最多等这么久：打开工程前可能要问“放弃未保存的改动？”，等的是用户。
 * 超时之后令牌作废，用户再点“放弃”只会得到“文件不存在”，所以给得很宽
 */
export const OPEN_COMMAND_TIMEOUT_MS = 30 * 60_000;
/** 一条路径的长度上限（Windows 的长路径也在这之内） */
const MAX_PATH_CHARS = 4096;

/** 界面里对应的命令（hideInPalette，参数只有令牌） */
export const OPEN_COMMANDS: Readonly<Record<OpenFileKind, string>> = {
  project: 'project.openAssociated',
  template: 'templates.installAssociated',
};

/**
 * 从进程参数里挑出关联的文件。第 0 项是可执行文件；以 - 开头的是开关（Chromium 会往第二实例的参数里加一些）；
 * 相对路径按启动目录解析；只认关联的扩展名。是否存在、能不能读，交给真正打开时判断（读不到给“文件不存在”）。
 */
export function filesFromArgv(argv: readonly string[], cwd: string): OpenFileRequest[] {
  const out: OpenFileRequest[] = [];
  for (const arg of argv.slice(1)) {
    if (!arg || arg.startsWith('-') || arg.length > MAX_PATH_CHARS || arg.includes('\0')) continue;
    const kind = ASSOCIATED_EXTENSIONS[extname(arg).slice(1).toLowerCase()];
    if (!kind) continue;
    out.push({ kind, path: isAbsolute(arg) ? arg : resolve(cwd, arg) });
  }
  return out;
}

export class OpenFileQueue {
  private readonly queue: OpenFileRequest[] = [];
  private readonly tokens = new Map<string, OpenFileRequest>();
  private ready = false;
  private flushing = false;

  constructor(
    private readonly opts: {
      /** 经命令通道请界面执行命令（HostCommandChannel.run） */
      run(command: string, input: unknown, opts: { timeoutMs: number }): Promise<HostCommandOutcome>;
      log: Logger;
    },
  ) {}

  /** 来自启动参数或第二实例的文件 */
  enqueue(files: readonly OpenFileRequest[]): void {
    if (files.length === 0) return;
    if (files.length > MAX_FILES_PER_LAUNCH) this.opts.log.warn('open-files', 'too many files, extra ignored', { count: files.length });
    this.queue.push(...files.slice(0, MAX_FILES_PER_LAUNCH));
    this.opts.log.info('open-files', 'queued', { kinds: files.map((f) => f.kind), ready: this.ready });
    void this.flush();
  }

  /** 界面准备好了（host.ready）：开始执行排队的请求 */
  markReady(): void {
    this.ready = true;
    void this.flush();
  }

  /** 页面要重新加载或窗口关了：之后的请求等下一次 host.ready */
  markNotReady(): void {
    this.ready = false;
  }

  /** 界面拿令牌换回请求（一次性）；种类对不上、不认识、用过了都是 null */
  take(token: string, kind: OpenFileKind): string | null {
    const req = this.tokens.get(token);
    if (!req || req.kind !== kind) return null;
    this.tokens.delete(token);
    return req.path;
  }

  /** 测试用：还在排队的数量 */
  get pending(): number {
    return this.queue.length;
  }

  private async flush(): Promise<void> {
    if (this.flushing) return;
    this.flushing = true;
    try {
      while (this.ready && this.queue.length > 0) {
        const req = this.queue.shift()!;
        const token = randomUUID();
        this.tokens.set(token, req);
        const outcome = await this.opts.run(OPEN_COMMANDS[req.kind], { token }, { timeoutMs: OPEN_COMMAND_TIMEOUT_MS });
        // 命令结束后令牌作废（界面没来取也一样）
        this.tokens.delete(token);
        if (outcome.ok) this.opts.log.info('open-files', 'handled', { kind: req.kind });
        else this.opts.log.warn('open-files', 'not handled', { kind: req.kind, error: outcome.error, message: outcome.message });
      }
    } finally {
      this.flushing = false;
    }
  }
}
