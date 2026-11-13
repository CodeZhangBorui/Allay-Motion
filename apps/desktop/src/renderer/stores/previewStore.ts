import { create } from 'zustand';

// 预览引擎的状态，给预览区的错误卡片和测试钩子看。

export type PreviewStatus =
  | { kind: 'starting' }
  | { kind: 'loading' }
  | { kind: 'ready'; warnings: string[] }
  /** 模板出错：装载、setup 或渲染时抛错 */
  | { kind: 'error'; message: string }
  /** 看门狗终止了 Worker（模板无响应），已经重建了一个空闲的 Worker */
  | { kind: 'unresponsive'; operation: string }
  /** 显卡或驱动不支持、Worker 崩溃 */
  | { kind: 'crashed'; message: string };

interface PreviewState {
  status: PreviewStatus;
  /** 当前 Worker 是第几个（每重建一次加一） */
  generation: number;
  setStatus(status: PreviewStatus): void;
  setGeneration(generation: number): void;
}

export const usePreviewStore = create<PreviewState>((set) => ({
  status: { kind: 'starting' },
  generation: 0,
  setStatus: (status) => set({ status }),
  setGeneration: (generation) => set({ generation }),
}));
