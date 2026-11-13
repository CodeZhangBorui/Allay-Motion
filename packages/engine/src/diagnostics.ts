// 引擎产生的结构化诊断（docs/code-editing-and-mcp-plan.md H5）。
// 模板没有转译：Blob 模块里的行列就是模板源码的行列（1:1）。位置从 error.stack 里取，
// 只认装载这个模板时用的那个 Blob URL 的栈帧；取不到时不带位置，不编造。
import { clipDiagnosticMessage, type DiagnosticKind, type TemplateDiagnostic } from '@allay/template-sdk';

export interface SourceLocation {
  line: number;
  column: number;
}

/**
 * 在 V8 的调用栈文字里找第一个（最内层）属于 moduleUrl 的栈帧，返回它的行列（都从 1 开始）。
 * 栈帧形如 `at Object.update (blob:app://x/uuid:12:7)` 或 `at blob:app://x/uuid:3:9`。
 */
export function locateInStack(stack: unknown, moduleUrl: string | null): SourceLocation | null {
  if (typeof stack !== 'string' || !moduleUrl) return null;
  let from = 0;
  for (;;) {
    const at = stack.indexOf(moduleUrl, from);
    if (at < 0) return null;
    from = at + moduleUrl.length;
    const m = /^:(\d+):(\d+)/.exec(stack.slice(from, from + 24));
    if (!m) continue;
    const line = Number(m[1]);
    const column = Number(m[2]);
    if (line >= 1 && column >= 1) return { line, column };
  }
}

/** 抛出的东西 → 给人看的一行字 */
export function describeThrown(value: unknown): string {
  if (value instanceof Error) return `${value.name}: ${value.message}`;
  try {
    return `thrown value: ${String(value)}`;
  } catch {
    return 'thrown value (not printable)';
  }
}

type SimpleKind = Exclude<DiagnosticKind, 'watchdog'>;

/** 由抛出的错误生成诊断；位置从它的调用栈里找 */
export function diagnosticFromError(
  kind: SimpleKind,
  code: string,
  error: unknown,
  moduleUrl: string | null,
  extra: { t?: number; message?: string } = {},
): TemplateDiagnostic {
  const loc = locateInStack(error instanceof Error ? error.stack : undefined, moduleUrl);
  const message = clipDiagnosticMessage(extra.message ?? describeThrown(error));
  const base = { severity: 'error' as const, code, message, ...(loc ? { line: loc.line, column: loc.column } : {}) };
  if ((kind === 'update' || kind === 'determinism') && extra.t !== undefined && Number.isFinite(extra.t)) return { kind, ...base, t: extra.t };
  return { kind, ...base };
}
