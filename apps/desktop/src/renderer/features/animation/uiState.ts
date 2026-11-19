// 动画工作区不持久化的界面状态：选中的图层、关键帧（可以多选）、音效，时间轴的视图（关键帧 / 曲线），
// 吸附开关，关键帧的剪贴板，代码面板开没开，时间轴里展开了哪些图层。
import { create } from 'zustand';
import type { KeyClipboard, KeyRef } from '../../../shared/animation/edit';
import { sameKey } from '../../../shared/animation/edit';
import type { AnimProp } from '../../../shared/animation/schema';

export interface KeySelection {
  layer: string;
  prop: AnimProp;
  /** 关键帧的时刻（按时刻认，增删关键帧后下标会变） */
  t: number;
}

export type TimelineView = 'keys' | 'graph';
export type GraphMode = 'value' | 'speed';

interface AnimationUiState {
  layer: string | null;
  /** 最后点中的那个关键帧（右栏显示它的数值和缓动） */
  key: KeySelection | null;
  /** 选中的全部关键帧（多选、框选） */
  keys: KeyRef[];
  /** 选中的音效 id */
  sound: string | null;
  codeOpen: boolean;
  expanded: Record<string, boolean>;
  view: TimelineView;
  graphMode: GraphMode;
  /** 曲线视图里每条曲线各自的纵轴 */
  graphSeparate: boolean;
  /** 拖动时吸附到帧、播放头、别的关键帧（按住 Alt 临时关掉） */
  snap: boolean;
  clipboard: KeyClipboard | null;
  select(sel: { layer: string | null; key: KeySelection | null }): void;
  /** 选中一组关键帧；additive 时加进现有的选择（再点一次已选中的就取消它） */
  selectKeys(keys: readonly KeyRef[], mode?: 'replace' | 'add' | 'toggle'): void;
  selectSound(id: string | null): void;
  setCodeOpen(open: boolean): void;
  toggleExpanded(layer: string): void;
  setView(view: TimelineView): void;
  setGraphMode(mode: GraphMode): void;
  setGraphSeparate(on: boolean): void;
  setSnap(on: boolean): void;
  setClipboard(clip: KeyClipboard | null): void;
}

export const useAnimationUi = create<AnimationUiState>((set) => ({
  layer: null,
  key: null,
  keys: [],
  sound: null,
  codeOpen: false,
  expanded: {},
  view: 'keys',
  graphMode: 'value',
  graphSeparate: false,
  snap: true,
  clipboard: null,
  select: (sel) => set({ ...sel, keys: sel.key ? [sel.key] : [], sound: null }),
  selectKeys: (keys, mode = 'replace') =>
    set((s) => {
      let next: KeyRef[];
      if (mode === 'replace') next = [...keys];
      else if (mode === 'add') next = [...s.keys, ...keys.filter((k) => !s.keys.some((x) => sameKey(x, k)))];
      else {
        next = [...s.keys];
        for (const k of keys) {
          const i = next.findIndex((x) => sameKey(x, k));
          if (i >= 0) next.splice(i, 1);
          else next.push(k);
        }
      }
      const last = next.at(-1) ?? null;
      return { keys: next, key: last, layer: last?.layer ?? s.layer, sound: null };
    }),
  selectSound: (sound) => set({ sound, key: null, keys: [] }),
  setCodeOpen: (codeOpen) => set({ codeOpen }),
  toggleExpanded: (layer) => set((s) => ({ expanded: { ...s.expanded, [layer]: !s.expanded[layer] } })),
  setView: (view) => set({ view }),
  setGraphMode: (graphMode) => set({ graphMode }),
  setGraphSeparate: (graphSeparate) => set({ graphSeparate }),
  setSnap: (snap) => set({ snap }),
  setClipboard: (clipboard) => set({ clipboard }),
}));
