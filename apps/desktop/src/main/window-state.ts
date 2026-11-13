import type { WindowState } from '../shared/settings';

// 窗口位置与大小的记忆（06-ui-design.md 6.3）：默认 1440×900，最小 1120×700。

export const DEFAULT_WINDOW = { width: 1440, height: 900 } as const;
export const MIN_WINDOW = { width: 1120, height: 700 } as const;

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * 把保存的窗口状态对到当前的显示器上：
 * 尺寸不小于最小值；窗口和任何一块屏幕的工作区重叠不足 100×40 时（比如那块屏幕已经拔掉）丢掉位置，交给系统居中。
 */
export function restoreBounds(saved: WindowState | undefined, workAreas: readonly Rect[]): Partial<Rect> & { width: number; height: number } {
  if (!saved) return { ...DEFAULT_WINDOW };
  const width = Math.max(MIN_WINDOW.width, saved.width);
  const height = Math.max(MIN_WINDOW.height, saved.height);
  const visible = workAreas.some((area) => {
    const overlapX = Math.min(saved.x + width, area.x + area.width) - Math.max(saved.x, area.x);
    const overlapY = Math.min(saved.y + height, area.y + area.height) - Math.max(saved.y, area.y);
    return overlapX >= 100 && overlapY >= 40;
  });
  return visible ? { x: saved.x, y: saved.y, width, height } : { width, height };
}
