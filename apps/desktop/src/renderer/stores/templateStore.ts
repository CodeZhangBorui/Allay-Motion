import { create } from 'zustand';
import type { TemplateEntry } from '../../shared/templates';

// 已安装的模板（内置 + 用户）。以主进程的 templates.list 为准，安装、删除、派生之后重新取。

interface TemplateStoreState {
  entries: TemplateEntry[];
  loaded: boolean;
  refresh(): Promise<TemplateEntry[]>;
}

export const useTemplateStore = create<TemplateStoreState>((set) => ({
  entries: [],
  loaded: false,
  refresh: async () => {
    const entries = await window.allay.templates.list();
    set({ entries, loaded: true });
    return entries;
  },
}));
