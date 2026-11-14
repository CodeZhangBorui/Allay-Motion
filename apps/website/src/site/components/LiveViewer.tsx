// 实时预览面板：长得像应用的预览面板（左上“预览 · 模板名”、右上规格读数、棋盘格背景、悬浮工具条、阶段轨），
// 画面由桌面版的引擎 Worker 实时渲染。首屏和窄屏的仿真器都用它。
import { AllayLoader } from '@allay/mascot';
import { Skeleton } from '@allay/ui/components/misc';
import { localize } from '@allay/template-sdk';
import { Pause, Play } from '@phosphor-icons/react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { TemplateEntry } from '../../../../desktop/src/shared/templates';
import { mcGameVersion } from '../../host/mc-pack';
import { builtinEntries } from '../../host/templates';
import { usePrefs } from '../prefs';
import type { LivePreview, LiveState } from '../engine/runtime';
import { publishLiveTick } from '../motion/HeroField';

interface Props {
  /** 自动轮换模板（首屏）；用户点了任何一个就停 */
  autoCycle?: boolean;
  /** 显示时间轴（可拖） */
  scrubbable?: boolean;
  testId?: string;
  /** 被选中的模板（外部控制，例如模板卡片里点“在预览里看”） */
  initialId?: string;
  /** 把播放进度广播出去（首屏四周的方块场跟着它动） */
  publish?: boolean;
}

type Status = 'starting' | 'ready' | 'unsupported' | 'failed';

export function LiveViewer({ autoCycle = false, scrubbable = false, testId, initialId, publish = false }: Props) {
  const { t } = useTranslation();
  const { language } = usePrefs();
  const entries = useMemo(() => builtinEntries(), []);
  const [index, setIndex] = useState(() => Math.max(0, entries.findIndex((e) => e.id === (initialId ?? 'allay.builtin.block-wipe'))));
  const [status, setStatus] = useState<Status>('starting');
  const [state, setState] = useState<LiveState>({ duration: 1, cutTime: null, time: 0, playing: true });
  const cycling = useRef(autoCycle);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const liveRef = useRef<LivePreview | null>(null);
  const playheadRef = useRef<HTMLDivElement>(null);
  const timeRef = useRef<HTMLSpanElement>(null);
  const entry: TemplateEntry | undefined = entries[index];
  /** 当前模板各段结束处占总时长的比例（给 publish 用，引擎回调里读最新的） */
  const marksRef = useRef<number[]>([]);

  // 引擎：懒加载 runtime（three 和引擎在单独的代码块里），挂到画布上
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let disposed = false;
    let live: LivePreview | null = null;
    void (async () => {
      const rt = await import('../engine/runtime');
      if (disposed) return;
      if (!rt.hasWebgl2()) {
        setStatus('unsupported');
        return;
      }
      try {
        live = await rt.LivePreview.create(canvas);
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
        // 播放头每帧走：直接写 transform，不触发 React 重渲染
        const p = s.duration > 0 ? Math.min(1, s.time / s.duration) : 0;
        if (playheadRef.current) playheadRef.current.style.transform = `translateX(${p * 100}%)`;
        if (timeRef.current) timeRef.current.textContent = `${Math.min(s.time, s.duration).toFixed(2)} / ${s.duration.toFixed(2)} s`;
        setState((prev) => (prev.duration === s.duration && prev.playing === s.playing && prev.cutTime === s.cutTime ? prev : s));
        if (publish) publishLiveTick({ time: s.time, duration: s.duration, marks: marksRef.current });
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
  }, [entries.length, publish]);

  // 换模板、换语言（带文字的模板跟着换）
  useEffect(() => {
    const live = liveRef.current;
    if (status !== 'ready' || !live || !entry) return;
    void live.show(entry, language).catch((error: unknown) => console.warn('[live] load failed', error));
  }, [status, entry, language]);

  // 画布尺寸跟着面板走；不在视口里不画
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
  };

  const segments = useMemo(() => {
    const m = entry?.manifest;
    if (!m?.timeline) return [];
    const items = m.timeline.segments.map((s) => {
      const def = (m.params ?? []).find((p) => p.key === s.param);
      return { key: s.param, label: localize(s.label, language), value: typeof def?.default === 'number' ? def.default : 0 };
    });
    const total = items.reduce((n, s) => n + s.value, 0) || 1;
    return items.map((s) => ({ ...s, share: s.value / total }));
  }, [entry, language]);
  useEffect(() => {
    let acc = 0;
    marksRef.current = segments.map((sg) => (acc += sg.share));
  }, [segments]);
  const stageColors = ['var(--stage-enter)', 'var(--stage-hold)', 'var(--stage-exit)'];

  const scrubTo = (clientX: number, el: HTMLElement) => {
    const r = el.getBoundingClientRect();
    const live = liveRef.current;
    if (!live) return;
    cycling.current = false;
    live.setPlaying(false);
    live.seek(((clientX - r.left) / r.width) * state.duration);
  };

  return (
    <div className="panel bg-viewer" data-testid={testId} data-status={status}>
      <div className="flex h-11 items-center gap-2 px-4 text-[13px]">
        <span className="font-semibold">{t('site.hero.viewerLabel')}</span>
        <span className="truncate text-fg-muted" data-testid="live-template-name">
          {entry ? localize(entry.manifest.name, language) : ''}
        </span>
        <span className="num ml-auto text-[12px] text-fg-subtle">1920 × 1080 · 60 fps</span>
      </div>

      <div className="px-3 sm:px-6">
        <div ref={stageRef} className="preview-checker relative aspect-video w-full overflow-hidden rounded-lg" data-testid="live-stage">
          <canvas ref={canvasRef} className="absolute inset-0 size-full" aria-label={entry ? localize(entry.manifest.name, language) : undefined} role="img" />
          {status === 'starting' && (
            <AllayLoader loading label={t('site.hero.starting')} priority="preview" className="absolute inset-0">
              <div className="flex size-full flex-col items-center justify-center gap-3">
                <Skeleton className="h-[52%] w-[56%]" />
                <span className="text-[12px] text-fg-subtle">{t('site.hero.starting')}</span>
              </div>
            </AllayLoader>
          )}
          {(status === 'unsupported' || status === 'failed') && (
            <div className="absolute inset-0 flex items-center justify-center p-6 text-center text-[13px] text-fg-muted">{t('site.hero.noWebgl')}</div>
          )}
        </div>
      </div>

      {/* 悬浮工具条：播放和模板切换 */}
      <div className="relative z-10 -mt-6 flex justify-center px-3">
        <div className="site-float site-scroll-x flex max-w-full items-center gap-1 overflow-x-auto p-1" role="toolbar" aria-label={t('site.hero.pick')}>
          <button
            type="button"
            className="flex size-8 shrink-0 items-center justify-center rounded-md text-foreground transition-colors duration-(--dur-1) hover:bg-control"
            aria-label={state.playing ? t('site.hero.pause') : t('site.hero.play')}
            data-testid="live-play"
            disabled={status !== 'ready'}
            onClick={() => liveRef.current?.setPlaying(!state.playing)}
          >
            {state.playing ? <Pause size={15} weight="fill" /> : <Play size={15} weight="fill" />}
          </button>
          <span className="mx-1 h-5 w-px shrink-0 bg-divider" aria-hidden="true" />
          {entries.map((e, i) => (
            <button
              key={e.id}
              type="button"
              aria-pressed={i === index}
              data-testid="live-chip"
              data-template={e.id}
              onClick={() => pick(i)}
              className={`h-8 shrink-0 rounded-md px-3 text-[12.5px] whitespace-nowrap transition-colors duration-(--dur-1) ${
                i === index ? 'bg-control-hi font-medium text-foreground' : 'text-fg-muted hover:bg-control hover:text-foreground'
              }`}
            >
              {localize(e.manifest.name, language)}
            </button>
          ))}
        </div>
      </div>

      {/* 阶段轨：进入 / 停留 / 退出，按默认时长分段；播放头和剪辑点 */}
      <div className="px-3 pt-4 pb-4 sm:px-6">
        <div
          className={`relative ${scrubbable ? 'cursor-ew-resize touch-none' : ''}`}
          onPointerDown={
            scrubbable
              ? (ev) => {
                  const el = ev.currentTarget;
                  el.setPointerCapture(ev.pointerId);
                  scrubTo(ev.clientX, el);
                  const move = (m: PointerEvent) => scrubTo(m.clientX, el);
                  const up = () => {
                    el.removeEventListener('pointermove', move);
                    el.removeEventListener('pointerup', up);
                  };
                  el.addEventListener('pointermove', move);
                  el.addEventListener('pointerup', up);
                }
              : undefined
          }
          data-testid="live-timeline"
          aria-label={scrubbable ? t('site.hero.scrub') : undefined}
        >
          <div className="flex h-7 gap-[3px] rounded-md bg-well p-[3px]">
            {segments.map((s, i) => (
              <div
                key={s.key}
                className="flex min-w-0 items-center justify-between overflow-hidden rounded-[5px] px-2 text-[11px] text-stage-foreground"
                style={{ flexGrow: s.share, flexBasis: 0, background: stageColors[i % 3] }}
              >
                <span className="truncate">{s.label}</span>
                <span className="num hidden opacity-80 sm:inline">{s.value.toFixed(2)}s</span>
              </div>
            ))}
          </div>
          <div className="pointer-events-none absolute inset-y-[-3px] left-0 right-0">
            <div ref={playheadRef} className="site-playhead absolute inset-y-0 left-0 w-full">
              <div className="absolute inset-y-0 left-0 w-[1.5px] -translate-x-1/2 bg-primary" />
            </div>
          </div>
        </div>
        <div className="mt-2 flex items-center justify-between text-[11.5px] text-fg-subtle">
          <span data-testid="assets-note">{mcGameVersion ? t('site.hero.mcAssets', { version: mcGameVersion }) : t('site.hero.demoAssets')}</span>
          <span ref={timeRef} className="num hidden shrink-0 pl-4 sm:inline" />
        </div>
      </div>
    </div>
  );
}
