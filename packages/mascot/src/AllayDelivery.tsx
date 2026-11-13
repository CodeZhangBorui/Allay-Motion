import { useEffect, useLayoutEffect, useRef, type ReactNode } from 'react';
import { Allay } from './Allay';
import { useReducedMotion } from './reduced';
import { MascotSlotHeld, useMascotSlot } from './stage';
import { onMascotFrame } from './ticker';

// 拖放接收的后半段（docs/07-allay-mascot.md 7.6 D）。前半段（拖进窗口时压暗、虚线框、悦灵 hover、“放这里”）由应用画。
// - deliver：放下且文件有效。悦灵捧起这个包的图标，飞到它的归宿（资源包→顶栏的素材按钮，模板包→“我的”标签），
//   放下，目标弹一下。整段在放下后 600 ms 内结束（7.5 第 6 项）。
// - reject：文件无效。sad 播 0.6 秒。
// - 减少动效：不飞，悦灵在原处静止片刻后消失；目标不弹。
// 整层 pointer-events: none；运动由全应用唯一的帧循环驱动，只写 transform 和 opacity。

export interface AllayDeliveryProps {
  kind: 'deliver' | 'reject';
  /** 起点（视口坐标，悦灵中心）：拖放提示里悦灵所在的位置 */
  from: { x: number; y: number };
  /** 终点（视口坐标）：归宿元素的中心，由调用方在放下的那一刻量好；没有时原地淡出 */
  to?: { x: number; y: number } | null;
  /** 归宿元素（素材按钮、“我的”标签）：到达时弹一下 */
  target?: HTMLElement | null;
  /** 捧着的东西（包的图标） */
  carry?: ReactNode;
  /** 起点的悦灵尺寸 */
  size?: number;
  onDone(): void;
}

/** 全程的时长：放下后 600 ms 内退场完毕 */
export const DELIVERY_MS = 600;
const PICK_MS = 80;
const FLIGHT_MS = 380;
const REDUCED_MS = 300;

export function AllayDelivery({ kind, from, to = null, target, carry, size = 88, onDone }: AllayDeliveryProps) {
  const reduced = useReducedMotion();
  const granted = useMascotSlot('drop');
  const birdRef = useRef<HTMLDivElement>(null);
  const done = useRef(onDone);
  done.current = onDone;

  // 结束、目标弹跳
  useEffect(() => {
    const total = reduced ? REDUCED_MS : DELIVERY_MS;
    const timers = [setTimeout(() => done.current(), total)];
    if (kind === 'deliver' && target && !reduced) {
      timers.push(
        setTimeout(() => {
          target.classList.remove('allay-target-bounce');
          void target.offsetWidth; // 重新触发动画（不在帧循环里）
          target.classList.add('allay-target-bounce');
        }, PICK_MS + FLIGHT_MS),
      );
    }
    return () => timers.forEach(clearTimeout);
  }, [kind, target, reduced]);

  useLayoutEffect(() => {
    const bird = birdRef.current;
    if (!bird || !granted || reduced) return;
    let t0 = -1;
    return onMascotFrame((now) => {
      if (t0 < 0) t0 = now;
      const ms = now - t0;
      let x = from.x;
      let y = from.y;
      let scale = 1;
      let opacity: number;
      const dest = to;
      if (kind === 'deliver' && dest) {
        const k = Math.min(1, Math.max(0, (ms - PICK_MS) / FLIGHT_MS));
        const e = k < 0.5 ? 2 * k * k : 1 - (-2 * k + 2) ** 2 / 2;
        x = from.x + (dest.x - from.x) * e;
        // 弧线：先上扬再落到目标上
        y = from.y + (dest.y - from.y) * e - 60 * Math.sin(Math.PI * k);
        scale = 1 - 0.55 * e;
        opacity = ms > PICK_MS + FLIGHT_MS ? Math.max(0, 1 - (ms - PICK_MS - FLIGHT_MS) / (DELIVERY_MS - PICK_MS - FLIGHT_MS)) : 1;
      } else if (kind === 'deliver') {
        opacity = Math.max(0, 1 - ms / DELIVERY_MS);
      } else {
        opacity = ms < DELIVERY_MS - 120 ? 1 : Math.max(0, (DELIVERY_MS - ms) / 120);
      }
      bird.style.transform = `translate(${(x - size / 2).toFixed(1)}px, ${(y - size / 2).toFixed(1)}px) scale(${scale.toFixed(3)})`;
      bird.style.opacity = opacity.toFixed(2);
    });
  }, [granted, reduced, kind, from.x, from.y, to, size]);

  const facing = kind === 'deliver' && to && to.x < from.x ? 'left' : 'right';
  return (
    <div className="pointer-events-none fixed inset-0 z-50" data-testid="allay-delivery" data-kind={kind} aria-hidden="true">
      {granted && (
        <div
          ref={birdRef}
          className="pointer-events-none absolute top-0 left-0"
          style={{ transformOrigin: '50% 50%', transform: `translate(${(from.x - size / 2).toFixed(1)}px, ${(from.y - size / 2).toFixed(1)}px)` }}
        >
          <MascotSlotHeld.Provider value={true}>
            <Allay clip={kind === 'reject' ? 'sad' : reduced ? 'hover' : 'fly'} size={size} facing={facing} carry={kind === 'deliver' ? carry : undefined} />
          </MascotSlotHeld.Provider>
        </div>
      )}
    </div>
  );
}
