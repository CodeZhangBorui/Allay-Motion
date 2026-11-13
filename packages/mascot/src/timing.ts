// 加载编排的时序（docs/07-allay-mascot.md 7.4 AllayLoader、7.6 A、T-ALY-2）。纯逻辑，时钟可注入，单元测试用假时钟。
//
//   idle ──加载开始──▶ waiting ──满 delay 仍在加载──▶ shown ──加载结束──▶ holding ──显示满 minVisible──▶ exiting ──exitMs──▶ idle
//                         └──不到 delay 就结束──▶ idle（悦灵和骨架都不出现）
//
// - shown 之后加载结束，但显示还不满 minVisible：holding，继续显示骨架和悦灵；满了立即开始退场。
// - 显示已满 minVisible 时加载结束：直接 exiting。退场 exitMs（260 ms）后回到 idle。
// - holding 或 exiting 时又开始加载：回到 shown（不重新等 delay）。

export type LoaderPhase = 'idle' | 'waiting' | 'shown' | 'holding' | 'exiting';

export const LOADER_DELAY = 180;
export const LOADER_MIN_VISIBLE = 500;
/** 退场：悦灵 260 ms 从较近的一侧加速飞出 */
export const LOADER_EXIT_MS = 260;
/** 减少动效时只有 120 ms 的透明度渐变 */
export const LOADER_EXIT_REDUCED_MS = 120;

export interface Clock {
  now(): number;
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

export const realClock: Clock = {
  now: () => performance.now(),
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
};

export interface LoaderTimingOptions {
  delay?: number;
  minVisible?: number;
  exitMs?: number;
}

export class LoaderTimeline {
  phase: LoaderPhase = 'idle';
  /** 进入 shown 的时刻 */
  shownAt = 0;
  private timer: unknown = null;
  private readonly delay: number;
  private readonly minVisible: number;
  private exitMs: number;

  constructor(
    private readonly onPhase: (phase: LoaderPhase) => void,
    options: LoaderTimingOptions = {},
    private readonly clock: Clock = realClock,
  ) {
    this.delay = options.delay ?? LOADER_DELAY;
    this.minVisible = options.minVisible ?? LOADER_MIN_VISIBLE;
    this.exitMs = options.exitMs ?? LOADER_EXIT_MS;
  }

  setExitMs(ms: number): void {
    this.exitMs = ms;
  }

  /** 外部的加载状态变了 */
  setLoading(loading: boolean): void {
    if (loading) {
      if (this.phase === 'idle') {
        this.go('waiting');
        this.later(this.delay, () => {
          this.shownAt = this.clock.now();
          this.go('shown');
        });
      } else if (this.phase === 'holding' || this.phase === 'exiting') {
        this.clear();
        this.go('shown');
      }
      return;
    }
    if (this.phase === 'waiting') {
      this.clear();
      this.go('idle');
    } else if (this.phase === 'shown') {
      const left = this.shownAt + this.minVisible - this.clock.now();
      if (left > 0) {
        this.go('holding');
        this.later(left, () => this.exit());
      } else this.exit();
    }
  }

  dispose(): void {
    this.clear();
  }

  private exit(): void {
    this.go('exiting');
    this.later(this.exitMs, () => this.go('idle'));
  }

  private later(ms: number, fn: () => void): void {
    this.clear();
    this.timer = this.clock.setTimeout(() => {
      this.timer = null;
      fn();
    }, ms);
  }

  private clear(): void {
    if (this.timer !== null) this.clock.clearTimeout(this.timer);
    this.timer = null;
  }

  private go(phase: LoaderPhase): void {
    if (this.phase === phase) return;
    this.phase = phase;
    this.onPhase(phase);
  }
}
