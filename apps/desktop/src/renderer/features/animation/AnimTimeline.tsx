// 动画的时间轴（docs/animation-editor.md 5.3、10.2–10.4）：动画工作区里替代模板的阶段时间轴（不碰 TimelineTrack）。
// 上面是播放条和视图切换（关键帧 / 曲线）；关键帧视图里左侧是图层名（可展开成各属性），右侧是刻度、可见区间条、
// 关键帧菱形、音效轨和播放头；曲线视图见 GraphEditor。
//
// 关键帧：点选；Shift / Ctrl 点击加选或取消；在空白处拖出框选；拖选中的任意一个，整组一起挪（吸附到帧、播放头、
// 别的关键帧和标记，按住 Alt 临时不吸附）；选中两个以上时选择框两端的手柄拖动是缩放时间；方向键按一帧挪，Shift 十帧。
// 复制、粘贴、删除、全选是带快捷键的命令（commands-r3.ts）。一次拖动一步撤销。
import { frameCount } from '@allay/engine/frames';
import { Button } from '@allay/ui/components/button';
import { ToggleGroup, ToggleGroupItem } from '@allay/ui/components/misc';
import { ICON, ICON_WEIGHT } from '@allay/ui/lib/icons';
import { cn } from '@allay/ui/lib/utils';
import { ArrowsOutLineHorizontal, CaretRight, MagnetStraight, MagnifyingGlassMinus, MagnifyingGlassPlus, Pause, Play, Plus, Repeat, SkipBack, SkipForward, SpeakerHigh } from '@phosphor-icons/react';
import { useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { KEY_EPSILON, keysOf, layerKeyTimes, sameKey, scaleKeys, shiftKeys, snapTime, type KeyRef } from '../../../shared/animation/edit';
import { resolveDoc } from '../../../shared/animation/resolve';
import { fracOf, panBy, revealTime, viewRange, zoomAt } from '../../../shared/animation/time-view';
import { layerTree, setLayerInterval } from '../../../shared/animation/layers';
import { ANIM_PROPS, type AnimationDoc, type AnimProp } from '../../../shared/animation/schema';
import { trigger } from '../../app/registry';
import { usePreviewStore } from '../../stores/previewStore';
import { beginGesture, endGesture, useProjectStore } from '../../stores/projectStore';
import { useTransportStore } from '../../stores/transportStore';
import { togglePlay } from '../commands/commands';
import { formatTimecode, usePlayback } from '../transport/TransportBar';
import { GraphEditor } from './GraphEditor';
import { LAYER_ICONS } from './LayersPanel';
import { currentAnimation, replaceDoc } from './source';
import { trackPointer } from './pointer';
import { useAnimationUi } from './uiState';

export const NAME_W = 168;
const ROW_H = 24;
/** 吸附的距离（像素） */
const SNAP_PX = 6;
const DEFAULT_SOUND = 'minecraft:ui.button.click';

/** 刻度的间隔（秒）：让相邻两个刻度至少隔 56 px（span 是可见范围的长度，放大后刻度变细，最细一帧） */
function tickStep(span: number, width: number, fps: number): number {
  for (const s of [1 / fps, 2 / fps, 5 / fps, 0.1, 0.25, 0.5, 1, 2, 5, 10]) if ((s / span) * width >= 56) return s;
  return 10;
}

/** 刻度的文字：整秒和小数秒写秒数，不足 0.1 秒的写成“秒:帧” */
function tickLabel(s: number, fps: number): string {
  const frames = Math.round(s * fps);
  if (Math.abs(s * 10 - Math.round(s * 10)) < 1e-6) return `${Math.round(s * 1000) / 1000}s`;
  return `${Math.floor(frames / fps)}:${String(frames % fps).padStart(2, '0')}`;
}

/** 缩放按钮、Ctrl+滚轮每一下的倍数 */
const ZOOM_STEP = 1.25;

interface DiamondProps {
  x: number;
  selected: boolean;
  label: string;
  testId?: string;
  dim?: boolean;
  data: Record<string, string>;
  onPointerDown?: (e: ReactPointerEvent) => void;
  onKeyDown?: (e: ReactKeyboardEvent) => void;
}

function Diamond({ x, selected, onPointerDown, onKeyDown, label, testId, dim, data }: DiamondProps) {
  return (
    <button
      type="button"
      tabIndex={onKeyDown ? 0 : -1}
      aria-label={label}
      aria-pressed={selected}
      data-testid={testId}
      {...Object.fromEntries(Object.entries(data).map(([k, v]) => [`data-${k}`, v]))}
      className={cn(
        'absolute top-1/2 z-[1] size-[9px] -translate-x-1/2 -translate-y-1/2 rotate-45 rounded-[1.5px] focus-visible:outline-2 focus-visible:outline-ring',
        selected ? 'bg-primary' : dim ? 'bg-fg-subtle hover:bg-fg-muted' : 'bg-fg-muted hover:bg-foreground',
      )}
      style={{ left: `${x * 100}%` }}
      onPointerDown={onPointerDown}
      onKeyDown={onKeyDown}
    />
  );
}

/** 拖动开始时的快照：每次移动都从它重新算（不累积取整误差），提交时一次撤销 */
interface DragState {
  doc: AnimationDoc;
  refs: KeyRef[];
  startX: number;
  started: boolean;
}

export function AnimTimeline() {
  const { t } = useTranslation();
  usePlayback();
  const doc = useProjectStore((s) => s.template?.animation?.doc ?? null);
  const fps = useProjectStore((s) => s.output.fps);
  const time = useTransportStore((s) => s.time);
  const playing = useTransportStore((s) => s.playing);
  const loop = useTransportStore((s) => s.loop);
  const ready = usePreviewStore((s) => s.status.kind === 'ready');
  const selectedLayer = useAnimationUi((s) => s.layer);
  const selKeys = useAnimationUi((s) => s.keys);
  const selSound = useAnimationUi((s) => s.sound);
  const expanded = useAnimationUi((s) => s.expanded);
  const view = useAnimationUi((s) => s.view);
  const graphMode = useAnimationUi((s) => s.graphMode);
  const graphSeparate = useAnimationUi((s) => s.graphSeparate);
  const snap = useAnimationUi((s) => s.snap);
  const zoom = useAnimationUi((s) => s.zoom);
  const laneRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null);
  const resolved = useMemo(() => (doc ? resolveDoc(doc) : null), [doc]);
  const durationNow = resolved?.duration ?? 0;
  // 播放时播放头跑出可见范围就翻页
  useEffect(() => {
    if (!zoom) return;
    const next = revealTime(zoom, durationNow, time);
    if (next !== zoom) useAnimationUi.getState().setZoom(next);
  }, [time, zoom, durationNow]);
  // Ctrl+滚轮在指针处缩放，Shift+滚轮（或横向滚轮）左右滚动；普通滚轮照常上下滚图层（监听要非被动的才能拦下滚轮）
  useEffect(() => {
    const el = bodyRef.current;
    if (!el || !durationNow) return undefined;
    const onWheel = (e: WheelEvent) => {
      const lane = laneRef.current?.getBoundingClientRect();
      if (!lane || lane.width <= 0) return;
      const ui = useAnimationUi.getState();
      const range = viewRange(ui.zoom, durationNow);
      const span = range.end - range.start;
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        const anchor = range.start + ((e.clientX - lane.left) / lane.width) * span;
        ui.setZoom(zoomAt(ui.zoom, durationNow, anchor, e.deltaY < 0 ? 1 / ZOOM_STEP : ZOOM_STEP));
      } else if (ui.zoom && (e.shiftKey || Math.abs(e.deltaX) > Math.abs(e.deltaY))) {
        e.preventDefault();
        const d = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
        ui.setZoom(panBy(ui.zoom, durationNow, (d / lane.width) * span));
      }
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [durationNow, view]);
  if (!doc || !resolved) return null;
  const duration = resolved.duration;
  const range = viewRange(zoom, duration);
  const span = range.end - range.start;
  /** 时刻在轨道上的位置（可见范围里的比例） */
  const fx = (tt: number) => fracOf(range, tt);
  const total = frameCount(duration, fps);
  const frame = (x: number) => Math.min(duration, Math.max(0, Math.round(x * fps) / fps));
  const laneWidth = () => laneRef.current?.getBoundingClientRect().width ?? 1;
  const timeAt = (clientX: number): number => {
    const r = laneRef.current?.getBoundingClientRect();
    if (!r || r.width <= 0) return 0;
    return frame(range.start + ((clientX - r.left) / r.width) * span);
  };
  const zoomBy = (factor: number) => useAnimationUi.getState().setZoom(zoomAt(zoom, duration, useTransportStore.getState().time, factor));
  const isSel = (k: KeyRef) => selKeys.some((s) => sameKey(s, k));

  /** 吸附点：播放头、没选中的关键帧、音效、剪辑点、两端 */
  const snapPoints = (exclude: readonly KeyRef[]): number[] => {
    const pts = [0, duration, useTransportStore.getState().time, ...resolved.sounds.map((s) => s.at)];
    if (resolved.cutTime !== null) pts.push(resolved.cutTime);
    for (const l of resolved.layers) for (const p of ANIM_PROPS) for (const k of keysOf(l.props[p])) if (!exclude.some((r) => r.layer === l.id && r.prop === p && Math.abs(r.t - k.t) < KEY_EPSILON)) pts.push(k.t);
    return pts;
  };
  const snapTol = () => (SNAP_PX / laneWidth()) * span;

  // ---- 定位 ----
  const scrub = (e: ReactPointerEvent) => {
    if (e.button !== 0) return;
    useTransportStore.getState().setPlaying(false);
    useTransportStore.getState().setTime(timeAt(e.clientX));
    const move = (ev: PointerEvent) => useTransportStore.getState().setTime(timeAt(ev.clientX));
    const up = () => {
    };
    trackPointer(e, { move, up });
  };

  // ---- 框选（在轨道的空白处拖） ----
  const startBox = (e: ReactPointerEvent) => {
    if (e.button !== 0 || (e.target as HTMLElement).closest('button')) return;
    const body = bodyRef.current;
    if (!body) return;
    const additive = e.shiftKey || e.ctrlKey || e.metaKey;
    const x0 = e.clientX;
    const y0 = e.clientY;
    let moved = false;
    const move = (ev: PointerEvent) => {
      if (!moved && Math.hypot(ev.clientX - x0, ev.clientY - y0) < 3) return;
      moved = true;
      setBox({ x0, y0, x1: ev.clientX, y1: ev.clientY });
    };
    const up = (ev: PointerEvent) => {
      setBox(null);
      if (!moved) {
        // 点在空白处：定位并清空选择
        if (!additive) useAnimationUi.getState().selectKeys([]);
        useTransportStore.getState().setPlaying(false);
        useTransportStore.getState().setTime(timeAt(ev.clientX));
        return;
      }
      const [l, r] = [Math.min(x0, ev.clientX), Math.max(x0, ev.clientX)];
      const [tp, bt] = [Math.min(y0, ev.clientY), Math.max(y0, ev.clientY)];
      const hits: KeyRef[] = [];
      for (const el of body.querySelectorAll<HTMLElement>('[data-key-layer]')) {
        // 框碰到菱形就算选中（不要求中心在框里）：贴着轨道两端的关键帧也框得到
        const rect = el.getBoundingClientRect();
        if (rect.right < l || rect.left > r || rect.bottom < tp || rect.top > bt) continue;
        const layer = el.dataset.keyLayer!;
        const kt = Number(el.dataset.keyT);
        const prop = el.dataset.keyProp as AnimProp | undefined;
        if (prop) hits.push({ layer, prop, t: kt });
        else {
          // 图层那一行的菱形：这个时刻上这个图层所有属性的关键帧
          const rl = resolved.layers.find((x) => x.id === layer);
          for (const p of ANIM_PROPS) if (rl && keysOf(rl.props[p]).some((k) => Math.abs(k.t - kt) < KEY_EPSILON)) hits.push({ layer, prop: p, t: kt });
        }
      }
      useAnimationUi.getState().selectKeys(hits, additive ? 'add' : 'replace');
    };
    trackPointer(e, { move, up });
  };

  // ---- 拖动关键帧（整组） ----
  const dragKeys = (refs: KeyRef[], additive: boolean) => (e: ReactPointerEvent) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    const ui = useAnimationUi.getState();
    const already = refs.every((r) => ui.keys.some((k) => sameKey(k, r)));
    if (additive) {
      ui.selectKeys(refs, 'toggle');
      return;
    }
    if (!already) ui.selectKeys(refs);
    const group = already ? ui.keys : refs;
    const cur = currentAnimation();
    if (!cur) return;
    useTransportStore.getState().setPlaying(false);
    const st: DragState = { doc: cur.doc, refs: group, startX: e.clientX, started: false };
    const lead = refs[0]!;
    const move = (ev: PointerEvent) => {
      const w = laneWidth();
      let dt = ((ev.clientX - st.startX) / w) * span;
      if (!st.started && Math.abs(ev.clientX - st.startX) < 3) return;
      if (!st.started) {
        beginGesture();
        st.started = true;
      }
      // 吸附：被拖的那个关键帧对齐到帧，再按吸附点修正（Alt 不吸附）
      let to = frame(lead.t + dt);
      if (useAnimationUi.getState().snap && !ev.altKey) to = snapTime(to, snapPoints(st.refs), snapTol());
      dt = to - lead.t;
      const r = shiftKeys(st.doc, st.refs, dt, duration);
      if (r && replaceDoc(r.doc)) useAnimationUi.getState().selectKeys(r.refs);
    };
    const up = () => {
      if (st.started) endGesture();
      else {
        // 点了一下（没拖）：只选它（之前选中的一大组里点一个，松开时只留下这一个，同 After Effects）
        if (already) useAnimationUi.getState().selectKeys(refs);
        useTransportStore.getState().setTime(lead.t);
      }
    };
    trackPointer(e, { move, up });
  };

  /** 选择框两端的手柄：以另一端为中心缩放时间 */
  const dragScale = (side: 'start' | 'end', minT: number, maxT: number) => (e: ReactPointerEvent) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    const cur = currentAnimation();
    if (!cur || maxT - minT < KEY_EPSILON) return;
    const base = cur.doc;
    const refs = useAnimationUi.getState().keys;
    const pivot = side === 'end' ? minT : maxT;
    let started = false;
    const move = (ev: PointerEvent) => {
      if (!started) {
        beginGesture();
        started = true;
      }
      let edge = timeAt(ev.clientX);
      if (useAnimationUi.getState().snap && !ev.altKey) edge = snapTime(edge, snapPoints(refs), snapTol());
      const span = side === 'end' ? edge - pivot : pivot - edge;
      const factor = span / (maxT - minT);
      if (!(factor > 0.01)) return;
      const r = scaleKeys(base, refs, pivot, factor, duration);
      if (r && replaceDoc(r.doc)) useAnimationUi.getState().selectKeys(r.refs);
    };
    const up = () => {
      if (started) endGesture();
    };
    trackPointer(e, { move, up });
  };

  /** 拖可见区间的一端（吸附同关键帧；一次拖动一步撤销） */
  const dragInterval = (layerId: string, side: 'from' | 'to', at: number) => (e: ReactPointerEvent) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    const cur = currentAnimation();
    if (!cur) return;
    const base = cur.doc;
    const x0 = e.clientX;
    let started = false;
    trackPointer(e, {
      move: (ev) => {
        if (!started && Math.abs(ev.clientX - x0) < 2) return;
        if (!started) {
          beginGesture();
          started = true;
        }
        let to = frame(at + ((ev.clientX - x0) / laneWidth()) * span);
        if (useAnimationUi.getState().snap && !ev.altKey) to = snapTime(to, snapPoints([]), snapTol());
        const next = setLayerInterval(base, layerId, side === 'from' ? to : undefined, side === 'to' ? to : undefined, duration);
        if (next) replaceDoc(next);
      },
      up: () => {
        if (started) endGesture();
      },
    });
  };

  /** 选中的关键帧按一帧（Shift 十帧）挪 */
  const nudge = (e: ReactKeyboardEvent) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    const keys = useAnimationUi.getState().keys;
    if (keys.length === 0) return;
    e.preventDefault();
    const dt = ((e.key === 'ArrowLeft' ? -1 : 1) * (e.shiftKey ? 10 : 1)) / fps;
    trigger('animMoveKeys', { keys, dt });
  };

  // ---- 音效轨 ----
  const dragSound = (id: string, at: number) => (e: ReactPointerEvent) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    useAnimationUi.getState().selectSound(id);
    const cur = currentAnimation();
    if (!cur) return;
    const x0 = e.clientX;
    const base = cur.doc;
    let started = false;
    const move = (ev: PointerEvent) => {
      if (!started && Math.abs(ev.clientX - x0) < 3) return;
      if (!started) {
        beginGesture();
        started = true;
      }
      let to = frame(at + ((ev.clientX - x0) / laneWidth()) * span);
      if (useAnimationUi.getState().snap && !ev.altKey) to = snapTime(to, snapPoints([]).filter((p) => Math.abs(p - at) > KEY_EPSILON), snapTol());
      const i = base.sounds.findIndex((s) => s.id === id);
      if (i < 0) return;
      const next = structuredClone(base);
      next.sounds[i]!.at = to;
      next.sounds.sort((a, b) => a.at - b.at);
      replaceDoc(next);
    };
    const up = () => {
      if (started) endGesture();
      else useTransportStore.getState().setTime(at);
    };
    trackPointer(e, { move, up });
  };

  const step = tickStep(span, laneRef.current?.getBoundingClientRect().width ?? 600, fps);
  const ticks: number[] = [];
  for (let i = Math.ceil(range.start / step - 1e-9); i * step <= range.end + 1e-9; i++) ticks.push(Math.round(i * step * 100000) / 100000);
  // 显示顺序与图层面板相同：画在最前面的在最上面，子图层缩进排在父级下面
  const layers = layerTree(doc).map((e) => ({ l: e.layer, r: resolved.layers[e.index]!, depth: e.depth }));
  const playX = fx(time);
  const selTimes = selKeys.map((k) => k.t);
  const minT = selTimes.length > 1 ? Math.min(...selTimes) : 0;
  const maxT = selTimes.length > 1 ? Math.max(...selTimes) : 0;
  const showScale = selKeys.length > 1 && maxT - minT > KEY_EPSILON && view === 'keys';

  return (
    <section aria-label={t('anim.timeline.region')} className="flex h-full shrink-0 flex-col rounded-xl bg-surface-1" data-testid="anim-timeline" data-view={view}>
      <div role="toolbar" aria-label={t('transport.region')} className="flex h-12 shrink-0 items-center gap-1 pr-2.5 pl-3" data-testid="transport">
        <Button variant="ghost" size="icon" aria-label={t('transport.toStart')} disabled={!ready} onClick={() => useTransportStore.getState().setTime(0)}>
          <SkipBack size={ICON.md} weight={ICON_WEIGHT.active} />
        </Button>
        <Button variant="secondary" className="mx-0.5 size-8 rounded-[9px] bg-control-hi px-0 hover:bg-control-hi hover:brightness-125" data-testid="transport-play" aria-label={playing ? t('transport.pause') : t('transport.play')} disabled={!ready} onClick={togglePlay}>
          {playing ? <Pause size={ICON.md - 1} weight={ICON_WEIGHT.active} /> : <Play size={ICON.md - 1} weight={ICON_WEIGHT.active} />}
        </Button>
        <Button variant="ghost" size="icon" aria-label={t('timeline.toEnd')} disabled={!ready} onClick={() => useTransportStore.getState().setTime(useTransportStore.getState().duration)}>
          <SkipForward size={ICON.md} weight={ICON_WEIGHT.active} />
        </Button>
        <Button variant="ghost" size="icon" aria-label={t('transport.loop')} aria-pressed={loop} className={cn('aria-pressed:bg-transparent', loop ? 'text-primary-text hover:text-primary-text' : 'text-fg-muted')} onClick={() => useTransportStore.getState().setLoop(!loop)}>
          <Repeat size={ICON.md} />
        </Button>
        <div className="ml-3 flex min-w-0 items-baseline gap-2 num">
          <span data-testid="transport-time" className="text-xl font-medium tracking-[.2px]">
            {formatTimecode(time, fps)}
          </span>
          <span className="text-sm text-fg-subtle">/ {formatTimecode(Math.max(0, total - 1) / fps, fps)}</span>
        </div>
        <span className="flex-1" />
        {selKeys.length > 1 && (
          <span className="mr-2 text-xs text-fg-subtle num" data-testid="anim-selection-count">
            {t('anim.keys.selected', { count: selKeys.length })}
          </span>
        )}
        {view === 'graph' && (
          <Button
            variant="ghost"
            size="sm"
            aria-pressed={graphSeparate}
            className={cn('mr-1 aria-pressed:bg-transparent', graphSeparate ? 'text-primary-text hover:text-primary-text' : 'text-fg-muted')}
            title={t('anim.graph.separateHint')}
            data-testid="anim-graph-separate"
            onClick={() => useAnimationUi.getState().setGraphSeparate(!graphSeparate)}
          >
            {t('anim.graph.separate')}
          </Button>
        )}
        {view === 'graph' && (
          <ToggleGroup value={[graphMode]} onValueChange={(v: string[]) => v[0] && useAnimationUi.getState().setGraphMode(v[0] as 'value' | 'speed')} aria-label={t('anim.graph.mode')} className="mr-1">
            <ToggleGroupItem value="value" data-testid="anim-graph-value">
              {t('anim.graph.value')}
            </ToggleGroupItem>
            <ToggleGroupItem value="speed" data-testid="anim-graph-speed">
              {t('anim.graph.speed')}
            </ToggleGroupItem>
          </ToggleGroup>
        )}
        <Button variant="ghost" size="icon" aria-label={t('anim.timeline.zoomOut')} title={t('anim.timeline.zoomOut')} disabled={!zoom} data-testid="anim-zoom-out" onClick={() => zoomBy(ZOOM_STEP)}>
          <MagnifyingGlassMinus size={ICON.md} />
        </Button>
        <Button variant="ghost" size="icon" aria-label={t('anim.timeline.zoomIn')} title={t('anim.timeline.zoomHint')} disabled={span <= Math.max(0.1, 2 / fps) + 1e-9} data-testid="anim-zoom-in" onClick={() => zoomBy(1 / ZOOM_STEP)}>
          <MagnifyingGlassPlus size={ICON.md} />
        </Button>
        <Button variant="ghost" size="icon" aria-label={t('anim.timeline.zoomFit')} title={t('anim.timeline.zoomFit')} disabled={!zoom} data-testid="anim-zoom-fit" onClick={() => useAnimationUi.getState().setZoom(null)}>
          <ArrowsOutLineHorizontal size={ICON.md} />
        </Button>
        <ToggleGroup value={[view]} onValueChange={(v: string[]) => v[0] && useAnimationUi.getState().setView(v[0] as 'keys' | 'graph')} aria-label={t('anim.timeline.view')}>
          <ToggleGroupItem value="keys" data-testid="anim-view-keys">
            {t('anim.timeline.keys')}
          </ToggleGroupItem>
          <ToggleGroupItem value="graph" data-testid="anim-view-graph">
            {t('anim.timeline.graph')}
          </ToggleGroupItem>
        </ToggleGroup>
        <Button
          variant="ghost"
          size="icon"
          aria-label={t('anim.commands.toggleSnap')}
          title={t('anim.timeline.snapHint')}
          aria-pressed={snap}
          className={cn('aria-pressed:bg-transparent', snap ? 'text-primary-text hover:text-primary-text' : 'text-fg-muted')}
          data-testid="anim-snap"
          onClick={() => trigger('animToggleSnap')}
        >
          <MagnetStraight size={ICON.md} />
        </Button>
      </div>
      {view === 'graph' ? (
        <GraphEditor />
      ) : (
        <div ref={bodyRef} className="relative min-h-0 flex-1 overflow-x-hidden overflow-y-auto px-3 pb-2" onKeyDown={nudge} data-testid="anim-timeline-body">
          {/* 刻度行 */}
          <div className="sticky top-0 z-10 flex h-6 bg-surface-1">
            <div style={{ width: NAME_W }} className="shrink-0" />
            <div ref={laneRef} className="relative flex-1 cursor-ew-resize rounded-sm bg-well" onPointerDown={scrub} data-testid="anim-ruler" role="slider" aria-label={t('transport.scrub')} aria-valuemin={0} aria-valuemax={duration} aria-valuenow={time} tabIndex={-1}>
              {ticks.map((s) => (
                <span key={s} className="absolute top-0 flex h-full items-end pb-0.5 pl-1 text-[10.5px] text-fg-subtle num" style={{ left: `${fx(s) * 100}%` }} data-testid="anim-tick">
                  <span className="absolute top-0 left-0 h-1.5 w-px bg-fg-faint" />
                  {tickLabel(s, fps)}
                </span>
              ))}
              {resolved.cutTime !== null && fx(resolved.cutTime) >= 0 && fx(resolved.cutTime) <= 1 && <span className="absolute top-0 h-full w-0.5 bg-mark" style={{ left: `${fx(resolved.cutTime) * 100}%` }} title={t('transport.cut')} />}
              {showScale && (
                <span className="absolute bottom-0 h-1.5 rounded-sm bg-primary-soft" style={{ left: `${fx(minT) * 100}%`, width: `${(fx(maxT) - fx(minT)) * 100}%` }} data-testid="anim-selection-span">
                  <span role="slider" aria-label={t('anim.keys.scaleStart')} aria-valuenow={minT} tabIndex={-1} className="absolute -top-1 -left-1 h-3 w-2 cursor-ew-resize rounded-[2px] bg-primary" onPointerDown={dragScale('start', minT, maxT)} data-testid="anim-scale-start" />
                  <span role="slider" aria-label={t('anim.keys.scaleEnd')} aria-valuenow={maxT} tabIndex={-1} className="absolute -top-1 -right-1 h-3 w-2 cursor-ew-resize rounded-[2px] bg-primary" onPointerDown={dragScale('end', minT, maxT)} data-testid="anim-scale-end" />
                </span>
              )}
            </div>
          </div>
          {/* 缩放后：整段的缩略条，亮的一段是可见范围，拖它左右滚动 */}
          {zoom && (
            <div className="sticky top-6 z-10 flex h-2 bg-surface-1 pt-0.5">
              <div style={{ width: NAME_W }} className="shrink-0" />
              <div className="relative flex-1 rounded-full bg-well" data-testid="anim-zoom-bar">
                <span
                  role="scrollbar"
                  aria-controls="anim-tracks"
                  aria-orientation="horizontal"
                  aria-valuenow={Math.round((range.start / duration) * 100)}
                  aria-label={t('anim.timeline.scroll')}
                  tabIndex={-1}
                  className="absolute inset-y-0 cursor-grab rounded-full bg-fg-faint hover:bg-fg-subtle"
                  style={{ left: `${(range.start / duration) * 100}%`, width: `${(span / duration) * 100}%` }}
                  data-testid="anim-zoom-thumb"
                  onPointerDown={(e) => {
                    if (e.button !== 0) return;
                    e.stopPropagation();
                    const bar = e.currentTarget.parentElement!.getBoundingClientRect();
                    const x0 = e.clientX;
                    const v0 = zoom;
                    trackPointer(e, { move: (ev) => useAnimationUi.getState().setZoom(panBy(v0, duration, ((ev.clientX - x0) / bar.width) * duration)), up: () => undefined });
                  }}
                />
              </div>
            </div>
          )}
          <div id="anim-tracks" onPointerDown={startBox} data-testid="anim-tracks">
            {layers.length === 0 && (
              <p className="py-3 text-xs text-fg-subtle" style={{ paddingLeft: NAME_W }}>
                {t('anim.layers.empty')}
              </p>
            )}
            {layers.map(({ l: layer, r: rl, depth }) => {
              const open = !!expanded[layer.id];
              const from = fx(rl.from ?? 0);
              const to = fx(Math.min(rl.to ?? duration, duration));
              const LayerIcon = LAYER_ICONS[layer.type];
              const isSelLayer = selectedLayer === layer.id;
              return (
                <div key={layer.id} data-testid="anim-track" data-layer={layer.id}>
                  <div className={cn('flex items-center rounded-sm', isSelLayer && 'bg-control')} style={{ height: ROW_H }}>
                    <button
                      type="button"
                      className={cn('flex min-w-0 shrink-0 items-center gap-1.5 pr-2 text-left text-xs text-fg-muted hover:text-foreground', layer.hidden && 'opacity-60')}
                      style={{ width: NAME_W, paddingLeft: depth * 12 }}
                      onClick={() => useAnimationUi.getState().select({ layer: layer.id, key: null })}
                    >
                      <span
                        role="button"
                        tabIndex={0}
                        aria-label={t(open ? 'anim.timeline.collapse' : 'anim.timeline.expand', { name: layer.name })}
                        aria-expanded={open}
                        className="grid size-4 place-items-center rounded-sm hover:bg-control-hi"
                        data-testid="anim-track-expand"
                        onClick={(e) => {
                          e.stopPropagation();
                          useAnimationUi.getState().toggleExpanded(layer.id);
                        }}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault();
                            e.stopPropagation();
                            useAnimationUi.getState().toggleExpanded(layer.id);
                          }
                        }}
                      >
                        <CaretRight size={ICON.xs - 1} weight={ICON_WEIGHT.active} className={cn('transition-transform duration-(--dur-2)', open && 'rotate-90')} />
                      </span>
                      <LayerIcon size={ICON.xs} className="shrink-0" />
                      <span className={cn('truncate', isSelLayer && 'text-foreground')}>{layer.name}</span>
                    </button>
                    <div className={cn('relative h-full flex-1', zoom && 'overflow-x-clip')}>
                      <span className="absolute top-1/2 h-2.5 -translate-y-1/2 rounded-[3px] bg-control-hi" style={{ left: `${from * 100}%`, width: `${Math.max(0, to - from) * 100}%` }} data-testid="anim-interval" data-layer={layer.id}>
                        {/* 可见区间两端可拖（锁定的图层不能） */}
                        {!layer.locked && (
                          <>
                            <span role="slider" aria-label={t('anim.timeline.intervalStart', { name: layer.name })} aria-valuenow={rl.from ?? 0} tabIndex={-1} className="absolute top-0 -left-0.5 z-[1] h-full w-1.5 cursor-ew-resize rounded-l-[3px] hover:bg-fg-muted" onPointerDown={dragInterval(layer.id, 'from', rl.from ?? 0)} data-testid="anim-interval-from" />
                            <span role="slider" aria-label={t('anim.timeline.intervalEnd', { name: layer.name })} aria-valuenow={Math.min(rl.to ?? duration, duration)} tabIndex={-1} className="absolute top-0 -right-0.5 z-[1] h-full w-1.5 cursor-ew-resize rounded-r-[3px] hover:bg-fg-muted" onPointerDown={dragInterval(layer.id, 'to', Math.min(rl.to ?? duration, duration))} data-testid="anim-interval-to" />
                          </>
                        )}
                      </span>
                      {layerKeyTimes(rl).map((kt) => {
                        const refs = ANIM_PROPS.filter((p) => keysOf(rl.props[p]).some((k) => Math.abs(k.t - kt) < KEY_EPSILON)).map((p) => ({ layer: layer.id, prop: p, t: kt }));
                        const all = refs.length > 0 && refs.every(isSel);
                        return (
                          <Diamond
                            key={kt}
                            x={fx(kt)}
                            selected={all}
                            label={t('anim.timeline.keyAt', { t: kt })}
                            dim
                            data={{ 'key-layer': layer.id, 'key-t': String(kt) }}
                            onPointerDown={layer.locked ? undefined : (e) => dragKeys(refs, e.shiftKey || e.ctrlKey || e.metaKey)(e)}
                          />
                        );
                      })}
                    </div>
                  </div>
                  {open &&
                    ANIM_PROPS.filter((p) => keysOf(rl.props[p]).length > 0).map((prop) => (
                      <div key={prop} className="flex items-center" style={{ height: ROW_H - 2 }} data-testid="anim-prop-track" data-prop={prop}>
                        <span className="shrink-0 truncate pl-9 text-[11px] text-fg-subtle" style={{ width: NAME_W }}>
                          {t(`anim.propNames.${prop}`)}
                        </span>
                        <div className={cn('relative h-full flex-1', zoom && 'overflow-x-clip')}>
                          <span className="absolute top-1/2 h-px w-full bg-divider" />
                          {keysOf(rl.props[prop]).map((k) => {
                            const ref = { layer: layer.id, prop, t: k.t };
                            return (
                              <Diamond
                                key={k.t}
                                x={fx(k.t)}
                                selected={isSel(ref)}
                                label={t('anim.timeline.propKeyAt', { prop: t(`anim.propNames.${prop}`), t: k.t })}
                                testId="anim-key"
                                data={{ 'key-layer': layer.id, 'key-prop': prop, 'key-t': String(k.t) }}
                                onPointerDown={layer.locked ? undefined : (e) => dragKeys([ref], e.shiftKey || e.ctrlKey || e.metaKey)(e)}
                                onKeyDown={nudge}
                              />
                            );
                          })}
                        </div>
                      </div>
                    ))}
                </div>
              );
            })}
            {/* 音效轨 */}
            <div className="mt-1 flex items-center border-t border-divider pt-1" style={{ height: ROW_H + 4 }} data-testid="anim-sound-track">
              <div className="flex shrink-0 items-center gap-1.5 pr-2 text-xs text-fg-muted" style={{ width: NAME_W }}>
                <SpeakerHigh size={ICON.xs} className="ml-[22px] shrink-0" />
                <span className="min-w-0 flex-1 truncate">{t('anim.sounds.track')}</span>
                <Button variant="ghost" size="icon-xs" aria-label={t('anim.sounds.add')} title={t('anim.sounds.add')} data-testid="anim-sound-add" onClick={() => trigger('animAddSound', { sound: DEFAULT_SOUND })}>
                  <Plus size={ICON.xs} />
                </Button>
              </div>
              <div className={cn('relative h-full flex-1', zoom && 'overflow-x-clip')}>
                <span className="absolute top-1/2 h-px w-full bg-divider" />
                {resolved.sounds.map((s, i) => {
                  const id = doc.sounds[i]?.id;
                  if (!id) return null;
                  return (
                    <button
                      key={id}
                      type="button"
                      aria-label={t('anim.sounds.atLabel', { t: s.at })}
                      aria-pressed={selSound === id}
                      data-testid="anim-sound"
                      data-sound={id}
                      className={cn('absolute top-1/2 z-[1] h-4 w-1.5 -translate-x-1/2 -translate-y-1/2 rounded-[2px]', selSound === id ? 'bg-primary' : 'bg-cue hover:brightness-125')}
                      style={{ left: `${fx(s.at) * 100}%` }}
                      onPointerDown={dragSound(id, s.at)}
                    />
                  );
                })}
              </div>
            </div>
          </div>
          {/* 框选的框 */}
          {box && bodyRef.current && (
            <span
              className="pointer-events-none fixed z-20 rounded-sm bg-primary-soft"
              style={{ left: Math.min(box.x0, box.x1), top: Math.min(box.y0, box.y1), width: Math.abs(box.x1 - box.x0), height: Math.abs(box.y1 - box.y0) }}
              data-testid="anim-box"
            />
          )}
          {/* 播放头 */}
          <div className={cn('pointer-events-none absolute top-0 bottom-0 z-[2]', (playX < 0 || playX > 1) && 'hidden')} style={{ left: `calc(12px + ${NAME_W}px + (100% - 24px - ${NAME_W}px) * ${playX})` }}>
            <span className="absolute top-0 bottom-0 w-px bg-primary" data-testid="anim-playhead" />
          </div>
        </div>
      )}
    </section>
  );
}
