import { frameCount } from '@allay/engine/frames';
import { localize } from '@allay/template-sdk';
import { Button } from '@allay/ui/components/button';
import { Popover, PopoverContent, PopoverTitle, PopoverTrigger } from '@allay/ui/components/popover';
import { TimelineTrack, timelineFrameLabel, type TimelineSegment } from '@allay/ui/editor';
import { Pause, Play, Repeat, SkipBack, Sparkles, Volume2, VolumeX } from 'lucide-react';
import { useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { usePreviewStore } from '../../stores/previewStore';
import { beginGesture, endGesture, useProjectStore } from '../../stores/projectStore';
import { useTransportStore } from '../../stores/transportStore';
import { useUiStore } from '../../stores/uiStore';
import { togglePlay } from '../commands/commands';
import { OutputSettingsForm } from '../settings/OutputSettingsForm';

// 播放条（6.4，48 px）：回到开头、播放/暂停、循环开关；时间码“秒.帧”和 F当前帧/总帧数；
// 时间轴（色段、可拖的分界线、剪辑点菱形标记、可拖的播放头）；右侧输出规格徽标（点开是输出设置）、高质量预览、静音。

/** 时间码：秒.帧（6.4），例如 00:00.36 是第 0 秒第 36 帧 */
export function formatTimecode(t: number, fps: number): string {
  const totalFrames = Math.round(t * fps);
  const s = Math.floor(totalFrames / fps);
  const f = totalFrames - s * fps;
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}.${String(f).padStart(2, '0')}`;
}

/** 播放：按真实时间推进当前时间（这是界面的时钟，模板的 update 只依赖传进去的 t） */
function usePlayback() {
  const playing = useTransportStore((s) => s.playing);
  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    let last: number | null = null;
    const tick = (now: number) => {
      const s = useTransportStore.getState();
      if (last !== null && s.duration > 0) {
        let next = s.time + (now - last) / 1000;
        if (next >= s.duration) {
          if (s.loop) next = next % s.duration;
          else {
            s.setTime(s.duration);
            s.setPlaying(false);
            return;
          }
        }
        s.setTime(next);
      }
      last = now;
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing]);
}

export function TransportBar() {
  const { t, i18n } = useTranslation();
  const time = useTransportStore((s) => s.time);
  const duration = useTransportStore((s) => s.duration);
  const cutTime = useTransportStore((s) => s.cutTime);
  const playing = useTransportStore((s) => s.playing);
  const loop = useTransportStore((s) => s.loop);
  const output = useProjectStore((s) => s.output);
  const template = useProjectStore((s) => s.template);
  const params = useProjectStore((s) => s.params);
  const ready = usePreviewStore((s) => s.status.kind === 'ready');
  const hq = useUiStore((s) => s.settings.editor.hqPreview);
  const muted = useUiStore((s) => s.settings.editor.muted);
  usePlayback();

  const total = duration > 0 ? frameCount(duration, output.fps) : 0;
  const frame = duration > 0 ? Math.min(total - 1, Math.round(time * output.fps)) : 0;

  // timeline.segments：把几个 duration 参数画成首尾相接的色段（4.3）
  const segments = useMemo<TimelineSegment[]>(() => {
    const segs = template?.manifest.timeline?.segments ?? [];
    return segs.flatMap((s) => {
      const def = template!.params.find((p) => p.key === s.param);
      if (!def || def.type !== 'duration') return [];
      const v = params[s.param];
      return [{ key: s.param, label: localize(s.label ?? def.label, i18n.language), duration: typeof v === 'number' ? v : def.default, min: def.min, max: def.max }];
    });
  }, [template, params, i18n.language]);

  return (
    <div role="toolbar" aria-label={t('transport.region')} className="flex h-12 shrink-0 items-center gap-1 border-t bg-surface-1 px-2" data-testid="transport">
      <Button variant="ghost" size="icon" aria-label={t('transport.toStart')} disabled={!ready} onClick={() => useTransportStore.getState().setTime(0)}>
        <SkipBack />
      </Button>
      <Button variant="ghost" size="icon" data-testid="transport-play" aria-label={playing ? t('transport.pause') : t('transport.play')} disabled={!ready} onClick={togglePlay}>
        {playing ? <Pause /> : <Play />}
      </Button>
      <Button
        variant="ghost"
        size="icon"
        aria-label={t('transport.loop')}
        aria-pressed={loop}
        className={loop ? 'text-primary-text' : 'text-fg-muted'}
        onClick={() => useTransportStore.getState().setLoop(!loop)}
        data-testid="transport-loop"
      >
        <Repeat />
      </Button>
      <div className="ml-1 flex w-[64px] shrink-0 flex-col leading-tight">
        <span data-testid="transport-time" className="text-sm tabular-nums" aria-label={t('transport.time')}>
          {formatTimecode(time, output.fps)}
        </span>
        <span data-testid="transport-frame" className="text-2xs text-fg-muted tabular-nums">
          {timelineFrameLabel(frame, total)}
        </span>
      </div>
      <div className="mx-2 flex min-w-[120px] flex-1">
        <TimelineTrack
          duration={duration}
          time={time}
          fps={output.fps}
          segments={segments}
          cutTime={cutTime}
          disabled={!ready}
          labels={{ scrub: t('transport.scrub'), cut: t('transport.cut'), boundary: (a, b) => t('transport.boundary', { left: a, right: b }) }}
          formatTime={(x) => formatTimecode(x, output.fps)}
          onSeekStart={() => useTransportStore.getState().setPlaying(false)}
          onSeek={(x) => useTransportStore.getState().setTime(x)}
          onSegmentChange={(key, d) => useProjectStore.getState().setParams({ [key]: d }, i18n.language)}
          onGesture={(phase) => (phase === 'start' ? beginGesture() : endGesture())}
        />
      </div>
      <Popover>
        <PopoverTrigger
          data-testid="output-badge"
          aria-label={t('output.title')}
          className="inline-flex h-6 shrink-0 items-center rounded-md border px-2 text-xs whitespace-nowrap text-fg-muted tabular-nums hover:bg-surface-2 hover:text-foreground"
        >
          {output.width}×{output.height} · {output.fps}fps
        </PopoverTrigger>
        <PopoverContent side="top" align="end" className="w-80">
          <PopoverTitle className="mb-3 text-sm font-semibold">{t('output.title')}</PopoverTitle>
          <OutputSettingsForm />
        </PopoverContent>
      </Popover>
      <Button
        variant="ghost"
        size="icon"
        aria-label={t('transport.hq')}
        title={t('transport.hqHint')}
        aria-pressed={hq}
        className={hq ? 'text-primary-text' : 'text-fg-muted'}
        data-testid="transport-hq"
        onClick={() => useUiStore.getState().setEditor({ hqPreview: !hq })}
      >
        <Sparkles />
      </Button>
      <Button
        variant="ghost"
        size="icon"
        aria-label={muted ? t('transport.unmute') : t('transport.mute')}
        aria-pressed={muted}
        className="text-fg-muted"
        data-testid="transport-mute"
        onClick={() => useUiStore.getState().setEditor({ muted: !muted })}
      >
        {muted ? <VolumeX /> : <Volume2 />}
      </Button>
    </div>
  );
}
