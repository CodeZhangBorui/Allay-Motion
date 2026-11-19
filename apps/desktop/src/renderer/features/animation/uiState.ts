// 动画工作区不持久化的界面状态：选中的图层和关键帧、代码视图开没开、时间轴里展开了哪些图层。
import { create } from 'zustand';
import type { AnimProp } from '../../../shared/animation/schema';

export interface KeySelection {
  layer: string;
  prop: AnimProp;
  /** 关键帧的时刻（按时刻认，增删关键帧后下标会变） */
  t: number;
}

interface AnimationUiState {
  layer: string | null;
  key: KeySelection | null;
  codeOpen: boolean;
  expanded: Record<string, boolean>;
  select(sel: { layer: string | null; key: KeySelection | null }): void;
  setCodeOpen(open: boolean): void;
  toggleExpanded(layer: string): void;
}

export const useAnimationUi = create<AnimationUiState>((set) => ({
  layer: null,
  key: null,
  codeOpen: false,
  expanded: {},
  select: (sel) => set(sel),
  setCodeOpen: (codeOpen) => set({ codeOpen }),
  toggleExpanded: (layer) => set((s) => ({ expanded: { ...s.expanded, [layer]: !s.expanded[layer] } })),
}));
