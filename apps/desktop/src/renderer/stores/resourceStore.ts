import { create } from 'zustand';
import { DownloadStateSchema, type ResourceState } from '../../shared/resources';

// 资源栈的状态（1.7 的 resourceStore）：各层、resourceStamp、原版层来源、下载进度。以主进程推来的为准。

interface ResourceStoreState {
  state: ResourceState | null;
  /** 首次发现本机游戏的询问对话框这次启动已经处理过（3.4“询问一次”） */
  discoveryHandled: boolean;
  replace(state: ResourceState): void;
  setDiscoveryHandled(): void;
}

/**
 * 主进程推来的下载进度先过 schema（docs/decisions.md 界面增强）：不合法时只把下载这一块当成空闲，
 * 资源栈的其他信息照常用
 */
export function checkResourceState(state: ResourceState): ResourceState {
  const download = DownloadStateSchema.safeParse(state.download);
  if (download.success) return { ...state, download: download.data };
  console.error('[resources] malformed download state ignored', download.error.message);
  return { ...state, download: { status: 'idle' } };
}

export const useResourceStore = create<ResourceStoreState>((set) => ({
  state: null,
  discoveryHandled: false,
  replace: (state) => set({ state: checkResourceState(state) }),
  setDiscoveryHandled: () => set({ discoveryHandled: true }),
}));

/** 当前 resourceStamp；还没拿到状态时为空串 */
export function currentStamp(): string {
  return useResourceStore.getState().state?.stamp ?? '';
}
