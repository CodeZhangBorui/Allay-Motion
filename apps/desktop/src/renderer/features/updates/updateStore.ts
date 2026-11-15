import { create } from 'zustand';
import type { UpdateState } from '../../../shared/updates';
import { useUiStore } from '../../stores/uiStore';

// 自动更新的界面状态（docs/decisions.md“自动更新”）：联网、下载、安装都在主进程，这里只存主进程推来的状态、转发指令。

interface UpdateStore {
  state: UpdateState | null;
  load(): Promise<void>;
  check(): Promise<void>;
  download(): Promise<void>;
  cancel(): Promise<void>;
  install(): Promise<void>;
}

export const useUpdateStore = create<UpdateStore>((set) => ({
  state: null,
  async load() {
    set({ state: await window.allay.updates.state() });
  },
  async check() {
    set({ state: await window.allay.updates.check() });
  },
  async download() {
    set({ state: await window.allay.updates.download() });
  },
  async cancel() {
    await window.allay.updates.cancel();
  },
  async install() {
    set({ state: await window.allay.updates.install() });
  },
}));

/** 跳过这个版本：自动检查不再提示它 */
export function skipVersion(version: string | null): void {
  const prefs = useUiStore.getState().settings.updates;
  useUiStore.getState().update({ updates: { ...prefs, skipVersion: version } });
}
