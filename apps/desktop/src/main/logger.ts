import { appendFileSync, mkdirSync, renameSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';

// 主进程日志：只写本机应用数据目录下的 logs/（docs/09-compliance.md 9.10）。
// 同步追加，量很小；单个文件超过上限时轮转一次。

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const MAX_BYTES = 5 * 1024 * 1024;
const MAX_FIELD = 500;

export interface Logger {
  readonly file: string | null;
  debug(scope: string, message: string, data?: Record<string, unknown>): void;
  info(scope: string, message: string, data?: Record<string, unknown>): void;
  warn(scope: string, message: string, data?: Record<string, unknown>): void;
  error(scope: string, message: string, data?: Record<string, unknown>): void;
}

function clip(value: string): string {
  return value.length > MAX_FIELD ? `${value.slice(0, MAX_FIELD)}…` : value;
}

function serialize(data: Record<string, unknown> | undefined): string {
  if (!data) return '';
  try {
    return ` ${clip(JSON.stringify(data, (_k, v: unknown) => (v instanceof Error ? { name: v.name, message: v.message } : v)))}`;
  } catch {
    return ' {"unserializable":true}';
  }
}

export function formatLine(level: LogLevel, scope: string, message: string, data?: Record<string, unknown>, now = new Date()): string {
  return `${now.toISOString()} ${level.toUpperCase().padEnd(5)} [${scope}] ${clip(message)}${serialize(data)}\n`;
}

export function createLogger(logDir: string | null, echo = true): Logger {
  let file: string | null = null;
  if (logDir) {
    try {
      mkdirSync(logDir, { recursive: true });
      file = join(logDir, 'main.log');
    } catch {
      file = null;
    }
  }

  const write = (level: LogLevel, scope: string, message: string, data?: Record<string, unknown>) => {
    const line = formatLine(level, scope, message, data);
    if (echo) {
      (level === 'error' ? process.stderr : process.stdout).write(line);
    }
    if (!file) return;
    try {
      try {
        if (statSync(file).size > MAX_BYTES) {
          const old = `${file}.1`;
          rmSync(old, { force: true });
          renameSync(file, old);
        }
      } catch {
        // 文件还不存在
      }
      appendFileSync(file, line, 'utf8');
    } catch {
      // 日志写失败不能拖垮应用
    }
  };

  return {
    file,
    debug: (s, m, d) => write('debug', s, m, d),
    info: (s, m, d) => write('info', s, m, d),
    warn: (s, m, d) => write('warn', s, m, d),
    error: (s, m, d) => write('error', s, m, d),
  };
}
