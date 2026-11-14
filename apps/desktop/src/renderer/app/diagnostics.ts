// 诊断信息与未捕获错误的记录（docs/decisions.md “试用版的三个崩溃”）。
// - 错误边界和预览的错误卡片“复制诊断信息”时用 buildDiagnostics 拼一份 JSON（不含路径之外的个人信息；工程路径本来就不在渲染进程）。
// - 未捕获的异常和 Promise 拒绝经 console.error 打出：主进程把渲染进程的 error 级控制台消息写进 logs/main.log（window.ts）。

export interface ErrorInfoLike {
  name: string;
  message: string;
  stack?: string;
}

/** 任何抛出来的东西都变成 { name, message, stack } */
export function errorInfo(error: unknown): ErrorInfoLike {
  if (error instanceof Error) return { name: error.name, message: error.message, ...(error.stack ? { stack: error.stack } : {}) };
  if (typeof error === 'object' && error !== null && 'message' in error) {
    const e = error as { name?: unknown; message?: unknown; stack?: unknown };
    return { name: typeof e.name === 'string' ? e.name : 'Error', message: String(e.message), ...(typeof e.stack === 'string' ? { stack: e.stack } : {}) };
  }
  return { name: 'Error', message: typeof error === 'string' ? error : JSON.stringify(error) ?? String(error) };
}

const MAX_TEXT = 8000;
const clip = (s: string | undefined) => (s === undefined ? undefined : s.length > MAX_TEXT ? `${s.slice(0, MAX_TEXT)}…` : s);

/** 诊断信息：哪一块出错、错误本身、组件栈，以及调用方给的现场（模板、预览状态等） */
export function buildDiagnostics(input: { scope: string; error: unknown; componentStack?: string | null; context?: Record<string, unknown>; now?: Date; userAgent?: string }): string {
  const e = errorInfo(input.error);
  const info = {
    scope: input.scope,
    error: { name: e.name, message: clip(e.message), stack: clip(e.stack) },
    componentStack: clip(input.componentStack ?? undefined) ?? null,
    ...(input.context ?? {}),
    userAgent: input.userAgent ?? (typeof navigator === 'undefined' ? null : navigator.userAgent),
    time: (input.now ?? new Date()).toISOString(),
  };
  return JSON.stringify(info, null, 2);
}

/** 一行日志：前缀便于在 main.log 里找；栈只取前几行 */
export function uncaughtLine(kind: 'uncaught' | 'unhandled-rejection' | 'render-error', scope: string | null, error: unknown): string {
  const e = errorInfo(error);
  const stack = (e.stack ?? '').split('\n').slice(1, 6).map((l) => l.trim()).join(' ← ');
  return `[${kind}]${scope ? ` [${scope}]` : ''} ${e.name}: ${e.message}${stack ? ` @ ${stack}` : ''}`;
}

let installed = false;

/** 未捕获的异常和 Promise 拒绝写进日志（经 console.error → 主进程）；只装一次 */
export function installGlobalErrorLogging(target: Pick<Window, 'addEventListener'> = window): void {
  if (installed) return;
  installed = true;
  target.addEventListener('error', (event: Event) => {
    const e = event as ErrorEvent;
    // 资源加载失败也走 error 事件，但不是脚本异常
    if (!(e.error instanceof Error) && !e.message) return;
    console.error(uncaughtLine('uncaught', null, e.error ?? e.message));
  });
  target.addEventListener('unhandledrejection', (event: Event) => {
    console.error(uncaughtLine('unhandled-rejection', null, (event as PromiseRejectionEvent).reason));
  });
}

/** “复制诊断信息”：Electron 拒绝一切权限请求（1.6 第 4 条），不用异步剪贴板 API，用一次性的选区复制 */
export function copyText(text: string): boolean {
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.setAttribute('readonly', '');
  ta.style.position = 'fixed';
  ta.style.opacity = '0';
  document.body.appendChild(ta);
  ta.select();
  const ok = document.execCommand('copy');
  ta.remove();
  return ok;
}
