import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import type { ClipName } from '../model/allay.motions';
import { Allay } from './Allay';
import { useReducedMotion } from './reduced';
import { MascotSlotHeld, useMascotSlot } from './stage';
import { onMascotFrame } from './ticker';

// AllayProgress（7.4、7.6 B）：导出进度。
// - rendering：悦灵悬在进度条前端上方，捧着这个转场用的方块；水平位置用弹簧跟随进度（临界阻尼，不过冲不抖），
//   进度条前端有少量拖尾方点。
// - muxing：进度到头后，悦灵飞向进度条右端的文件图标，把手里的东西放进去，图标弹一下。
// - done：dance 播一遍（2 秒），然后回到 hover。
// - error：sad，手里的东西掉下去淡出。
// - canceled：悦灵向上飞出。
// - 减少动效：悦灵静止在进度条前端（第一帧），没有飞行、拖尾、掉落和弹跳。
// 运动由全应用唯一的帧循环驱动，只写 transform 和 opacity；尺寸来自 ResizeObserver，帧循环里不读布局。

export type AllayProgressPhase = 'rendering' | 'muxing' | 'done' | 'error' | 'canceled';

export interface AllayProgressProps {
  /** 0–1 */
  value: number;
  phase: AllayProgressPhase;
  carry?: ReactNode;
  label?: string;
  /** 进度条右端的文件图标（封装时悦灵把东西放进去）；不给时画一个简单的文件形状 */
  target?: ReactNode;
}

const SIZE = 48;
const LANE = 60; // 进度条上方给悦灵留的高度
const TARGET_W = 20;
const GAP = 8;
const MUX_FLIGHT_MS = 500;
const DROP_MS = 260;
const FALL_MS = 520;
const CANCEL_MS = 420;
const DANCE_MS = 2000;
const TRAIL = 6;
const TRAIL_EVERY = 110;
const TRAIL_LIFE = 420;

type Drop = { kind: 'none' } | { kind: 'into' | 'fall'; at: number };

function clipFor(phase: AllayProgressPhase, flying: boolean, danced: boolean): ClipName {
  if (phase === 'error') return 'sad';
  if (phase === 'done') return danced ? 'hover' : 'dance';
  if (phase === 'canceled' || flying) return 'fly';
  return 'hover';
}

export function AllayProgress({ value, phase, carry, label, target }: AllayProgressProps) {
  const reduced = useReducedMotion();
  const granted = useMascotSlot('export');
  const v = Math.min(1, Math.max(0, Number.isFinite(value) ? value : 0));
  const rowRef = useRef<HTMLDivElement>(null);
  const birdRef = useRef<HTMLDivElement>(null);
  const dropRef = useRef<HTMLSpanElement>(null);
  const targetRef = useRef<HTMLSpanElement>(null);
  const trailRefs = useRef<(HTMLSpanElement | null)[]>([]);
  const [rowW, setRowW] = useState(0);
  const [holding, setHolding] = useState(phase === 'rendering' || phase === 'muxing');
  const [flying, setFlying] = useState(false);
  const [danced, setDanced] = useState(false);
  const [drop, setDrop] = useState<Drop>({ kind: 'none' });
  const [bounce, setBounce] = useState(0);
  const holdingRef = useRef(holding);
  holdingRef.current = holding;
  const live = useRef({ value: v, phase, phaseAt: 0, drop: drop as Drop });
  live.current.value = v;
  live.current.drop = drop;

  useLayoutEffect(() => {
    const el = rowRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => entry && setRowW(entry.contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // 阶段切换：动作、捧着的东西、掉落、图标弹跳
  useEffect(() => {
    live.current.phase = phase;
    live.current.phaseAt = performance.now();
    const timers: ReturnType<typeof setTimeout>[] = [];
    const later = (ms: number, fn: () => void) => timers.push(setTimeout(fn, reduced ? 0 : ms));
    if (phase === 'rendering') {
      setHolding(true);
      setFlying(false);
      setDrop({ kind: 'none' });
    } else if (phase === 'muxing') {
      setFlying(!reduced);
      later(MUX_FLIGHT_MS, () => {
        setFlying(false);
        setHolding(false);
        if (!reduced) setDrop({ kind: 'into', at: performance.now() });
        later(DROP_MS, () => !reduced && setBounce((n) => n + 1));
      });
    } else if (phase === 'done') {
      setFlying(false);
      setHolding(false);
      setDanced(reduced);
      later(DANCE_MS, () => setDanced(true));
    } else if (phase === 'error') {
      setFlying(false);
      if (holdingRef.current && !reduced) setDrop({ kind: 'fall', at: performance.now() });
      setHolding(false);
    } else {
      setFlying(!reduced);
    }
    return () => timers.forEach(clearTimeout);
  }, [phase, reduced]);

  const barW = Math.max(0, rowW - TARGET_W - GAP);
  const targetX = rowW - TARGET_W / 2;

  // 帧循环：弹簧跟随、飞向文件图标、向上飞出、掉落、拖尾
  useLayoutEffect(() => {
    if (!granted || rowW === 0) return;
    const bird = birdRef.current;
    if (!bird || reduced) return;
    let x = live.current.value * barW;
    let vx = 0;
    let last = -1;
    let muxFrom: number | null = null;
    let lastTrail = -1e9;
    let lastFront = x;
    let trailIdx = 0;
    const trailBorn = new Array<number>(TRAIL).fill(-1e9);
    const trailPos: [number, number][] = Array.from({ length: TRAIL }, () => [0, 0]);
    const K = 90;
    const C = 2 * Math.sqrt(K); // 临界阻尼：不过冲
    return onMascotFrame((now) => {
      const dt = last < 0 ? 0 : Math.min(0.05, (now - last) / 1000);
      last = now;
      const { phase: ph, phaseAt, value: val, drop: dr } = live.current;
      const since = now - phaseAt;
      let y = 0;
      let opacity = 1;
      if (ph === 'rendering' || ph === 'error') {
        muxFrom = null;
        const goal = val * barW;
        vx += (K * (goal - x) - C * vx) * dt;
        x += vx * dt;
      } else if (ph === 'muxing' || ph === 'done') {
        muxFrom ??= x;
        const k = Math.min(1, since / MUX_FLIGHT_MS);
        const e = k < 0.5 ? 2 * k * k : 1 - (-2 * k + 2) ** 2 / 2;
        x = muxFrom + (targetX - muxFrom) * (ph === 'done' && since > MUX_FLIGHT_MS ? 1 : e);
        y = -10 * Math.sin(Math.PI * k);
        vx = 0;
      } else {
        // canceled：向上飞出
        const k = Math.min(1, since / CANCEL_MS);
        y = -80 * k * k;
        opacity = 1 - k;
      }
      bird.style.transform = `translate(${(x - SIZE / 2).toFixed(1)}px, ${y.toFixed(1)}px)`;
      bird.style.opacity = opacity.toFixed(2);

      // 掉落：放进文件图标，或者（失败时）掉下去淡出
      const item = dropRef.current;
      if (item && dr.kind !== 'none') {
        const dur = dr.kind === 'into' ? DROP_MS : FALL_MS;
        const k = Math.min(1, (now - dr.at) / dur);
        const hx = x + SIZE * 0.1;
        const hy = SIZE * 0.62;
        const tx = dr.kind === 'into' ? hx + (targetX - hx) * k : hx;
        const ty = dr.kind === 'into' ? hy + (LANE + 3 - hy) * k * k : hy + 44 * k * k;
        item.style.transform = `translate(${tx.toFixed(1)}px, ${ty.toFixed(1)}px) translate(-50%, -50%) scale(${(1 - 0.5 * k).toFixed(2)})`;
        item.style.opacity = (1 - k).toFixed(2);
      }

      // 进度条前端的拖尾方点：前端在动时才放
      const front = val * barW;
      if (ph === 'rendering' && front > lastFront + 0.5 && now - lastTrail >= TRAIL_EVERY) {
        lastTrail = now;
        trailBorn[trailIdx] = now;
        trailPos[trailIdx] = [front, LANE + 1];
        trailIdx = (trailIdx + 1) % TRAIL;
      }
      lastFront = front;
      for (let i = 0; i < TRAIL; i++) {
        const dot = trailRefs.current[i];
        if (!dot) continue;
        const age = (now - trailBorn[i]!) / TRAIL_LIFE;
        if (age >= 1) {
          if (dot.style.opacity !== '0') dot.style.opacity = '0';
          continue;
        }
        const [tx, ty] = trailPos[i]!;
        dot.style.opacity = (0.9 * (1 - age)).toFixed(2);
        dot.style.transform = `translate(${(tx - 12 * age).toFixed(1)}px, ${(ty - 6 * age).toFixed(1)}px) scale(${(1 - age * 0.6).toFixed(2)})`;
      }
    });
  }, [granted, reduced, rowW, barW, targetX]);

  // 文件图标弹一下（CSS 动画，减少动效时不做）
  useEffect(() => {
    const el = targetRef.current;
    if (!el || bounce === 0) return;
    el.classList.remove('allay-target-bounce');
    void el.offsetWidth; // 重新触发动画（不在帧循环里）
    el.classList.add('allay-target-bounce');
  }, [bounce]);

  const clip = clipFor(phase, flying, danced);
  // 减少动效：位置直接由属性决定，静止在进度条前端（封装、完成时在文件图标上方；取消时隐藏），没有位移动画。
  // 其余情况初始放在画外，由帧循环写 transform（React 不再改它，避免和帧循环抢）
  const staticX = phase === 'muxing' || phase === 'done' ? targetX : v * barW;
  const birdStyle = reduced
    ? { transform: `translate(${(staticX - SIZE / 2).toFixed(1)}px, 0px)`, opacity: phase === 'canceled' ? 0 : 1 }
    : { transform: 'translate(-9999px, 0px)' };
  return (
    <div className="relative" style={{ paddingTop: LANE }} data-testid="allay-progress" data-phase={phase}>
      <div className="pointer-events-none absolute inset-x-0 top-0" style={{ height: LANE }} aria-hidden="true">
        {granted && !reduced &&
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
          <div ref={birdRef} className="pointer-events-none absolute top-0 left-0" style={birdStyle} data-testid="allay-progress-bird">
            <MascotSlotHeld.Provider value={true}>
              <Allay clip={clip} size={SIZE} carry={holding ? carry : undefined} />
            </MascotSlotHeld.Provider>
          </div>
        )}
        {granted && drop.kind !== 'none' && (
          <span ref={dropRef} data-allay-fx="drop" className="pointer-events-none absolute top-0 left-0 flex items-center justify-center" style={{ width: SIZE * 0.3, height: SIZE * 0.3, opacity: 0 }}>
            {carry}
          </span>
        )}
      </div>
      <div ref={rowRef} className="flex items-center" style={{ gap: GAP }}>
        <div
          role="progressbar"
          aria-label={label}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(v * 100)}
          className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-control-hi"
        >
          <div className={`h-full rounded-full ${phase === 'error' ? 'bg-danger' : 'bg-primary'}`} style={{ width: `${v * 100}%` }} />
        </div>
        <span ref={targetRef} data-allay-fx="target" className="flex shrink-0 items-center justify-center text-fg-muted" style={{ width: TARGET_W, height: TARGET_W }} aria-hidden="true">
          {target ?? <span className="block h-4 w-3 rounded-[2px] border-[1.5px] border-current" />}
        </span>
      </div>
    </div>
  );
}
