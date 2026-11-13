import { frameCount } from '@allay/engine/frames';
import { Button } from '@allay/ui/components/button';
import { Pause, Play, Repeat, SkipBack } from 'lucide-react';
import { useCallback, useEffect, useRef, type PointerEvent as ReactPointerEvent, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { usePreviewStore } from '../../stores/previewStore';
import { useProjectStore } from '../../stores/projectStore';
import { useTransportStore } from '../../stores/transportStore';

// 播放条（6.4）：48 px。M1：播放、暂停、回到开头、循环、拖动时间轴、时间码与帧号。
// 色段、可拖的分界线、剪辑点标记在 M4。

function formatTime(t: number): string {
  const cs = Math.floor(t * 100 + 1e-6);
  const s = Math.floor(cs / 100);
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}.${String(cs % 100).padStart(2, '0')}`;
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
  const { t } = useTranslation();
  const time = useTransportStore((s) => s.time);
  const duration = useTransportStore((s) => s.duration);
  const playing = useTransportStore((s) => s.playing);
  const loop = useTransportStore((s) => s.loop);
  const output = useProjectStore((s) => s.output);
  const ready = usePreviewStore((s) => s.status.kind === 'ready');
  const trackRef = useRef<HTMLDivElement>(null);
  usePlayback();

  const total = duration > 0 ? frameCount(duration, output.fps) : 0;
  const frame = duration > 0 ? Math.min(total - 1, Math.round(time * output.fps)) : 0;
  const progress = duration > 0 ? time / duration : 0;

  const togglePlay = () => {
    const s = useTransportStore.getState();
    if (!s.playing && s.time >= s.duration) s.setTime(0);
    s.setPlaying(!s.playing);
  };

  // 拖动时间轴：按下即暂停，吸附到帧；拖动时不出声（5.5）
  const seekTo = useCallback(
    (clientX: number) => {
      const track = trackRef.current;
      const s = useTransportStore.getState();
      if (!track || s.duration <= 0) return;
      const rect = track.getBoundingClientRect();
      const x = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
      const fps = useProjectStore.getState().output.fps;
      s.setTime(Math.min(s.duration, Math.round(x * s.duration * fps) / fps));
    },
    [],
  );
  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!ready) return;
    useTransportStore.getState().setPlaying(false);
    e.currentTarget.setPointerCapture(e.pointerId);
    seekTo(e.clientX);
  };
  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.currentTarget.hasPointerCapture(e.pointerId)) seekTo(e.clientX);
  };
  const onKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    const s = useTransportStore.getState();
    const step = (e.shiftKey ? 10 : 1) / output.fps;
    if (e.key === 'ArrowRight') s.setTime(s.time + step);
    else if (e.key === 'ArrowLeft') s.setTime(s.time - step);
    else if (e.key === 'Home') s.setTime(0);
    else if (e.key === 'End') s.setTime(s.duration);
    else return;
    e.preventDefault();
    s.setPlaying(false);
  };

  return (
    <div role="toolbar" aria-label={t('transport.region')} className="flex h-12 shrink-0 items-center gap-1 border-t bg-surface-1 px-3">
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
        className={loop ? 'text-primary' : 'text-fg-muted'}
        onClick={() => useTransportStore.getState().setLoop(!loop)}
      >
        <Repeat />
      </Button>
      <span data-testid="transport-time" className="tabular-nums ml-2 text-sm">
        {formatTime(time)}
      </span>
      <span data-testid="transport-frame" className="tabular-nums ml-2 text-xs text-fg-muted">
        F{frame}/{Math.max(0, total - 1)}
      </span>
      <div
        ref={trackRef}
        data-testid="transport-track"
        role="slider"
        tabIndex={ready ? 0 : -1}
        aria-label={t('transport.scrub')}
        aria-valuemin={0}
        aria-valuemax={Math.max(0, total - 1)}
        aria-valuenow={frame}
        aria-disabled={!ready}
        className="relative mx-3 h-6 flex-1 cursor-pointer touch-none outline-none focus-visible:ring-2 focus-visible:ring-ring"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onKeyDown={onKeyDown}
      >
        <div className="absolute inset-x-0 top-1/2 h-2 -translate-y-1/2 rounded-full bg-surface-3" />
        <div className="absolute left-0 top-1/2 h-2 -translate-y-1/2 rounded-full bg-primary" style={{ width: `${progress * 100}%` }} />
        <div className="absolute top-1/2 size-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-primary bg-surface-1" style={{ left: `${progress * 100}%` }} />
      </div>
      <span className="tabular-nums rounded-md border px-2 py-0.5 text-xs text-fg-muted">
        {output.width}×{output.height} · {output.fps}fps
      </span>
    </div>
  );
}
