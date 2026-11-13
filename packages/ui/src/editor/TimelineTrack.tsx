import { useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent } from 'react';

// Transport 的时间轴（6.4）：按 timeline.segments 画出色段，段与段之间的分界线可以拖动（改左边那一段的 duration 参数，
// 受它的 min/max 限制，4.3）；cutTime 处有一个菱形标记，悬停提示“剪辑点”；播放头可拖，悬停显示时间。
// 一次拖动（分界线或播放头）只算一次连续操作：onGesture('start') … onGesture('end')。

export interface TimelineSegment {
  key: string;
  label: string;
  /** 这一段的时长（秒） */
  duration: number;
  min: number;
  max: number;
}

export interface TimelineTrackProps {
  duration: number;
  time: number;
  fps: number;
  /** 各段之和不等于 duration 时不画色段（4.3） */
  segments: readonly TimelineSegment[];
  cutTime: number | null;
  disabled?: boolean;
  labels: { scrub: string; cut: string; boundary(left: string, right: string): string };
  formatTime(t: number): string;
  onSeek(t: number): void;
  onSeekStart?(): void;
  onSegmentChange(key: string, duration: number): void;
  onGesture(phase: 'start' | 'end'): void;
}

const SEGMENT_COLORS = ['var(--primary)', 'var(--allay-deep)', 'var(--amethyst)', 'var(--success)', 'var(--warning)'];

export function segmentsMatch(segments: readonly TimelineSegment[], duration: number): boolean {
  if (segments.length === 0) return false;
  const sum = segments.reduce((a, s) => a + s.duration, 0);
  return Math.abs(sum - duration) < 1e-6;
}

export function TimelineTrack(props: TimelineTrackProps) {
  const { duration, time, fps, segments, cutTime, disabled, labels, formatTime, onSeek, onSeekStart, onSegmentChange, onGesture } = props;
  const trackRef = useRef<HTMLDivElement>(null);
  const [hoverX, setHoverX] = useState<number | null>(null);
  /** 拖分界线时冻结的比例尺（秒/像素）：拖动改变总时长，不能让刻度跟着变 */
  const dragRef = useRef<{ index: number; origin: number; from: number; secPerPx: number } | null>(null);
  const showSegments = segmentsMatch(segments, duration);
  const frameCount = Math.max(1, Math.round(duration * fps) + 1);
  const frame = Math.min(frameCount - 1, Math.round(time * fps));
  const pct = (t: number) => (duration > 0 ? `${(Math.min(duration, Math.max(0, t)) / duration) * 100}%` : '0%');
  const snap = (t: number) => Math.round(t * fps) / fps;

  const timeAt = (clientX: number) => {
    const rect = trackRef.current!.getBoundingClientRect();
    const x = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
    return Math.min(duration, snap(x * duration));
  };

  const onTrackDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (disabled || duration <= 0 || e.button !== 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    onSeekStart?.();
    onSeek(timeAt(e.clientX));
  };
  const onTrackMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const rect = trackRef.current!.getBoundingClientRect();
    setHoverX(e.clientX - rect.left);
    if (e.currentTarget.hasPointerCapture(e.pointerId)) onSeek(timeAt(e.clientX));
  };
  const onTrackKey = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    const step = (e.shiftKey ? 10 : 1) / fps;
    if (e.key === 'ArrowRight') onSeek(Math.min(duration, snap(time + step)));
    else if (e.key === 'ArrowLeft') onSeek(Math.max(0, snap(time - step)));
    else if (e.key === 'Home') onSeek(0);
    else if (e.key === 'End') onSeek(duration);
    else return;
    e.preventDefault();
    e.stopPropagation();
    onSeekStart?.();
  };

  // ---- 分界线 ----
  let acc = 0;
  const bounds = segments.map((s) => (acc += s.duration));
  const onBoundaryDown = (index: number) => (e: ReactPointerEvent<HTMLDivElement>) => {
    if (disabled) return;
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    const rect = trackRef.current!.getBoundingClientRect();
    dragRef.current = { index, origin: e.clientX, from: segments[index]!.duration, secPerPx: duration / rect.width };
    onGesture('start');
  };
  const onBoundaryMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const d = dragRef.current;
    if (!d || !e.currentTarget.hasPointerCapture(e.pointerId)) return;
    const seg = segments[d.index]!;
    const next = Math.min(seg.max, Math.max(seg.min, snap(d.from + (e.clientX - d.origin) * d.secPerPx)));
    if (next !== seg.duration) onSegmentChange(seg.key, next);
  };
  const onBoundaryUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!dragRef.current) return;
    e.currentTarget.releasePointerCapture(e.pointerId);
    dragRef.current = null;
    onGesture('end');
  };
  const onBoundaryKey = (index: number) => (e: ReactKeyboardEvent<HTMLDivElement>) => {
    const seg = segments[index]!;
    const step = (e.shiftKey ? 10 : 1) / fps;
    let next: number;
    if (e.key === 'ArrowRight' || e.key === 'ArrowUp') next = seg.duration + step;
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') next = seg.duration - step;
    else return;
    e.preventDefault();
    e.stopPropagation();
    onSegmentChange(seg.key, Math.min(seg.max, Math.max(seg.min, snap(next))));
  };

  const hoverTime = hoverX !== null && trackRef.current ? Math.min(duration, snap((hoverX / trackRef.current.getBoundingClientRect().width) * duration)) : null;

  return (
    // 外层只负责定位；时间轴本身（可拖、可聚焦的 slider）和分界线是兄弟元素，不互相嵌套（axe 的 nested-interactive）
    <div className="group/track relative h-8 min-w-0 flex-1">
      <div
        ref={trackRef}
        data-testid="transport-track"
        role="slider"
        tabIndex={disabled ? -1 : 0}
        aria-label={labels.scrub}
        aria-valuemin={0}
        aria-valuemax={Math.max(0, frameCount - 1)}
        aria-valuenow={frame}
        aria-valuetext={formatTime(time)}
        aria-disabled={disabled}
        className="absolute inset-0 cursor-pointer touch-none outline-none focus-visible:rounded-md focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--ring)"
        onPointerDown={onTrackDown}
        onPointerMove={onTrackMove}
        onPointerLeave={() => setHoverX(null)}
        onKeyDown={onTrackKey}
      />
      {/* 底轨与色段 */}
      <div className="pointer-events-none absolute inset-x-0 top-1/2 h-3 -translate-y-1/2 overflow-hidden rounded-sm bg-surface-3">
        {showSegments &&
          segments.map((s, i) => (
            <div
              key={s.key}
              data-testid={`timeline-segment-${s.key}`}
              title={s.label}
              className="absolute inset-y-0"
              style={{ left: pct(bounds[i]! - s.duration), width: pct(s.duration), background: `color-mix(in srgb, ${SEGMENT_COLORS[i % SEGMENT_COLORS.length]} 38%, transparent)` }}
            />
          ))}
        <div className="absolute inset-y-0 left-0 bg-foreground/10" style={{ width: pct(time) }} />
      </div>
      {/* 分界线（最后一段的右端就是终点，不能拖） */}
      {showSegments &&
        segments.slice(0, -1).map((s, i) => (
          <div
            key={`b-${s.key}`}
            role="slider"
            tabIndex={disabled ? -1 : 0}
            aria-label={labels.boundary(s.label, segments[i + 1]!.label)}
            aria-valuemin={s.min}
            aria-valuemax={s.max}
            aria-valuenow={s.duration}
            aria-valuetext={`${s.duration.toFixed(2)} s`}
            data-testid={`timeline-boundary-${i}`}
            className="absolute top-1/2 z-10 flex h-6 w-3 -translate-x-1/2 -translate-y-1/2 cursor-ew-resize items-center justify-center outline-none focus-visible:outline-2 focus-visible:outline-(--ring)"
            style={{ left: pct(bounds[i]!) }}
            onPointerDown={onBoundaryDown(i)}
            onPointerMove={onBoundaryMove}
            onPointerUp={onBoundaryUp}
            onPointerCancel={onBoundaryUp}
            onKeyDown={onBoundaryKey(i)}
          >
            <span className="h-5 w-0.5 rounded-full bg-fg-muted" />
          </div>
        ))}
      {/* 剪辑点 */}
      {cutTime !== null && duration > 0 && (
        <div className="absolute top-0 z-10 -translate-x-1/2" style={{ left: pct(cutTime) }} title={labels.cut} data-testid="timeline-cut">
          <span className="block size-2 rotate-45 bg-allay shadow-[0_0_0_1px_var(--surface-1)]" />
          <span className="sr-only">{labels.cut}</span>
        </div>
      )}
      {/* 播放头 */}
      <div className="pointer-events-none absolute inset-y-0.5 z-20 w-0.5 -translate-x-1/2 rounded-full bg-foreground" style={{ left: pct(time) }} data-testid="timeline-playhead" />
      {/* 悬停时间 */}
      {hoverTime !== null && !disabled && (
        <div
          className="pointer-events-none absolute -top-6 z-30 -translate-x-1/2 rounded-sm bg-foreground px-1 text-2xs text-background tabular-nums opacity-0 transition-opacity duration-(--dur-1) group-hover/track:opacity-100"
          style={{ left: hoverX! }}
          aria-hidden="true"
        >
          {formatTime(hoverTime)}
        </div>
      )}
    </div>
  );
}

export function timelineFrameLabel(frame: number, total: number): string {
  return `F${frame}/${Math.max(0, total - 1)}`;
}

