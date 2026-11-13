import type { ReactNode } from 'react';
import { Allay } from './Allay';
import type { MascotPriority } from './stage';

// AllayEmpty（7.4、7.5 第 7 项）：空状态。悦灵 hover，摊着手（不捧东西），静止不飞。
// 同一组件也用于错误卡片（7.5 第 10 项，clip="sad"）。

export interface AllayEmptyProps {
  title: string;
  description?: string;
  action?: ReactNode;
  className?: string;
  /** 错误卡片用 sad（7.5 第 10 项） */
  clip?: 'hover' | 'sad';
  size?: number;
  /** 出场位置的优先级（stage.ts）；默认按空状态 */
  priority?: MascotPriority;
}

export function AllayEmpty({ title, description, action, className, clip = 'hover', size = 64, priority = clip === 'sad' ? 'error' : 'empty' }: AllayEmptyProps) {
  return (
    <div className={`flex flex-col items-center gap-2 px-4 py-6 text-center ${className ?? ''}`} data-testid="allay-empty">
      <Allay clip={clip} size={size} priority={priority} />
      <p className="text-base font-semibold">{title}</p>
      {description && <p className="max-w-64 text-xs text-fg-subtle">{description}</p>}
      {action && <div className="mt-1">{action}</div>}
    </div>
  );
}
