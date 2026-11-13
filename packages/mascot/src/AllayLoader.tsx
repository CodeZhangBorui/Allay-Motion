import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { Allay } from './Allay';
import { ENTER_MS, enterPose, flightPose, flightSize, type FlightPose } from './flight';
import { useReducedMotion } from './reduced';
import { MascotSlotHeld, useMascotSlot, type MascotPriority } from './stage';
import { onMascotFrame } from './ticker';
import { LOADER_DELAY, LOADER_EXIT_MS, LOADER_EXIT_REDUCED_MS, LOADER_MIN_VISIBLE, LoaderTimeline, type LoaderPhase } from './timing';

export { useReducedMotion } from './reduced';

// AllayLoader（7.4、7.6 A）：包住一块带骨架的区域。加载超过 delay 才出现，出现后至少停留 minVisible。
// - 不到 delay 就加载完的，悦灵和骨架都不出现（这段时间里子内容不可见，但占着布局）。
// - 出现后：显示调用方给的骨架，悦灵从左侧外面飞入，再沿 7.6 A 的路径飞舞，尾部放出方点（6 个的池子）。
// - 加载完但显示不满 minVisible：继续显示骨架（保留加载时的子内容）直到满。
// - 退场：悦灵 260 ms 从较近的一侧加速飞出；同时内容里标了 data-allay-item 的元素按与飞出位置的水平距离依次淡入上移，间隔 24 ms。
// - 减少动效：没有飞行、拖尾和上移；悦灵以 hover 的第一帧静止在区域中央偏左，旁边是状态字。
// - 同一时刻只有一只全身悦灵（stage.ts）：没轮到时只有骨架。
// 整块区域 pointer-events 照常；悦灵和拖尾都是 pointer-events: none（T-ALY-5：点击落到下面的元素上）。
// 运动由全应用唯一的帧循环驱动（ticker.ts），回调里只写 transform 和 opacity，不读布局（区域尺寸来自 ResizeObserver）。

export interface AllayLoaderProps {
  loading: boolean;
  delay?: number;
  minVisible?: number;
  /** 状态文字（屏幕阅读器可读；减少动效时显示在悦灵旁边） */
  label: string;
  children: ReactNode;
  /** 出场位置的优先级（stage.ts） */
  priority?: MascotPriority;
  className?: string;
  testId?: string;
}

const TRAIL = 6;
const TRAIL_EVERY = 80;
const TRAIL_LIFE = 420;

interface FlightShared {
  /** 最近一帧的位置与区域宽度：退场时据此判断从哪一侧飞出 */
  x: number;
  w: number;
}

/** 飞舞的悦灵和拖尾 */
function Flyer({ exiting, reduced, label, priority, shared }: { exiting: boolean; reduced: boolean; label: string; priority: MascotPriority; shared: FlightShared }) {
  const rootRef = useRef<HTMLDivElement>(null);
  const birdRef = useRef<HTMLDivElement>(null);
  const trailRefs = useRef<(HTMLSpanElement | null)[]>([]);
  const [area, setArea] = useState({ w: 0, h: 0 });
  const [pose, setPose] = useState<Pick<FlightPose, 'facing' | 'clip'>>({ facing: 1, clip: 'fly' });
  const granted = useMascotSlot(priority);
  const exitingRef = useRef(exiting);
  exitingRef.current = exiting;

  useLayoutEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      if (entry) setArea({ w: entry.contentRect.width, h: entry.contentRect.height });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const S = flightSize(area.h);

  useLayoutEffect(() => {
    if (reduced || !granted || area.w === 0) return;
    let t0 = -1;
    let exitStart: number | null = null;
    let exitFrom: FlightPose | null = null;
    let lastTrail = -1e9;
    let trailIdx = 0;
    const trailBorn: number[] = new Array<number>(TRAIL).fill(-1e9);
    const trailPos: [number, number][] = Array.from({ length: TRAIL }, () => [0, 0]);
    let shown: Pick<FlightPose, 'facing' | 'clip'> = { facing: 1, clip: 'fly' };
    let last: FlightPose = enterPose(area, 0);
    const tick = (now: number) => {
      if (t0 < 0) t0 = now;
      const ms = now - t0;
      let p: FlightPose;
      if (exitingRef.current) {
        if (exitStart === null) {
          exitStart = now;
          exitFrom = last;
        }
        const k = Math.min(1, (now - exitStart) / LOADER_EXIT_MS);
        const from = exitFrom!;
        // 从较近的一侧加速飞出
        const toRight = from.x > area.w / 2;
        const target = toRight ? area.w + S : -S;
        p = { ...from, x: from.x + (target - from.x) * k * k, facing: toRight ? 1 : -1, clip: 'fly', tilt: toRight ? 10 : -10 };
      } else if (ms < ENTER_MS) p = enterPose(area, ms);
      else p = flightPose(area, (ms - ENTER_MS) / 1000);
      last = p;
      shared.x = p.x;
      shared.w = area.w;
      const bird = birdRef.current;
      if (bird) bird.style.transform = `translate(${(p.x - S / 2).toFixed(1)}px, ${(p.y - S / 2).toFixed(1)}px) rotate(${(p.facing * p.tilt).toFixed(2)}deg)`;
      // 拖尾：每 80 ms 在尾部放一个 4×4 的方点，420 ms 内淡出并缩小
      if (now - lastTrail >= TRAIL_EVERY) {
        lastTrail = now;
        trailBorn[trailIdx] = now;
        trailPos[trailIdx] = [p.x - p.facing * S * 0.3, p.y + S * 0.1];
        trailIdx = (trailIdx + 1) % TRAIL;
      }
      for (let i = 0; i < TRAIL; i++) {
        const dot = trailRefs.current[i];
        if (!dot) continue;
        const age = (now - trailBorn[i]!) / TRAIL_LIFE;
        if (age >= 1) {
          if (dot.style.opacity !== '0') dot.style.opacity = '0';
          continue;
        }
        const [x, y] = trailPos[i]!;
        dot.style.opacity = (1 - age).toFixed(2);
        dot.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) scale(${(1 - age * 0.6).toFixed(2)})`;
      }
      if (p.facing !== shown.facing || p.clip !== shown.clip) {
        shown = { facing: p.facing, clip: p.clip };
        setPose(shown);
      }
    };
    return onMascotFrame(tick);
  }, [reduced, granted, area, S, shared]);

  if (reduced) {
    return (
      <div ref={rootRef} className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center gap-3" data-testid="allay-flyer" data-reduced="true">
        <span className="pointer-events-none -translate-x-1/4">
          {granted && (
            <MascotSlotHeld.Provider value={true}>
              <Allay clip="hover" size={S} />
            </MascotSlotHeld.Provider>
          )}
        </span>
        <span className="text-xs text-fg-subtle">{label}</span>
      </div>
    );
  }
  return (
    <div ref={rootRef} className="pointer-events-none absolute inset-0 z-10 overflow-hidden" data-testid="allay-flyer" data-granted={granted}>
      {granted &&
        Array.from({ length: TRAIL }, (_, i) => (
          <span
            key={i}
            ref={(el) => {
              trailRefs.current[i] = el;
            }}
            data-allay-fx="trail"
            className="pointer-events-none absolute top-0 left-0 block size-1 bg-allay-light"
            style={{ opacity: 0 }}
          />
        ))}
      {granted && (
        <div ref={birdRef} className="pointer-events-none absolute top-0 left-0" style={{ transform: 'translate(-9999px, 0)' }} data-testid="allay-flyer-bird">
          <MascotSlotHeld.Provider value={true}>
            <Allay clip={pose.clip} size={S} facing={pose.facing === 1 ? 'right' : 'left'} />
          </MascotSlotHeld.Provider>
        </div>
      )}
    </div>
  );
}

export function AllayLoader({ loading, delay = LOADER_DELAY, minVisible = LOADER_MIN_VISIBLE, label, children, priority = 'default', className, testId }: AllayLoaderProps) {
  const reduced = useReducedMotion();
  const [phase, setPhase] = useState<LoaderPhase>('idle');
  const timeline = useRef<LoaderTimeline | null>(null);
  timeline.current ??= new LoaderTimeline(setPhase, { delay, minVisible });
  timeline.current.setExitMs(reduced ? LOADER_EXIT_REDUCED_MS : LOADER_EXIT_MS);
  useLayoutEffect(() => {
    timeline.current!.setLoading(loading);
  }, [loading]);
  useLayoutEffect(() => () => timeline.current?.dispose(), []);
  const shared = useRef<FlightShared>({ x: 0, w: 0 }).current;

  // 加载期间的子内容（骨架）；holding 时继续显示它
  const held = useRef<ReactNode>(children);
  if (loading) held.current = children;
  const containerRef = useRef<HTMLDivElement>(null);

  // 退场时内容依次淡入并上移：按与悦灵飞出那一侧的水平距离，间隔 24 ms。只在这一刻读一次布局（不在帧循环里）
  useLayoutEffect(() => {
    if (phase !== 'exiting' || reduced) return;
    const root = containerRef.current;
    if (!root) return;
    const box = root.getBoundingClientRect();
    const items = [...root.querySelectorAll<HTMLElement>('[data-allay-item]')];
    const fromRight = shared.w > 0 ? shared.x > shared.w / 2 : true;
    const sorted = items
      .map((el) => {
        const r = el.getBoundingClientRect();
        const cx = r.left + r.width / 2 - box.left;
        return { el, d: fromRight ? box.width - cx : cx };
      })
      .sort((a, b) => a.d - b.d);
    sorted.forEach(({ el }, i) => {
      el.style.animationDelay = `${i * 24}ms`;
      el.classList.add('allay-item-rise');
    });
  }, [phase, reduced, shared]);

  const skeleton = phase === 'shown' || phase === 'holding';
  const content = skeleton ? held.current : children;
  return (
    <div ref={containerRef} className={`relative ${className ?? ''}`} aria-busy={loading || skeleton} data-allay-loader-phase={phase} data-testid={testId}>
      {phase === 'waiting' ? <div style={{ visibility: 'hidden' }}>{children}</div> : content}
      {(skeleton || phase === 'exiting') && <Flyer exiting={phase === 'exiting'} reduced={reduced} label={label} priority={priority} shared={shared} />}
      <span className="sr-only" role="status">
        {skeleton ? label : ''}
      </span>
    </div>
  );
}
