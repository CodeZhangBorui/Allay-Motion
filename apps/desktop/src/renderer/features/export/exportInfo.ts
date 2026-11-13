// FFmpeg 与各预设的可用性（导出对话框、顶栏的格式下拉、设置页共用）。
// 绿幕 MP4 还没探测过 H.264 编码器时，第一次需要知道它能不能用就探测一次（5.3“首次需要时”），结果由主进程缓存在设置里。
import { useEffect } from 'react';
import { create } from 'zustand';
import type { ExportPreset, FfmpegInfo, H264Probe } from '../../../shared/export';

interface ExportInfoState {
  info: FfmpegInfo | null;
  /** 正在试编码（“检测编码器…”） */
  probing: boolean;
  /** 读一次（不重新探测） */
  load(): Promise<FfmpegInfo>;
  /** 需要时探测 H.264 编码器；force 为真时忽略缓存（设置页的“重新检测”） */
  probe(force: boolean): Promise<H264Probe | null>;
}

export const useExportInfo = create<ExportInfoState>((set, get) => ({
  info: null,
  probing: false,
  async load() {
    const info = await window.allay.export.ffmpegInfo();
    set({ info });
    return info;
  },
  async probe(force) {
    set({ probing: true });
    try {
      const result = await window.allay.export.probeEncoders(force);
      await get().load();
      return result;
    } finally {
      set({ probing: false });
    }
  },
}));

/** 挂载时读一次；绿幕 MP4 还没探测过时在后台探测 */
export function useEnsureExportInfo(): FfmpegInfo | null {
  const info = useExportInfo((s) => s.info);
  useEffect(() => {
    let alive = true;
    void useExportInfo
      .getState()
      .load()
      .then((i) => {
        if (alive && i.available && i.h264 === null && i.presets['greenscreen-mp4'] && !useExportInfo.getState().probing) void useExportInfo.getState().probe(false);
      });
    return () => {
      alive = false;
    };
  }, []);
  return info;
}

export type PresetState = 'ok' | 'checking' | 'ffmpeg-missing' | 'encoder-missing' | 'no-h264';

/** 一个预设现在的状态：信息还没来时当作可用（不让界面闪成禁用） */
export function presetState(info: FfmpegInfo | null, probing: boolean, preset: ExportPreset): PresetState {
  if (!info) return 'ok';
  const blocker = info.blockers[preset];
  if (blocker) return blocker;
  if (preset === 'greenscreen-mp4' && info.h264 === null && probing) return 'checking';
  return 'ok';
}

/** 不可用原因的文案键 */
export const PRESET_STATE_KEYS: Record<Exclude<PresetState, 'ok'>, string> = {
  checking: 'export.blockers.checking',
  'ffmpeg-missing': 'export.blockers.ffmpegMissing',
  'encoder-missing': 'export.blockers.encoderMissing',
  'no-h264': 'export.blockers.noH264',
};

/** 文案键里用的预设短名 */
export const PRESET_KEY: Record<ExportPreset, string> = {
  prores4444: 'prores',
  'png-sequence': 'png',
  'webm-vp9': 'webm',
  'greenscreen-mp4': 'greenscreen',
};
