import { create } from 'zustand';
import type { PanelState, Theme, UiSettings, UiSettingsPatch } from '../../shared/settings';

// uiStore（1.7）：面板宽度、折叠状态、主题、语言。
// 真正的持久化在主进程的 settings.json（1.6 第 10 条：不用 localStorage）。

export type Side = 'left' | 'right';

interface UiState {
  settings: UiSettings;
  /** 主进程推来的完整设置（启动、或其他地方改了设置） */
  replace(settings: UiSettings): void;
  setTheme(theme: Theme): void;
  setPanel(side: Side, state: PanelState): void;
}

const LAYOUT_SAVE_DELAY = 150;
let layoutTimer: ReturnType<typeof setTimeout> | undefined;
let pendingLayout: NonNullable<UiSettingsPatch['layout']> = {};

function persist(patch: UiSettingsPatch): void {
  window.allay.settings.set(patch).catch((error: unknown) => {
    console.error('failed to save settings', error);
  });
}

export const useUiStore = create<UiState>((set, get) => ({
  settings: {
    theme: 'dark',
    language: 'system',
    reducedMotion: 'system',
    layout: { left: { size: 280, collapsed: false }, right: { size: 320, collapsed: false } },
  },
  replace: (settings) => set({ settings }),
  setTheme: (theme) => {
    set({ settings: { ...get().settings, theme } });
    persist({ theme });
  },
  setPanel: (side, state) => {
    const current = get().settings;
    const prev = current.layout[side];
    if (prev.size === state.size && prev.collapsed === state.collapsed) return;
    set({ settings: { ...current, layout: { ...current.layout, [side]: state } } });
    // 拖动分栏时会连续触发，合并后再写
    pendingLayout = { ...pendingLayout, [side]: state };
    clearTimeout(layoutTimer);
    layoutTimer = setTimeout(() => {
      const layout = pendingLayout;
      pendingLayout = {};
      persist({ layout });
    }, LAYOUT_SAVE_DELAY);
  },
}));
