import { FilmStrip, Scissors, SpeakerSimpleHigh } from '@phosphor-icons/react';
import { cn } from 'cn';
import { useLayoutEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import { ICON, ICON_WEIGHT } from '../lib/icons';

// Transport 的多轨时间轴（6.4）：左侧轨道名列，右侧每条轨道是一条凹槽圆角条。
// - 帧刻度（等宽数字）；
// - 阶段轨：按 timeline.segments 画出进入/停留/退出的圆角色块（名称与时长），段与段之间的分界线可以拖动
//   （改左边那一段的 duration 参数，受它的 min/max 限制，4.3）；
// - 音效轨：按模板的 audioCues 画竖条（只读）；没有 cue 时整条置灰；
// - 剪辑点轨：琥珀菱形加帧号；没有剪辑点（叠加层模板）时不显示这一轨；
// - 播放头：1.5 px 强调色竖线贯穿各轨，顶部是带当前帧号的小牌；整个轨道区可按下拖动（键盘：左右键逐帧、Shift 十帧、Home/End）。
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
  /** 音效 cue 的时间（秒）；空数组表示这个模板没有音效 */
  cues: readonly number[];
  disabled?: boolean;
  labels: { scrub: string; cut: string; boundary(left: string, right: string): string; stages: string; sound: string; cutTrack: string };
  formatTime(t: number): string;
  onSeek(t: number): void;
  onSeekStart?(): void;
  onSegmentChange(key: string, duration: number): void;
  onGesture(phase: 'start' | 'end'): void;
}

const SEGMENT_COLORS = ['var(--stage-enter)', 'var(--stage-hold)', 'var(--stage-exit)', 'var(--cue)', 'var(--amethyst)'];
/** 刻度标签之间至少这么宽（px） */
const LABEL_SPACING = 44;
const LABEL_STEPS = [1, 2, 3, 5, 6, 10, 12, 15, 20, 30, 60, 120, 300, 600];

export function segmentsMatch(segments: readonly TimelineSegment[], duration: number): boolean {
  if (segments.length === 0) return false;
  const sum = segments.reduce((a, s) => a + s.duration, 0);
  return Math.abs(sum - duration) < 1e-6;
}

function TrackName({ icon, children, muted, row }: { icon: ReactNode; children: ReactNode; muted?: boolean; row: number }) {
  return (
    <div className={cn('col-start-1 flex min-w-0 items-center gap-2 pl-3.5 text-fg-muted', muted && 'text-fg-subtle')} style={{ gridRow: row }}>
      <span className="shrink-0 text-fg-faint">{icon}</span>
      <span className="truncate">{children}</span>
    </div>
  );
}

export function TimelineTrack(props: TimelineTrackProps) {
  const { duration, time, fps, segments, cutTime, cues, disabled, labels, formatTime, onSeek, onSeekStart, onSegmentChange, onGesture } = props;
  const lanesRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  /** 拖分界线时冻结的比例尺（秒/像素）：拖动改变总时长，不能让刻度跟着变 */
  const dragRef = useRef<{ index: number; origin: number; from: number; secPerPx: number } | null>(null);
  const showSegments = segmentsMatch(segments, duration);
  const frameCount = Math.max(1, Math.round(duration * fps) + 1);
  const lastFrame = frameCount - 1;
  const frame = Math.min(lastFrame, Math.round(time * fps));
  const pct = (t: number) => (duration > 0 ? `${(Math.min(duration, Math.max(0, t)) / duration) * 100}%` : '0%');
  const snap = (t: number) => Math.round(t * fps) / fps;

  useLayoutEffect(() => {
    const el = lanesRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setWidth(el.getBoundingClientRect().width));
    ro.observe(el);
    setWidth(el.getBoundingClientRect().width);
    return () => ro.disconnect();
  }, []);

  const timeAt = (clientX: number) => {
    const rect = lanesRef.current!.getBoundingClientRect();
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
    const rect = lanesRef.current!.getBoundingClientRect();
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

  // ---- 刻度：标签步长让标签之间至少隔 LABEL_SPACING ----
  const pxPerFrame = lastFrame > 0 ? width / lastFrame : 0;
  const labelStep = LABEL_STEPS.find((s) => s * pxPerFrame >= LABEL_SPACING) ?? Math.max(1, lastFrame);
  const minorStep = labelStep % 2 === 0 ? labelStep / 2 : labelStep;
  const ticks: { f: number; label: boolean }[] = [];
  if (width > 0 && lastFrame > 0) for (let f = 0; f <= lastFrame; f += minorStep) ticks.push({ f, label: f % labelStep === 0 });

  const hasCut = cutTime !== null && duration > 0;
  const cutFrame = hasCut ? Math.round(cutTime * fps) : 0;
  const rows = ['24px', '40px', '30px', ...(hasCut ? ['30px'] : [])].join(' ');

  return (
    <div className="grid min-h-0 flex-1 grid-cols-[124px_1fr] gap-y-1 pr-3 pb-3" style={{ gridTemplateRows: rows }} data-testid="timeline">
      {/* 轨道区（右列）：刻度、各轨和覆盖其上的拖动层、播放头都以它为坐标 */}
      <div ref={lanesRef} className="group/track relative col-start-2 row-span-full row-start-1 min-w-0">
        <div className="pointer-events-none absolute inset-x-0 top-0 h-6 num text-2xs text-fg-subtle" aria-hidden="true">
          {ticks.map(({ f, label }) =>
            label ? (
              <span key={f} className="absolute top-0.5 -translate-x-1/2" style={{ left: pct(f / fps) }}>
                {f}
              </span>
            ) : (
              <span key={f} className="absolute bottom-0 h-[5px] w-px bg-control-hi" style={{ left: pct(f / fps) }} />
            ),
          )}
        </div>
      </div>

      <TrackName row={2} icon={<FilmStrip size={ICON.sm} weight={ICON_WEIGHT.active} />}>{labels.stages}</TrackName>
      <div className="relative col-start-2 row-start-2 rounded-lg bg-well">
        {showSegments &&
          segments.map((s, i) => {
            const first = i === 0;
            const last = i === segments.length - 1;
            // 窄的色块（停留）只居中显示名称；再窄就什么都不写
            const px = duration > 0 ? (s.duration / duration) * width : 0;
            const narrow = px < 110;
            return (
              <div
                key={s.key}
                data-testid={`timeline-segment-${s.key}`}
                title={s.label}
                className={cn('pointer-events-none absolute inset-y-[3px] flex min-w-0 items-center gap-2 overflow-hidden rounded-md font-medium text-stage-foreground', narrow ? 'justify-center px-2' : 'px-3')}
                style={{
                  left: first ? 0 : `calc(${pct(bounds[i]! - s.duration)} + 1px)`,
                  width: `calc(${pct(s.duration)} - ${first || last ? 1 : 2}px)`,
                  background: SEGMENT_COLORS[i % SEGMENT_COLORS.length],
                }}
              >
                <span className="absolute inset-y-[9px] left-1 w-[3px] rounded-full bg-stage-foreground/55" />
                <span className="absolute inset-y-[9px] right-1 w-[3px] rounded-full bg-stage-foreground/55" />
                {px >= 36 && <span className="truncate">{s.label}</span>}
                {!narrow && <span className="shrink-0 num font-normal opacity-75">{s.duration.toFixed(2)} s</span>}
              </div>
            );
          })}
      </div>

      <TrackName row={3} icon={<SpeakerSimpleHigh size={ICON.sm} weight={ICON_WEIGHT.active} />} muted={cues.length === 0}>
        {labels.sound}
      </TrackName>
      <div className={cn('relative col-start-2 row-start-3 rounded-lg bg-well', cues.length === 0 && 'opacity-50')} data-testid="timeline-cues">
        {cues.map((c, i) => (
          <span key={i} className="pointer-events-none absolute inset-y-[9px] w-[3px] -translate-x-1/2 rounded-full bg-cue" style={{ left: pct(c) }} />
        ))}
      </div>

      {hasCut && (
        <>
          <TrackName row={4} icon={<Scissors size={ICON.sm} weight={ICON_WEIGHT.active} />}>{labels.cutTrack}</TrackName>
          <div className="relative col-start-2 row-start-4 rounded-lg bg-well">
            <div className="pointer-events-none absolute top-[9px] flex items-center" style={{ left: pct(cutTime) }} title={labels.cut} data-testid="timeline-cut">
              <span className="block size-[11px] -translate-x-1/2 rotate-45 rounded-[2px] bg-mark" />
              <span className="ml-1.5 num text-xs text-mark">{cutFrame}</span>
              <span className="sr-only">{labels.cut}</span>
            </div>
          </div>
        </>
      )}

      {/* 拖动层与播放头：覆盖轨道区（刻度以下所有轨） */}
      <div className="pointer-events-none relative col-start-2 row-span-full row-start-1">
        <div
          data-testid="transport-track"
          role="slider"
          tabIndex={disabled ? -1 : 0}
          aria-label={labels.scrub}
          aria-valuemin={0}
          aria-valuemax={lastFrame}
          aria-valuenow={frame}
          aria-valuetext={formatTime(time)}
          aria-disabled={disabled}
          className="pointer-events-auto absolute inset-0 cursor-pointer touch-none rounded-lg outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--ring)"
          onPointerDown={onTrackDown}
          onPointerMove={onTrackMove}
          onKeyDown={onTrackKey}
        />
        {/* 分界线（最后一段的右端就是终点，不能拖）：命中区落在阶段轨上 */}
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
              className="pointer-events-auto absolute top-7 z-10 h-10 w-3 -translate-x-1/2 cursor-ew-resize rounded-sm outline-none focus-visible:outline-2 focus-visible:outline-(--ring)"
              style={{ left: pct(bounds[i]!) }}
              onPointerDown={onBoundaryDown(i)}
              onPointerMove={onBoundaryMove}
              onPointerUp={onBoundaryUp}
              onPointerCancel={onBoundaryUp}
              onKeyDown={onBoundaryKey(i)}
            />
          ))}
        <div className="absolute inset-y-0 z-20 w-0" style={{ left: pct(time) }} data-testid="timeline-playhead">
          <span className="absolute top-[22px] bottom-0 -left-[0.75px] w-[1.5px] bg-primary" />
          <span data-testid="timeline-playhead-frame" className="absolute top-0.5 left-0 -translate-x-1/2 rounded-[5px] bg-primary px-1.5 py-0.5 num text-2xs font-medium text-primary-foreground">
            {frame}
          </span>
        </div>
      </div>
    </div>
  );
}

export function timelineFrameLabel(frame: number, total: number): string {
  return `F${frame}/${Math.max(0, total - 1)}`;
}
