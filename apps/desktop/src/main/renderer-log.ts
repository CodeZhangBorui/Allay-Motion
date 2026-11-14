// 渲染进程错误写日志的限流（window.ts 用）：一个循环里的错误不能把 logs/main.log 写满。
/** 每分钟最多记 RENDERER_ERRORS_PER_MINUTE 条渲染进程错误；超出的第一条换成一句提示，其余丢掉 */
export const RENDERER_ERRORS_PER_MINUTE = 60;

export function rendererErrorLimiter(limit = RENDERER_ERRORS_PER_MINUTE): (now: number) => 'log' | 'notice' | 'drop' {
  let windowStart = -Infinity;
  let count = 0;
  return (now) => {
    if (now - windowStart >= 60_000) {
      windowStart = now;
      count = 0;
    }
    count++;
    if (count <= limit) return 'log';
    return count === limit + 1 ? 'notice' : 'drop';
  };
}
