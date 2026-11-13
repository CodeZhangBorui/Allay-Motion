import type { ReactNode } from 'react';
import { Allay } from './Allay';
import { useReducedMotion } from './AllayLoader';

// AllayProgress（7.4、7.6 B）的占位实现：一条进度条，悦灵悬在进度条前端上方，捧着用户这个转场用的方块。
// 完整的编排（弹簧跟随、封装时飞向文件图标、完成时 dance、失败 sad、取消向上飞出）在 M7 接入真实进度时做。

export type AllayProgressPhase = 'rendering' | 'muxing' | 'done' | 'error' | 'canceled';

export interface AllayProgressProps {
  /** 0–1 */
  value: number;
  phase: AllayProgressPhase;
  carry?: ReactNode;
  label?: string;
}

export function AllayProgress({ value, phase, carry, label }: AllayProgressProps) {
  const reduced = useReducedMotion();
  const v = Math.min(1, Math.max(0, Number.isFinite(value) ? value : 0));
  const clip = phase === 'error' ? 'sad' : phase === 'done' ? 'dance' : 'hover';
  return (
    <div className="relative pt-14" data-testid="allay-progress" data-phase={phase}>
      <div
        className="pointer-events-none absolute top-0 -translate-x-1/2"
        style={{ left: `${v * 100}%`, transition: reduced ? undefined : 'left var(--dur-2) var(--ease-out)' }}
      >
        <Allay clip={clip} size={48} carry={phase === 'rendering' || phase === 'muxing' ? carry : undefined} />
      </div>
      <div
        role="progressbar"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(v * 100)}
        className="h-4 w-full overflow-hidden blk blk-sunken p-0.5"
      >
        <div
          className={`h-full ${phase === 'error' ? 'bg-danger' : 'bg-primary'}`}
          style={{ width: `${v * 100}%` }}
        />
      </div>
    </div>
  );
}
