// 动画的时间轴（docs/animation-editor.md 5.3）：动画工作区里替代模板的阶段时间轴（不碰 TimelineTrack）。
// 上面是与模板时间轴一样的播放条；下面左侧是图层名（可展开成八个属性），右侧是刻度、图层的可见区间条、关键帧菱形和播放头。
// 点刻度或空白处定位；拖菱形改关键帧的时刻（一次拖动一步撤销）；点菱形选中它，右栏显示它的数值和缓动。
// 键盘：菱形可聚焦，左右键按一帧挪动，Delete 删除。
import { frameCount } from '@allay/engine/frames';
import { Button } from '@allay/ui/components/button';
import { ICON, ICON_WEIGHT } from '@allay/ui/lib/icons';
import { cn } from '@allay/ui/lib/utils';
import { CaretRight, Pause, Play, Repeat, SkipBack, SkipForward } from '@phosphor-icons/react';
import { useRef, type PointerEvent as ReactPointerEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { KEY_EPSILON, keysOf, layerKeyTimes } from '../../../shared/animation/edit';
import { ANIM_PROPS, type AnimProp, type Layer } from '../../../shared/animation/schema';
import { trigger } from '../../app/registry';
import { usePreviewStore } from '../../stores/previewStore';
import { beginGesture, endGesture, useProjectStore } from '../../stores/projectStore';
import { useTransportStore } from '../../stores/transportStore';
import { togglePlay } from '../commands/commands';
import { formatTimecode, usePlayback } from '../transport/TransportBar';
import { LAYER_ICONS } from './LayersPanel';
import { useAnimationUi } from './uiState';

const NAME_W = 168;
const ROW_H = 24;

/** 刻度的间隔（秒）：让相邻两个刻度至少隔 56 px */
function tickStep(duration: number, width: number): number {
  for (const s of [0.1, 0.25, 0.5, 1, 2, 5, 10]) if ((s / duration) * width >= 56) return s;
  return 10;
}

function Diamond({ x, selected, onPointerDown, onKeyDown, label, testId, dim }: { x: number; selected: boolean; onPointerDown?: (e: ReactPointerEvent) => void; onKeyDown?: (e: React.KeyboardEvent) => void; label: string; testId?: string; dim?: boolean }) {
  return (
    <button
      type="button"
      tabIndex={onKeyDown ? 0 : -1}
      aria-label={label}
      aria-pressed={selected}
      data-testid={testId}
      className={cn(
        'absolute top-1/2 size-[9px] -translate-x-1/2 -translate-y-1/2 rotate-45 rounded-[1.5px] focus-visible:outline-2 focus-visible:outline-ring',
        selected ? 'bg-primary' : dim ? 'bg-fg-subtle' : 'bg-fg-muted hover:bg-foreground',
      )}
      style={{ left: `${x * 100}%` }}
      onPointerDown={onPointerDown}
      onKeyDown={onKeyDown}
    />
  );
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
  const selectedKey = useAnimationUi((s) => s.key);
  const expanded = useAnimationUi((s) => s.expanded);
  const laneRef = useRef<HTMLDivElement>(null);
  if (!doc) return null;
  const duration = doc.duration;
  const total = frameCount(duration, fps);
  const snap = (x: number) => Math.min(duration, Math.max(0, Math.round(x * fps) / fps));

  const timeAt = (clientX: number): number => {
    const r = laneRef.current?.getBoundingClientRect();
    if (!r || r.width <= 0) return 0;
    return snap(((clientX - r.left) / r.width) * duration);
  };

  /** 在刻度或空白处按下：定位并跟着拖 */
  const scrub = (e: ReactPointerEvent) => {
    if (e.button !== 0) return;
    const target = e.currentTarget as HTMLElement;
    target.setPointerCapture(e.pointerId);
    useTransportStore.getState().setPlaying(false);
    useTransportStore.getState().setTime(timeAt(e.clientX));
    const move = (ev: PointerEvent) => useTransportStore.getState().setTime(timeAt(ev.clientX));
    const up = () => {
      target.removeEventListener('pointermove', move);
      target.removeEventListener('pointerup', up);
    };
    target.addEventListener('pointermove', move);
    target.addEventListener('pointerup', up);
  };

  /** 拖一个属性的关键帧（只有展开后的属性行能拖：图层行的菱形是几个属性合在一起的） */
  const dragKey = (layer: Layer, prop: AnimProp, keyT: number) => (e: ReactPointerEvent) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    const target = e.currentTarget as HTMLElement;
    target.setPointerCapture(e.pointerId);
    useAnimationUi.getState().select({ layer: layer.id, key: { layer: layer.id, prop, t: keyT } });
    useTransportStore.getState().setPlaying(false);
    let current = keyT;
    let started = false;
    const move = (ev: PointerEvent) => {
      const next = timeAt(ev.clientX);
      if (Math.abs(next - current) < KEY_EPSILON) return;
      if (!started) {
        beginGesture();
        started = true;
      }
      trigger('animMoveKeyframe', { layer: layer.id, prop, from: current, to: next });
      current = next;
      useAnimationUi.getState().select({ layer: layer.id, key: { layer: layer.id, prop, t: next } });
    };
    const up = () => {
      target.removeEventListener('pointermove', move);
      target.removeEventListener('pointerup', up);
      target.removeEventListener('pointercancel', up);
      if (started) endGesture();
      else useTransportStore.getState().setTime(keyT);
    };
    target.addEventListener('pointermove', move);
    target.addEventListener('pointerup', up);
    target.addEventListener('pointercancel', up);
  };

  const keyKeys = (layer: Layer, prop: AnimProp, keyT: number) => (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      e.preventDefault();
      const to = snap(keyT + (e.key === 'ArrowLeft' ? -1 : 1) / fps);
      trigger('animMoveKeyframe', { layer: layer.id, prop, from: keyT, to });
      useAnimationUi.getState().select({ layer: layer.id, key: { layer: layer.id, prop, t: to } });
    } else if (e.key === 'Delete' || e.key === 'Backspace') {
      e.preventDefault();
      trigger('animRemoveKeyframe', { layer: layer.id, prop, t: keyT });
      useAnimationUi.getState().select({ layer: layer.id, key: null });
    }
  };

  const step = tickStep(duration, 600);
  const ticks: number[] = [];
  for (let s = 0; s <= duration + 1e-9; s += step) ticks.push(Math.round(s * 1000) / 1000);
  const layers = [...doc.layers].reverse();
  const playX = duration > 0 ? time / duration : 0;

  return (
    <section aria-label={t('anim.timeline.region')} className="flex h-full shrink-0 flex-col rounded-xl bg-surface-1" data-testid="anim-timeline">
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
        <span className="text-xs text-fg-subtle">{t('anim.timeline.hint')}</span>
      </div>
      <div className="relative min-h-0 flex-1 overflow-y-auto overflow-x-hidden px-3 pb-2">
        {/* 刻度行 */}
        <div className="sticky top-0 z-10 flex h-6 bg-surface-1">
          <div style={{ width: NAME_W }} className="shrink-0" />
          <div ref={laneRef} className="relative flex-1 cursor-ew-resize rounded-sm bg-well" onPointerDown={scrub} data-testid="anim-ruler" role="slider" aria-label={t('transport.scrub')} aria-valuemin={0} aria-valuemax={duration} aria-valuenow={time} tabIndex={-1}>
            {ticks.map((s) => (
              <span key={s} className="absolute top-0 flex h-full items-end pb-0.5 pl-1 text-[10.5px] text-fg-subtle num" style={{ left: `${(s / duration) * 100}%` }}>
                <span className="absolute top-0 left-0 h-1.5 w-px bg-fg-faint" />
                {s}s
              </span>
            ))}
            {doc.cutTime !== null && <span className="absolute top-0 h-full w-0.5 bg-mark" style={{ left: `${(doc.cutTime / duration) * 100}%` }} title={t('transport.cut')} />}
          </div>
        </div>
        {layers.length === 0 && <p className="py-3 text-xs text-fg-subtle" style={{ paddingLeft: NAME_W }}>{t('anim.layers.empty')}</p>}
        {layers.map((layer) => {
          const open = !!expanded[layer.id];
          const from = (layer.from ?? 0) / duration;
          const to = Math.min(1, (layer.to ?? duration) / duration);
          const LayerIcon = LAYER_ICONS[layer.type];
          const isSel = selectedLayer === layer.id;
          return (
            <div key={layer.id} data-testid="anim-track" data-layer={layer.id}>
              <div className={cn('flex items-center rounded-sm', isSel && 'bg-control')} style={{ height: ROW_H }}>
                <button type="button" className="flex min-w-0 shrink-0 items-center gap-1.5 pr-2 text-left text-xs text-fg-muted hover:text-foreground" style={{ width: NAME_W }} onClick={() => useAnimationUi.getState().select({ layer: layer.id, key: null })}>
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
                  <span className={cn('truncate', isSel && 'text-foreground')}>{layer.name}</span>
                </button>
                <div className="relative h-full flex-1" onPointerDown={scrub}>
                  <span className="absolute top-1/2 h-2.5 -translate-y-1/2 rounded-[3px] bg-control-hi" style={{ left: `${from * 100}%`, width: `${Math.max(0, to - from) * 100}%` }} />
                  {layerKeyTimes(layer).map((kt) => (
                    <Diamond key={kt} x={kt / duration} selected={!!selectedKey && selectedKey.layer === layer.id && Math.abs(selectedKey.t - kt) < KEY_EPSILON} label={t('anim.timeline.keyAt', { t: kt })} dim />
                  ))}
                </div>
              </div>
              {open &&
                ANIM_PROPS.filter((p) => keysOf(layer.props[p]).length > 0 || p === selectedKey?.prop).map((prop) => (
                  <div key={prop} className="flex items-center" style={{ height: ROW_H - 2 }} data-testid="anim-prop-track" data-prop={prop}>
                    <span className="shrink-0 truncate pl-9 text-[11px] text-fg-subtle" style={{ width: NAME_W }}>
                      {t(`anim.propNames.${prop}`)}
                    </span>
                    <div className="relative h-full flex-1" onPointerDown={scrub}>
                      <span className="absolute top-1/2 h-px w-full bg-divider" />
                      {keysOf(layer.props[prop]).map((k) => (
                        <Diamond
                          key={k.t}
                          x={k.t / duration}
                          selected={!!selectedKey && selectedKey.layer === layer.id && selectedKey.prop === prop && Math.abs(selectedKey.t - k.t) < KEY_EPSILON}
                          label={t('anim.timeline.propKeyAt', { prop: t(`anim.propNames.${prop}`), t: k.t })}
                          testId="anim-key"
                          onPointerDown={dragKey(layer, prop, k.t)}
                          onKeyDown={keyKeys(layer, prop, k.t)}
                        />
                      ))}
                    </div>
                  </div>
                ))}
            </div>
          );
        })}
        {/* 播放头 */}
        <div className="pointer-events-none absolute top-0 bottom-0" style={{ left: `calc(12px + ${NAME_W}px + (100% - 24px - ${NAME_W}px) * ${playX})` }}>
          <span className="absolute top-0 bottom-0 w-px bg-primary" data-testid="anim-playhead" />
        </div>
      </div>
    </section>
  );
}
