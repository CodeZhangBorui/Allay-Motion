import { create } from 'zustand';
import type { ResourceState } from '../../shared/resources';

// 资源栈的状态（1.7 的 resourceStore）：各层、resourceStamp、原版层来源、下载进度。以主进程推来的为准。

interface ResourceStoreState {
  state: ResourceState | null;
  /** 首次发现本机游戏的询问对话框这次启动已经处理过（3.4“询问一次”） */
  discoveryHandled: boolean;
  replace(state: ResourceState): void;
  setDiscoveryHandled(): void;
}

export const useResourceStore = create<ResourceStoreState>((set) => ({
  state: null,
  discoveryHandled: false,
  replace: (state) => set({ state }),
  setDiscoveryHandled: () => set({ discoveryHandled: true }),
}));

/** 当前 resourceStamp；还没拿到状态时为空串 */
export function currentStamp(): string {
  return useResourceStore.getState().state?.stamp ?? '';
}
