import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { Allay } from './Allay';
import { ENTER_MS, enterPose, flightPose, flightSize, type FlightPose } from './flight';
import { LOADER_DELAY, LOADER_EXIT_MS, LOADER_EXIT_REDUCED_MS, LOADER_MIN_VISIBLE, LoaderTimeline, type LoaderPhase } from './timing';

// AllayLoader（7.4、7.6 A）：包住一块带骨架的区域。加载超过 delay 才出现，出现后至少停留 minVisible。
// - 不到 delay 就加载完的，悦灵和骨架都不出现（这段时间里子内容不可见，但占着布局）。
// - 出现后：显示调用方给的骨架，悦灵沿 7.6 A 的路径飞舞，一团悦灵青的光跟着它，尾部放出方点。
// - 加载完但显示不满 minVisible：继续显示骨架（保留加载时的子内容）直到满。
// - 退场：悦灵 260 ms 从较近的一侧飞出；同时内容里标了 data-allay-item 的元素按与飞出位置的水平距离依次淡入上移，间隔 24 ms。
// - 减少动效：没有飞行、拖尾和上移；悦灵以 hover 的第一帧静止在区域中央偏左，旁边是状态字。
// 整块区域 pointer-events 照常；悦灵和光、拖尾都是 pointer-events: none（T-ALY-5：点击落到下面的元素上）。

export function useReducedMotion(): boolean {
  const read = () => typeof document !== 'undefined' && document.documentElement.dataset.reducedMotion === 'true';
  const [reduced, setReduced] = useState(read);
  useEffect(() => {
    const mo = new MutationObserver(() => setReduced(read()));
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-reduced-motion'] });
    return () => mo.disconnect();
  }, []);
  return reduced;
}

export interface AllayLoaderProps {
  loading: boolean;
  delay?: number;
  minVisible?: number;
  /** 状态文字（屏幕阅读器可读；减少动效时显示在悦灵旁边） */
  label: string;
  children: ReactNode;
  className?: string;
  testId?: string;
}

const TRAIL = 6;
const TRAIL_EVERY = 80;
const TRAIL_LIFE = 420;

/** 飞舞的悦灵、光和拖尾。一个 rAF 循环驱动，循环里只改 transform 和 opacity，不读布局。 */
function Flyer({ exiting, reduced, label }: { exiting: boolean; reduced: boolean; label: string }) {
  const rootRef = useRef<HTMLDivElement>(null);
  const birdRef = useRef<HTMLDivElement>(null);
  const glowRef = useRef<HTMLDivElement>(null);
  const trailRefs = useRef<(HTMLSpanElement | null)[]>([]);
  const [area, setArea] = useState({ w: 0, h: 0 });
  const [pose, setPose] = useState<Pick<FlightPose, 'facing' | 'clip'>>({ facing: 1, clip: 'fly' });
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

  useEffect(() => {
    if (reduced || area.w === 0) return;
    let raf = 0;
    const t0 = performance.now();
    let exitStart: number | null = null;
    let exitFrom: FlightPose | null = null;
    let lastTrail = 0;
    let trailIdx = 0;
    const trailBorn: number[] = new Array(TRAIL).fill(-1e9);
    const trailPos: [number, number][] = new Array(TRAIL).fill([0, 0]);
    let shown: Pick<FlightPose, 'facing' | 'clip'> = { facing: 1, clip: 'fly' };
    let last: FlightPose = enterPose(area, 0);
    const tick = (now: number) => {
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
      const bird = birdRef.current;
      if (bird) bird.style.transform = `translate(${(p.x - S / 2).toFixed(1)}px, ${(p.y - S / 2).toFixed(1)}px) rotate(${(p.facing * p.tilt).toFixed(2)}deg)`;
      const glow = glowRef.current;
      if (glow) glow.style.transform = `translate(${(p.x - S * 1.1).toFixed(1)}px, ${(p.y - S * 1.1).toFixed(1)}px)`;
      // 拖尾：每 80 ms 在尾部放一个方点，420 ms 内淡出并缩小
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
          dot.style.opacity = '0';
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
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [reduced, area, S]);

  if (reduced) {
    return (
      <div ref={rootRef} className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center gap-3" data-testid="allay-flyer" data-reduced="true">
        <span className="-translate-x-1/4">
          <Allay clip="hover" size={S} />
        </span>
        <span className="text-xs text-fg-muted">{label}</span>
      </div>
    );
  }
  return (
    <div
      ref={rootRef}
      className="pointer-events-none absolute inset-0 z-10 overflow-hidden"
      data-testid="allay-flyer"
      style={{ opacity: exiting ? undefined : 1 }}
    >
      <div
        ref={glowRef}
        className="absolute top-0 left-0 rounded-full"
        style={{
          width: S * 2.2,
          height: S * 2.2,
          background: 'radial-gradient(circle, color-mix(in srgb, var(--allay-glow) 22%, transparent) 0%, transparent 70%)',
          mixBlendMode: 'plus-lighter',
          transform: 'translate(-9999px, 0)',
        }}
      />
      {Array.from({ length: TRAIL }, (_, i) => (
        <span
          key={i}
          ref={(el) => {
            trailRefs.current[i] = el;
          }}
          className="absolute top-0 left-0 block size-1 bg-allay-glow"
          style={{ opacity: 0 }}
        />
      ))}
      <div ref={birdRef} className="absolute top-0 left-0" style={{ transform: 'translate(-9999px, 0)' }} data-testid="allay-flyer-bird">
        <Allay clip={pose.clip} size={S} facing={pose.facing === 1 ? 'right' : 'left'} />
      </div>
    </div>
  );
}

export function AllayLoader({ loading, delay = LOADER_DELAY, minVisible = LOADER_MIN_VISIBLE, label, children, className, testId }: AllayLoaderProps) {
  const reduced = useReducedMotion();
  const [phase, setPhase] = useState<LoaderPhase>('idle');
  const timeline = useRef<LoaderTimeline | null>(null);
  timeline.current ??= new LoaderTimeline(setPhase, { delay, minVisible });
  timeline.current.setExitMs(reduced ? LOADER_EXIT_REDUCED_MS : LOADER_EXIT_MS);
  useLayoutEffect(() => {
    timeline.current!.setLoading(loading);
  }, [loading]);
  useEffect(() => () => timeline.current?.dispose(), []);

  // 加载期间的子内容（骨架）；holding 时继续显示它
  const held = useRef<ReactNode>(children);
  if (loading) held.current = children;
  const containerRef = useRef<HTMLDivElement>(null);

  // 退场时内容依次淡入并上移：按与飞出位置（较近的一侧）的水平距离，间隔 24 ms。只在这一刻读一次布局
  useLayoutEffect(() => {
    if (phase !== 'exiting' || reduced) return;
    const root = containerRef.current;
    if (!root) return;
    const box = root.getBoundingClientRect();
    const items = [...root.querySelectorAll<HTMLElement>('[data-allay-item]')];
    // 占位实现按右侧算飞出位置（飞舞的方向在 Flyer 里，M5 换成真正的组件时再把实际的飞出一侧传出来）
    const fromRight = true;
    const sorted = items
      .map((el) => {
        const r = el.getBoundingClientRect();
        const cx = r.left + r.width / 2 - box.left;
        return { el, d: fromRight ? box.width - cx : cx };
      })
      .sort((a, b) => a.d - b.d);
    sorted.forEach(({ el }, i) => {
      el.style.animationDelay = `${i * 24}ms`;
      el.classList.add('allay-item-in');
    });
  }, [phase, reduced]);

  const skeleton = phase === 'shown' || phase === 'holding';
  const content = skeleton ? held.current : children;
  return (
    <div ref={containerRef} className={`relative ${className ?? ''}`} aria-busy={loading || skeleton} data-allay-loader-phase={phase} data-testid={testId}>
      {phase === 'waiting' ? <div style={{ visibility: 'hidden' }}>{children}</div> : content}
      {(skeleton || phase === 'exiting') && <Flyer exiting={phase === 'exiting'} reduced={reduced} label={label} />}
      <span className="sr-only" role="status">
        {skeleton ? label : ''}
      </span>
    </div>
  );
}
