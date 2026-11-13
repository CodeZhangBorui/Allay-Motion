import { create } from 'zustand';

// transportStore（1.7）：当前时间、是否播放、是否循环、时长、剪辑点。不可撤销。

interface TransportState {
  /** 秒 */
  time: number;
  playing: boolean;
  loop: boolean;
  /** 模板装载后才知道；0 表示还没有 */
  duration: number;
  cutTime: number | null;
  setTime(time: number): void;
  setPlaying(playing: boolean): void;
  setLoop(loop: boolean): void;
  setTimeline(duration: number, cutTime: number | null): void;
}

export const useTransportStore = create<TransportState>((set, get) => ({
  time: 0,
  playing: false,
  loop: true,
  duration: 0,
  cutTime: null,
  setTime: (time) => set({ time: Math.min(get().duration, Math.max(0, Number.isFinite(time) ? time : 0)) }),
  setPlaying: (playing) => set({ playing }),
  setLoop: (loop) => set({ loop }),
  setTimeline: (duration, cutTime) => set((s) => ({ duration, cutTime, time: Math.min(s.time, duration) })),
}));
