// 工作区的模式（docs/animation-editor.md 9.1；docs/06-ui-design.md 6.15）：做模板（template）还是做动画（animation）。
// 进入动画编辑器时界面不跳到另一页，而是在原地逐步变成专业软件的布局：
//   1. 只服务模板的东西（模板库、预设、模板参数）淡出（out，120 ms）；
//   2. 换成动画的东西（图层、检查器、关键帧时间轴），时间轴同时长高；
//   3. 新的东西淡入（in），左栏、右栏、时间轴依次错开 60 ms。
// 只改透明度和尺寸（docs/design-direction.md）；“减少动效”时直接切换。退出时反过来。
import { create } from 'zustand';
import { useProjectStore } from '../stores/projectStore';

export type WorkspaceMode = 'template' | 'animation';
export type ModePhase = 'idle' | 'out' | 'in';

interface ModeState {
  /** 界面现在显示的模式（淡出期间还是旧的） */
  shown: WorkspaceMode;
  phase: ModePhase;
}

export const useWorkspaceMode = create<ModeState>(() => ({ shown: 'template', phase: 'idle' }));

export const MODE_FADE_MS = 120;
/** 左、右、下三块的错开（ms） */
export const MODE_STAGGER_MS = 60;

const target = (): WorkspaceMode => (useProjectStore.getState().template?.animation ? 'animation' : 'template');
const reduced = () => typeof document !== 'undefined' && document.documentElement.dataset.reducedMotion === 'true';

let timers: ReturnType<typeof setTimeout>[] = [];
let started = false;

function go(next: WorkspaceMode): void {
  for (const t of timers) clearTimeout(t);
  timers = [];
  if (useWorkspaceMode.getState().shown === next && useWorkspaceMode.getState().phase === 'idle') return;
  if (reduced()) {
    useWorkspaceMode.setState({ shown: next, phase: 'idle' });
    return;
  }
  // 旧的淡出（三块错开）→ 换内容（仍是透明的）→ 下一帧起新的淡入（同样错开）→ 回到空闲
  const swap = MODE_FADE_MS + MODE_STAGGER_MS * 2;
  useWorkspaceMode.setState({ phase: 'out' });
  timers.push(
    setTimeout(() => useWorkspaceMode.setState({ shown: next, phase: 'out' }), swap),
    setTimeout(() => useWorkspaceMode.setState({ phase: 'in' }), swap + 32),
    setTimeout(() => useWorkspaceMode.setState({ phase: 'idle' }), swap * 2 + 32),
  );
}

/** 启动时调用一次：之后跟着当前模板变（是不是自建动画） */
export function startWorkspaceMode(): void {
  if (started) return;
  started = true;
  useWorkspaceMode.setState({ shown: target(), phase: 'idle' });
  useProjectStore.subscribe((s, prev) => {
    if (!!s.template?.animation !== !!prev.template?.animation) go(target());
  });
}

/** 一块区域的透明度类名：order 是错开的序号（左 0、右 1、下 2） */
export function fadeClass(phase: ModePhase, order: number): { className: string; style: { transitionDelay: string } } {
  const delay = `${order * MODE_STAGGER_MS}ms`;
  return {
    className: `transition-opacity duration-(--dur-2) ease-out ${phase === 'out' ? 'opacity-0' : 'opacity-100'}`,
    style: { transitionDelay: phase === 'idle' ? '0ms' : delay },
  };
}
