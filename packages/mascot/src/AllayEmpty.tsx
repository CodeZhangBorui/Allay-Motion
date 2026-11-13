import type { ReactNode } from 'react';
import { Allay } from './Allay';

// AllayEmpty（7.4、7.5 第 7 项）：空状态。悦灵 hover，摊着手，静止不飞。占位实现。

export interface AllayEmptyProps {
  title: string;
  description?: string;
  action?: ReactNode;
  className?: string;
  /** 错误卡片用 sad（7.5 第 10 项） */
  clip?: 'hover' | 'sad';
  size?: number;
}

export function AllayEmpty({ title, description, action, className, clip = 'hover', size = 64 }: AllayEmptyProps) {
  return (
    <div className={`flex flex-col items-center gap-2 px-4 py-6 text-center ${className ?? ''}`} data-testid="allay-empty">
      <Allay clip={clip} size={size} />
      <p className="text-sm font-semibold">{title}</p>
      {description && <p className="max-w-64 text-xs text-fg-muted">{description}</p>}
      {action && <div className="mt-1">{action}</div>}
    </div>
  );
}
