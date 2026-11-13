// 音频 cue 的调度（docs/05-export.md 5.5、02-engine.md 2.10）。这一段只写一份：
// 预览时传实时的 AudioContext，导出时传 OfflineAudioContext，两边走同一条 buffer → gain → pan 的链路。
import type { AudioCue } from '@allay/template-sdk';

/** 一个能播的 cue：引擎选定的变体已经解码成 AudioBuffer */
export interface CueVoice {
  cue: AudioCue;
  buffer: AudioBuffer;
}

export interface ScheduleOptions {
  /** 时间轴上的起点（秒）：只调度 at ≥ from 的 cue（5.5“播放从 t 开始就调度所有 at ≥ t 的 cue”） */
  from: number;
  /** from 对应的上下文时刻（ctx.currentTime 的刻度） */
  startAt: number;
  /** 时间轴的终点（秒）：声音在这里截断，不拖到下一轮；不给时放完为止 */
  until?: number;
}

/** 预览和导出共用的数值规则：变体的系数乘到模板给的值上，再钳制到 Web Audio 接受的范围 */
export function voiceParams(cue: AudioCue): { gain: number; rate: number; pan: number } {
  const v = cue.variant;
  const finite = (x: number, d: number) => (Number.isFinite(x) ? x : d);
  return {
    gain: Math.max(0, finite(cue.gain, 1) * (v?.volume ?? 1)),
    rate: Math.min(16, Math.max(1 / 16, finite(cue.rate, 1) * (v?.pitch ?? 1))),
    pan: Math.min(1, Math.max(-1, finite(cue.pan, 0))),
  };
}

/**
 * 把 cue 排进上下文：AudioBufferSourceNode（playbackRate = rate）→ GainNode → StereoPannerNode → destination，
 * 在 at 秒开始（5.5）。返回建好的音源，调用方停止时用。
 */
export function scheduleCues(ctx: BaseAudioContext, destination: AudioNode, voices: readonly CueVoice[], opts: ScheduleOptions): AudioBufferSourceNode[] {
  const sources: AudioBufferSourceNode[] = [];
  for (const { cue, buffer } of voices) {
    if (!(cue.at >= opts.from)) continue;
    if (opts.until !== undefined && cue.at >= opts.until) continue;
    const p = voiceParams(cue);
    if (p.gain <= 0) continue;
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.playbackRate.value = p.rate;
    const gain = ctx.createGain();
    gain.gain.value = p.gain;
    const pan = ctx.createStereoPanner();
    pan.pan.value = p.pan;
    source.connect(gain).connect(pan).connect(destination);
    const when = opts.startAt + (cue.at - opts.from);
    source.start(Math.max(0, when));
    if (opts.until !== undefined) source.stop(Math.max(0, opts.startAt + (opts.until - opts.from)));
    source.onended = () => {
      source.disconnect();
      gain.disconnect();
      pan.disconnect();
    };
    sources.push(source);
  }
  return sources;
}
