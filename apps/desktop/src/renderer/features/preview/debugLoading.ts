import { create } from 'zustand';

// 只给测试钩子用（T-ALY-2）：让预览视口的加载编排“假装在加载”一段时间，验证 180 ms / 500 ms 的时序。
// 正式运行时永远是 false。

export const useDebugLoadingStore = create<{ loading: boolean }>(() => ({ loading: false }));

export function useDebugLoading(): boolean {
  return useDebugLoadingStore((s) => s.loading);
}

export function setDebugLoading(loading: boolean): void {
  useDebugLoadingStore.setState({ loading });
}
