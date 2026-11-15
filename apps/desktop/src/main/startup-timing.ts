// 启动的时间线（T-ARC-7：启动画面 0.5 秒内出现，3 秒内主界面可交互）。
// 时间都从主进程启动算起（performance.timeOrigin，Node 在进程启动时取的时间），只写进本机日志（9.10）。
// 打包后的应用也记：冷启动只能在打包后的应用上量，而它不认任何测试开关。
import type { Logger } from './logger';

export type StartupMark =
  | 'main-loaded'
  | 'app-ready'
  | 'settings-loaded'
  | 'splash-created'
  | 'splash-shown'
  | 'window-created'
  | 'window-shown'
  | 'renderer-ready';

class StartupTimeline {
  private readonly marks = new Map<StartupMark, number>();
  private log: Logger | null = null;

  attach(log: Logger): void {
    this.log = log;
    log.info('startup', 'process started', { at: new Date(performance.timeOrigin).toISOString() });
    for (const [name, ms] of this.marks) log.info('startup', name, { ms });
  }

  /** 只记第一次 */
  mark(name: StartupMark): void {
    if (this.marks.has(name)) return;
    const ms = Math.round(performance.now());
    this.marks.set(name, ms);
    this.log?.info('startup', name, { ms });
  }

  get(name: StartupMark): number | undefined {
    return this.marks.get(name);
  }
}

export const startup = new StartupTimeline();
