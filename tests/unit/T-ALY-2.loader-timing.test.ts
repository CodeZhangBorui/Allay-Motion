import { describe, expect, it } from 'vitest';
import { LoaderTimeline, type Clock, type LoaderPhase } from '../../packages/mascot/src/timing';

// T-ALY-2（docs/07-allay-mascot.md 7.10）的时序逻辑：分别模拟 100 ms、300 ms、3 s 的加载。
// 判定：100 ms 时悦灵和骨架都不出现；300 ms 时出现并至少停留 500 ms；就绪后（且已显示满 500 ms）300 ms 内退场完毕。
// 这里用假时钟测纯逻辑；e2e（tests/e2e/m4.spec.ts）在真实界面里再量一遍 DOM。

class FakeClock implements Clock {
  t = 0;
  private timers: { at: number; fn: () => void; id: number }[] = [];
  private seq = 0;
  now(): number {
    return this.t;
  }
  setTimeout(fn: () => void, ms: number): unknown {
    const id = ++this.seq;
    this.timers.push({ at: this.t + ms, fn, id });
    return id;
  }
  clearTimeout(h: unknown): void {
    this.timers = this.timers.filter((x) => x.id !== h);
  }
  advanceTo(target: number): void {
    for (;;) {
      this.timers.sort((a, b) => a.at - b.at);
      const next = this.timers[0];
      if (!next || next.at > target) break;
      this.timers.shift();
      this.t = next.at;
      next.fn();
    }
    this.t = target;
  }
}

function simulate(loadMs: number) {
  const clock = new FakeClock();
  const log: { t: number; phase: LoaderPhase }[] = [];
  const tl = new LoaderTimeline((phase) => log.push({ t: clock.t, phase }), {}, clock);
  tl.setLoading(true);
  clock.advanceTo(loadMs);
  tl.setLoading(false);
  clock.advanceTo(loadMs + 5000);
  const at = (p: LoaderPhase) => log.find((e) => e.phase === p)?.t;
  return { log, shown: at('shown'), exiting: at('exiting'), idle: log.filter((e) => e.phase === 'idle').at(-1)?.t };
}

describe('T-ALY-2 加载时序', () => {
  it('100 ms：悦灵和骨架都不出现', () => {
    const r = simulate(100);
    expect(r.shown).toBeUndefined();
    expect(r.log.map((e) => e.phase)).toEqual(['waiting', 'idle']);
    expect(r.idle).toBe(100);
  });

  it('300 ms：180 ms 时出现，至少停留 500 ms，满 500 ms 后 300 ms 内退场完毕', () => {
    const r = simulate(300);
    expect(r.shown).toBe(180);
    expect(r.exiting! - r.shown!).toBeGreaterThanOrEqual(500);
    // 可以退场的时刻：就绪（300）与显示满 500 ms（680）中较晚的那个
    const free = Math.max(300, r.shown! + 500);
    expect(r.idle! - free).toBeLessThanOrEqual(300);
    expect(r.log.map((e) => e.phase)).toEqual(['waiting', 'shown', 'holding', 'exiting', 'idle']);
  });

  it('3 s：就绪后 300 ms 内退场完毕', () => {
    const r = simulate(3000);
    expect(r.shown).toBe(180);
    expect(r.exiting).toBe(3000);
    expect(r.idle! - 3000).toBeLessThanOrEqual(300);
  });

  it('退场中又开始加载：回到显示，不重新等 180 ms', () => {
    const clock = new FakeClock();
    const phases: LoaderPhase[] = [];
    const tl = new LoaderTimeline((p) => phases.push(p), {}, clock);
    tl.setLoading(true);
    clock.advanceTo(1000);
    tl.setLoading(false);
    clock.advanceTo(1100);
    tl.setLoading(true);
    expect(tl.phase).toBe('shown');
    clock.advanceTo(2000);
    tl.setLoading(false);
    clock.advanceTo(3000);
    expect(tl.phase).toBe('idle');
    expect(phases).toEqual(['waiting', 'shown', 'exiting', 'shown', 'exiting', 'idle']);
  });
});
