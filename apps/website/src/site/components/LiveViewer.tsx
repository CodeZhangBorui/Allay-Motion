// 实时预览面板：桌面版 @allay/engine 在独立 Web Worker 中实时渲染。
// 修复并简化的交互：
// - 工具条干净地放在画布下方，绝不遮挡预览内容（无 -mt-6 遮盖）；
// - 时间轴默认支持指针拖动 + 键盘左右/Home/End 调节，pointerup/pointercancel 统一清理；
// - 用户手动点击播放/暂停、切换模板或拖动时间轴后立即停止自动轮播，绝不和用户抢状态；
// - 离开视口或开启减少动效时停止连续帧循环，只画当前静帧。
import { AllayLoader } from '@allay/mascot';
import { localize, type ParamValues } from '@allay/template-sdk';
import { Skeleton } from '@allay/ui/components/misc';
import { Pause, Play } from '@phosphor-icons/react';
import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { mcGameVersion } from '../../host/mc-pack';
import { showcaseEntries, type SiteTemplateEntry } from '../../host/templates';
import { LivePreview, hasWebgl2, type LiveState } from '../engine/runtime';
import { usePrefs } from '../prefs';

export interface LiveViewerControl {
  templateId?: string | null;
  params?: ParamValues | null;
  scrub?: number | null;
}

interface Props {
  autoCycle?: boolean;
  scrubbable?: boolean;
  hidePicker?: boolean;
  noteHidden?: boolean;
  testId?: string;
  initialId?: string;
  requestPick?: { id: string; seq: number } | null;
  control?: LiveViewerControl;
  onPick?: (id: string) => void;
  className?: string;
}

type Status = 'starting' | 'ready' | 'unsupported' | 'failed';

const STAGE_COLORS = ['var(--stage-enter)', 'var(--stage-hold)', 'var(--stage-exit)'];

export function LiveViewer({
  autoCycle = false,
  scrubbable = true,
  hidePicker = false,
  noteHidden = false,
  testId,
  initialId,
  requestPick,
  control,
  onPick,
  className,
}: Props) {
  const { t } = useTranslation();
  const { language, reducedMotion } = usePrefs();
  const entries = useMemo(() => showcaseEntries(), []);
  const [index, setIndex] = useState(() => Math.max(0, entries.findIndex((e) => e.id === (initialId ?? 'allay.builtin.block-wipe'))));
  const [status, setStatus] = useState<Status>('starting');
  const [state, setState] = useState<LiveState>({ duration: 1, cutTime: null, time: 0, playing: !reducedMotion });
  const cycling = useRef(autoCycle && !reducedMotion);
  const draggingRef = useRef(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const liveRef = useRef<LivePreview | null>(null);
  const playheadRef = useRef<HTMLDivElement>(null);
  const timeRef = useRef<HTMLSpanElement>(null);
  const sliderRef = useRef<HTMLDivElement>(null);
  const entry: SiteTemplateEntry | undefined = entries[index];

  // 启动独立引擎 Worker（离开视口自动暂停渲染）
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let disposed = false;
    let live: LivePreview | null = null;
    void (async () => {
      if (!hasWebgl2()) {
        setStatus('unsupported');
        return;
      }
      try {
        live = await LivePreview.create(canvas);
      } catch (error) {
        console.warn('[live] engine failed to start', error);
        if (!disposed) setStatus('failed');
        return;
      }
      if (disposed) {
        live.dispose();
        return;
      }
      liveRef.current = live;
      live.onLoop = () => {
        if (cycling.current) setIndex((i) => (i + 1) % entries.length);
      };
      live.subscribe((s) => {
        const p = s.duration > 0 ? Math.min(1, s.time / s.duration) : 0;
        if (playheadRef.current) playheadRef.current.style.transform = `translateX(${(p * 100).toFixed(3)}%)`;
        if (timeRef.current) timeRef.current.textContent = `${Math.min(s.time, s.duration).toFixed(2)} / ${s.duration.toFixed(2)} s`;
        if (sliderRef.current) {
          const pct = Math.round(p * 100);
          sliderRef.current.setAttribute('aria-valuenow', String(pct));
          sliderRef.current.setAttribute('aria-valuetext', `${Math.min(s.time, s.duration).toFixed(2)} s / ${s.duration.toFixed(2)} s`);
        }
        setState((prev) => (prev.duration === s.duration && prev.playing === s.playing && prev.cutTime === s.cutTime ? prev : s));
      });
      const stage = stageRef.current;
      if (stage) {
        const dpr = Math.min(2, window.devicePixelRatio || 1);
        live.resize(stage.clientWidth * dpr, stage.clientHeight * dpr);
      }
      setStatus('ready');
    })();
    return () => {
      disposed = true;
      liveRef.current = null;
      live?.dispose();
    };
  }, [entries.length]);

  // 外部（工作流 / 模板卡片）选中模板
  const controlledId = control?.templateId ?? null;
  useEffect(() => {
    if (!controlledId) return;
    const i = entries.findIndex((e) => e.id === controlledId);
    if (i >= 0) {
      cycling.current = false;
      setIndex(i);
    }
  }, [controlledId, entries]);

  useEffect(() => {
    if (!requestPick) return;
    const i = entries.findIndex((e) => e.id === requestPick.id);
    if (i >= 0) {
      cycling.current = false;
      setIndex(i);
      const live = liveRef.current;
      if (live && !reducedMotion) live.setPlaying(true, false);
    }
  }, [requestPick, entries, reducedMotion]);

  // 装载当前模板（初次切入时从剪辑点起播，首帧就有完整画面）
  const overridesRef = useRef<ParamValues | null>(null);
  overridesRef.current = control?.params ?? null;
  useEffect(() => {
    const live = liveRef.current;
    if (status !== 'ready' || !live || !entry) return;
    void live.show(entry, language, overridesRef.current ?? undefined, true).catch((error: unknown) => console.warn('[live] load failed', error));
  }, [status, entry, language]);

  // 实时参数更新（工作流第二步调参走 setParams）
  const paramsKey = control?.params ? JSON.stringify(control.params) : '';
  useEffect(() => {
    const live = liveRef.current;
    if (status !== 'ready' || !live || !paramsKey) return;
    if (live.templateId !== entry?.id) return;
    live.setParams(JSON.parse(paramsKey) as ParamValues);
  }, [status, paramsKey, entry?.id]);

  // 外部播放头或减少动效控制
  const scrub = control?.scrub ?? null;
  useEffect(() => {
    const live = liveRef.current;
    if (status !== 'ready' || !live) return;
    if (reducedMotion) {
      live.setPlaying(false);
      live.seek(state.cutTime ?? state.duration * 0.5);
      return;
    }
    if (scrub === null) {
      if (!live.userPaused) live.setPlaying(true);
      return;
    }
    live.setPlaying(false);
    live.seek(scrub * state.duration);
  }, [status, scrub, state.duration, state.cutTime, reducedMotion]);

  // 画布尺寸与可见性跟踪
  useEffect(() => {
    const stage = stageRef.current;
    if (!stage || status !== 'ready') return;
    const ro = new ResizeObserver(() => {
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      liveRef.current?.resize(stage.clientWidth * dpr, stage.clientHeight * dpr);
    });
    ro.observe(stage);
    const io = new IntersectionObserver((es) => liveRef.current?.setVisible(es.some((e) => e.isIntersecting)));
    io.observe(stage);
    return () => {
      ro.disconnect();
      io.disconnect();
    };
  }, [status]);

  const pick = (i: number) => {
    cycling.current = false;
    setIndex(i);
    const live = liveRef.current;
    if (live && !reducedMotion) live.setPlaying(true, false);
    const id = entries[i]?.id;
    if (id) onPick?.(id);
  };

  const togglePlay = () => {
    const live = liveRef.current;
    if (!live) return;
    cycling.current = false;
    live.setPlaying(!state.playing, true);
  };

  const segments = useMemo(() => {
    const m = entry?.manifest;
    if (!m?.timeline) return [];
    const items = m.timeline.segments.map((s) => {
      const fromControl = control?.params?.[s.param];
      const def = (m.params ?? []).find((p) => p.key === s.param);
      const value = typeof fromControl === 'number' ? fromControl : typeof def?.default === 'number' ? def.default : 0;
      return { key: s.param, label: localize(s.label, language), value };
    });
    const total = items.reduce((n, s) => n + s.value, 0) || 1;
    return items.map((s) => ({ ...s, share: s.value / total }));
  }, [entry, language, control?.params]);

  const scrubAtClientX = (clientX: number, el: HTMLElement) => {
    const live = liveRef.current;
    if (!live || state.duration <= 0) return;
    const r = el.getBoundingClientRect();
    if (r.width <= 0) return;
    const ratio = Math.min(1, Math.max(0, (clientX - r.left) / r.width));
    cycling.current = false;
    live.setPlaying(false, true);
    live.seek(ratio * state.duration);
  };

  const onPointerDown = (ev: PointerEvent<HTMLDivElement>) => {
    if (!scrubbable || status !== 'ready') return;
    draggingRef.current = true;
    ev.currentTarget.setPointerCapture(ev.pointerId);
    scrubAtClientX(ev.clientX, ev.currentTarget);
  };

  const onPointerMove = (ev: PointerEvent<HTMLDivElement>) => {
    if (!draggingRef.current) return;
    scrubAtClientX(ev.clientX, ev.currentTarget);
  };

  const stopDrag = (ev: PointerEvent<HTMLDivElement>) => {
    if (!draggingRef.current) return;
    draggingRef.current = false;
    if (ev.currentTarget.hasPointerCapture(ev.pointerId)) {
      ev.currentTarget.releasePointerCapture(ev.pointerId);
    }
  };

  const onTimelineKeyDown = (ev: KeyboardEvent<HTMLDivElement>) => {
    if (!scrubbable || status !== 'ready' || state.duration <= 0) return;
    const live = liveRef.current;
    if (!live) return;
    const step = state.duration * 0.05;
    if (ev.key === 'ArrowLeft') {
      ev.preventDefault();
      cycling.current = false;
      live.setPlaying(false, true);
      live.seek(Math.max(0, state.time - step));
    } else if (ev.key === 'ArrowRight') {
      ev.preventDefault();
      cycling.current = false;
      live.setPlaying(false, true);
      live.seek(Math.min(state.duration, state.time + step));
    } else if (ev.key === 'Home') {
      ev.preventDefault();
      cycling.current = false;
      live.setPlaying(false, true);
      live.seek(0);
    } else if (ev.key === 'End') {
      ev.preventDefault();
      cycling.current = false;
      live.setPlaying(false, true);
      live.seek(state.duration);
    } else if (ev.key === ' ' || ev.key === 'Enter') {
      ev.preventDefault();
      togglePlay();
    }
  };

  const name = entry ? localize(entry.manifest.name, language) : '';
  const cutShare = state.cutTime !== null && state.duration > 0 ? state.cutTime / state.duration : null;

  return (
    <div className={`monitor p-2.5 sm:p-3 ${className ?? ''}`} data-testid={testId} data-status={status}>
      <div className="flex h-9 items-center gap-2.5 px-2 text-[13px]">
        <span className="relative flex size-2" aria-hidden="true">
          {state.playing && !reducedMotion && <span className="absolute inset-0 animate-ping rounded-full bg-primary opacity-60" />}
          <span className="relative size-2 rounded-full bg-primary" />
        </span>
        <span className="font-semibold">{t('site.hero.viewerLabel')}</span>
        <span className="truncate text-fg-muted" data-testid="live-template-name">
          {name}
        </span>
        <span className="t-mono ml-auto hidden text-[10.5px] text-fg-subtle sm:inline">1920 × 1080 · 60 fps</span>
      </div>

      <div ref={stageRef} className="preview-checker relative aspect-video w-full overflow-hidden rounded-[10px]" data-testid="live-stage">
        <canvas ref={canvasRef} className="absolute inset-0 size-full" aria-label={name || undefined} role="img" />
        {status === 'starting' && (
          <AllayLoader loading label={t('site.hero.starting')} priority="preview" className="absolute inset-0">
            <div className="flex size-full flex-col items-center justify-center gap-3 p-6">
              <Skeleton className="h-[52%] w-[56%]" />
              <span className="text-[12px] text-fg-subtle">{t('site.hero.starting')}</span>
            </div>
          </AllayLoader>
        )}
        {(status === 'unsupported' || status === 'failed') && (
          <div className="absolute inset-0 flex items-center justify-center p-6 text-center text-[13px] text-fg-muted">{t('site.hero.noWebgl')}</div>
        )}
      </div>

      {/* 播放与时间轴控制条：干净置于画布下方，不遮挡动画帧 */}
      <div className="mt-2.5 space-y-2.5 px-1">
        {!hidePicker && (
          <div className="flex flex-wrap items-center gap-1.5" role="toolbar" aria-label={t('site.hero.pick')}>
            <button
              type="button"
              className="link-focus flex size-8 shrink-0 items-center justify-center rounded-md bg-control text-foreground transition-colors duration-150 hover:bg-control-hi disabled:opacity-45"
              aria-label={state.playing ? t('site.hero.pause') : t('site.hero.play')}
              data-testid="live-play"
              disabled={status !== 'ready'}
              onClick={togglePlay}
            >
              {state.playing ? <Pause size={15} weight="fill" /> : <Play size={15} weight="fill" />}
            </button>
            <span className="mx-0.5 h-5 w-px shrink-0 bg-divider" aria-hidden="true" />
            {entries.map((e, i) => (
              <button
                key={e.id}
                type="button"
                aria-pressed={i === index}
                data-testid="live-chip"
                data-template={e.id}
                onClick={() => pick(i)}
                className={`link-focus h-8 rounded-md px-2.5 text-[12.5px] whitespace-nowrap transition-colors duration-150 ${
                  i === index ? 'bg-control-hi font-medium text-foreground' : 'text-fg-muted hover:bg-control hover:text-foreground'
                }`}
              >
                {localize(e.manifest.name, language)}
              </button>
            ))}
          </div>
        )}

        <div className="flex items-center gap-2.5">
          {hidePicker && (
            <button
              type="button"
              className="link-focus flex size-7 shrink-0 items-center justify-center rounded-md bg-control text-foreground transition-colors duration-150 hover:bg-control-hi disabled:opacity-45"
              aria-label={state.playing ? t('site.hero.pause') : t('site.hero.play')}
              data-testid="live-play"
              disabled={status !== 'ready'}
              onClick={togglePlay}
            >
              {state.playing ? <Pause size={14} weight="fill" /> : <Play size={14} weight="fill" />}
            </button>
          )}
          <div
            ref={sliderRef}
            className={`link-focus relative flex-1 rounded-[8px] ${scrubbable ? 'cursor-ew-resize touch-none' : ''}`}
            role={scrubbable ? 'slider' : undefined}
            tabIndex={scrubbable ? 0 : undefined}
            aria-label={scrubbable ? t('site.hero.scrub') : undefined}
            aria-valuemin={scrubbable ? 0 : undefined}
            aria-valuemax={scrubbable ? 100 : undefined}
            aria-valuenow={scrubbable ? Math.round((state.duration > 0 ? state.time / state.duration : 0) * 100) : undefined}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={stopDrag}
            onPointerCancel={stopDrag}
            onKeyDown={onTimelineKeyDown}
            data-testid="live-timeline"
          >
            <div className="flex h-7 gap-[3px] rounded-[8px] bg-well p-[3px]">
              {segments.map((s, i) => {
                const narrow = s.share < 0.16;
                return (
                  <div
                    key={s.key}
                    title={`${s.label} · ${s.value.toFixed(2)}s`}
                    className={`flex min-w-0 items-center overflow-hidden rounded-[5px] text-[11px] text-stage-foreground transition-[flex-grow] duration-300 ${
                      narrow ? 'justify-center px-1' : 'justify-between gap-1.5 px-2'
                    }`}
                    style={{ flexGrow: s.share, flexBasis: 0, background: STAGE_COLORS[i % 3] }}
                  >
                    {s.share >= 0.06 && <span className="truncate">{s.label}</span>}
                    {s.share >= 0.2 && <span className="t-tab hidden shrink-0 opacity-80 sm:inline">{s.value.toFixed(2)}s</span>}
                  </div>
                );
              })}
            </div>
            {cutShare !== null && <span className="cut-mark top-[-5px]" style={{ left: `${cutShare * 100}%` }} aria-hidden="true" />}
            <div className="pointer-events-none absolute inset-y-[-3px] right-0 left-0">
              <div ref={playheadRef} className="site-playhead absolute inset-y-0 left-0 w-full">
                <div className="absolute inset-y-0 left-0 w-[2px] -translate-x-1/2 rounded-full bg-primary" />
              </div>
            </div>
          </div>
        </div>

        <div className={`items-center justify-between gap-4 text-[11px] text-fg-subtle ${noteHidden ? 'hidden' : 'flex'}`}>
          <span data-testid="assets-note" className="line-clamp-2">
            {mcGameVersion ? t('site.hero.mcAssets', { version: mcGameVersion }) : t('site.hero.demoAssets')}
          </span>
          <span ref={timeRef} data-testid="live-time" className="t-tab hidden shrink-0 sm:inline" />
        </div>
      </div>
    </div>
  );
}
