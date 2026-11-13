import { create } from 'zustand';

// 窗口底部的一条临时提示（拖入资源包的结果等）。完整的通知（Sonner）在 M4。

export interface Notice {
  id: number;
  kind: 'info' | 'error';
  /** 已经翻译好的文字 */
  text: string;
}

interface NoticeState {
  notice: Notice | null;
  show(kind: Notice['kind'], text: string): void;
  dismiss(id: number): void;
}

let seq = 0;

export const useNoticeStore = create<NoticeState>((set, get) => ({
  notice: null,
  show: (kind, text) => set({ notice: { id: ++seq, kind, text } }),
  dismiss: (id) => {
    if (get().notice?.id === id) set({ notice: null });
  },
}));
