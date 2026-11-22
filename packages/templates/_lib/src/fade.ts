// 整体的淡入淡出：进入阶段里不透明度从 0 线性升到 1，退出阶段里从 1 线性降到 0。
// 游戏里直接出现的界面（Boss 栏、聊天、字幕……）加上它，首末帧才是全透明的（时间窗首尾各让出一帧，见 timing.ts）。
import { progress, type Windows } from './timing';

/** t 时刻整体的不透明度（0–1）：进入阶段的进度 × (1 − 退出阶段的进度) */
export function fadeInOut(t: number, win: Pick<Windows, 'in' | 'out'>): number {
  return progress(t, win.in) * (1 - progress(t, win.out));
}
