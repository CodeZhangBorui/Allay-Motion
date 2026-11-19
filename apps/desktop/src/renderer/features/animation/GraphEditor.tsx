// 曲线视图（图表编辑器，docs/animation-editor.md 10.3）：时间轴的另一种视图。
// 左侧列出选中图层（没选时是全部图层）有关键帧的属性，点一下显示或隐藏；右侧把显示的属性叠在同一张图上，
// 每条属性一种颜色（只用设计变量里已有的颜色）。纵轴自动取显示的曲线的范围；“各自的纵轴”打开时每条曲线各用自己的
// 范围（读数跟着最后点中的那条，用它的颜色写），量程差很大的属性叠在一起时小量程的不会被压平。
// - 数值曲线：关键帧是小方块，拖动改时刻（对齐到帧）和数值（绑定到参数的值改参数的默认值）；
//   选中的关键帧两侧画出这一段缓动的贝塞尔手柄，拖手柄改这一段的缓动（预设缓动先换成同样形状的贝塞尔）。
//   弹性、回弹、保持这类不是一条三次贝塞尔的缓动不给手柄。
// - 速度曲线：数值对时间的变化率（每秒），只看，不能拖。
// 在空白处拖出框选；Shift / Ctrl 点击加选。选择与关键帧视图共用。
import { cn } from '@allay/ui/lib/utils';
import { useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { easeToBezier, KEY_EPSILON, keysOf, moveKeysAndValues, round, sameKey, sampleTrack, setSegmentBezier, trackSpeed, type KeyRef } from '../../../shared/animation/edit';
import { resolveDoc } from '../../../shared/animation/resolve';
import { fracOf, viewRange } from '../../../shared/animation/time-view';
import { ANIM_PROPS, isKeyed, PROP_DEFAULTS, type AnimProp } from '../../../shared/animation/schema';
import { beginGesture, endGesture, useProjectStore } from '../../stores/projectStore';
import { useTransportStore } from '../../stores/transportStore';
import { easeEval } from './easeEval';
import { currentAnimation, replaceDoc } from './source';
import { trackPointer } from './pointer';
import { useAnimationUi } from './uiState';

const NAME_W = 168;
const PAD_Y = 14;
const SAMPLES = 240;
/** 每条属性的颜色：设计变量里已有的颜色（强调、阶段、音效、标记），不新增 */
const COLORS: Record<AnimProp, string> = {
  x: 'var(--primary)',
  y: 'var(--cue)',
  z: 'var(--stage-exit)',
  rotX: 'var(--mark)',
  rotY: 'var(--stage-enter)',
  rotZ: 'var(--danger)',
  scale: 'var(--warning)',
  opacity: 'var(--fg-muted)',
  progress: 'var(--stage-hold)',
};

interface Curve {
  layer: string;
  layerName: string;
  prop: AnimProp;
}

export function GraphEditor() {
  const { t } = useTranslation();
  const doc = useProjectStore((s) => s.template?.animation?.doc ?? null);
  const fps = useProjectStore((s) => s.output.fps);
  const time = useTransportStore((s) => s.time);
  const selectedLayer = useAnimationUi((s) => s.layer);
  const selKeys = useAnimationUi((s) => s.keys);
  const mode = useAnimationUi((s) => s.graphMode);
  /** 每条曲线各自的纵轴（量程差很大的属性叠在一起时，小量程的不至于被压平） */
  const separate = useAnimationUi((s) => s.graphSeparate);
  const zoom = useAnimationUi((s) => s.zoom);
  const [hidden, setHidden] = useState<Record<string, boolean>>({});
  const [box, setBox] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null);
  const plotRef = useRef<SVGSVGElement>(null);
  const resolved = useMemo(() => (doc ? resolveDoc(doc) : null), [doc]);
  const [size, setSize] = useState({ w: 600, h: 160 });
  const sizeRef = useRef<HTMLDivElement>(null);

  const curves: Curve[] = useMemo(() => {
    if (!resolved) return [];
    const out: Curve[] = [];
    for (const l of resolved.layers) {
      if (selectedLayer && l.id !== selectedLayer) continue;
      for (const p of ANIM_PROPS) if (keysOf(l.props[p]).length > 0) out.push({ layer: l.id, layerName: l.name, prop: p });
    }
    return out;
  }, [resolved, selectedLayer]);

  // 跟着容器的大小（SVG 用像素坐标，好算手柄）
  const measure = (el: HTMLDivElement | null) => {
    sizeRef.current = el;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      const r = el.getBoundingClientRect();
      setSize((s) => (Math.abs(s.w - r.width) > 0.5 || Math.abs(s.h - r.height) > 0.5 ? { w: Math.max(50, r.width), h: Math.max(40, r.height) } : s));
    });
    ro.observe(el);
  };

  if (!doc || !resolved) return null;
  const duration = resolved.duration;
  const range = viewRange(zoom, duration);
  const visible = curves.filter((c) => !hidden[`${c.layer}.${c.prop}`]);
  const layerOf = (id: string) => resolved.layers.find((l) => l.id === id)!;
  const evalAt = (c: Curve, tt: number) => {
    const tr = layerOf(c.layer).props[c.prop];
    return mode === 'speed' ? trackSpeed(tr, PROP_DEFAULTS[c.prop], tt, easeEval) : sampleTrack(tr, PROP_DEFAULTS[c.prop], tt, easeEval);
  };
  // 纵轴范围：每条曲线自己的最小、最大值；不分开时所有显示的曲线共用一个范围
  const rangeOfCurve = (c: Curve): [number, number] => {
    let lo = Infinity;
    let hi = -Infinity;
    for (let i = 0; i <= SAMPLES; i++) {
      const v = evalAt(c, (i / SAMPLES) * duration);
      lo = Math.min(lo, v);
      hi = Math.max(hi, v);
    }
    return [lo, hi];
  };
  const widen = ([lo, hi]: [number, number]): [number, number] => {
    if (!Number.isFinite(lo)) return [-1, 1];
    if (hi - lo < 1e-6) return [lo - 1, hi + 1];
    return [lo, hi];
  };
  const ranges = new Map<string, [number, number]>();
  let shared: [number, number] = [Infinity, -Infinity];
  for (const c of visible) {
    const r = rangeOfCurve(c);
    ranges.set(`${c.layer}.${c.prop}`, widen(r));
    shared = [Math.min(shared[0], r[0]), Math.max(shared[1], r[1])];
  }
  shared = widen(shared);
  const rangeOf = (c: Curve): [number, number] => (separate ? (ranges.get(`${c.layer}.${c.prop}`) ?? shared) : shared);
  // 纵轴读数跟着的曲线：分开时是最后点中的关键帧所在的那条，否则是第一条显示的
  const focus = visible.find((c) => selKeys.at(-1)?.layer === c.layer && selKeys.at(-1)?.prop === c.prop) ?? visible[0];
  const [lo, hi] = focus ? rangeOf(focus) : shared;
  const { w, h } = size;
  // 横轴是时间轴的可见范围（缩放、滚动，第 11 项）
  const xOf = (tt: number) => fracOf(range, tt) * w;
  const yOf = (c: Curve, v: number) => {
    const [a, b] = rangeOf(c);
    return PAD_Y + (1 - (v - a) / (b - a)) * (h - PAD_Y * 2);
  };
  const tOf = (x: number) => Math.min(duration, Math.max(0, Math.round((range.start + (x / w) * (range.end - range.start)) * fps) / fps));
  const vOf = (c: Curve, y: number) => {
    const [a, b] = rangeOf(c);
    return a + (1 - (y - PAD_Y) / (h - PAD_Y * 2)) * (b - a);
  };
  const local = (e: { clientX: number; clientY: number }) => {
    const r = plotRef.current!.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };
  const isSel = (k: KeyRef) => selKeys.some((s) => sameKey(s, k));

  /** 拖关键帧：横向改时刻、纵向改数值（整组一起：时刻差、数值差都一样） */
  const dragKey = (c: Curve, kt: number) => (e: ReactPointerEvent) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    const ref = { layer: c.layer, prop: c.prop, t: kt };
    const ui = useAnimationUi.getState();
    if (e.shiftKey || e.ctrlKey || e.metaKey) {
      ui.selectKeys([ref], 'toggle');
      return;
    }
    const already = isSel(ref);
    if (!already) ui.selectKeys([ref]);
    if (mode === 'speed') return;
    const group = useAnimationUi.getState().keys;
    const cur = currentAnimation();
    if (!cur) return;
    const base = cur.doc;
    const p0 = local(e);
    let started = false;
    const move = (ev: PointerEvent) => {
      const p = local(ev);
      if (!started && Math.hypot(p.x - p0.x, p.y - p0.y) < 3) return;
      if (!started) {
        beginGesture();
        started = true;
      }
      const dt = ev.shiftKey ? 0 : tOf(xOf(kt) + (p.x - p0.x)) - kt;
      const dv = ev.altKey ? 0 : vOf(c, p.y) - vOf(c, p0.y);
      const next = moveKeysAndValues(base, group, dt, dv, duration);
      if (next && replaceDoc(next.doc)) useAnimationUi.getState().selectKeys(next.refs);
    };
    const up = () => {
      if (started) endGesture();
      else {
        // 点了一下（没拖）：只选它
        if (already) useAnimationUi.getState().selectKeys([ref]);
        useTransportStore.getState().setTime(kt);
      }
    };
    trackPointer(e, { move, up });
  };

  /** 拖贝塞尔手柄：which = 0 是出点（x1, y1），1 是入点（x2, y2） */
  const dragHandle = (c: Curve, segT: number, which: 0 | 1) => (e: ReactPointerEvent) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    const cur = currentAnimation();
    if (!cur) return;
    const tr = layerOf(c.layer).props[c.prop];
    const keys = keysOf(tr);
    const i = keys.findIndex((k) => Math.abs(k.t - segT) < KEY_EPSILON);
    const a = keys[i];
    const b = keys[i + 1];
    if (!a || !b) return;
    const bez = easeToBezier(a.ease);
    if (!bez) return;
    const base = cur.doc;
    let started = false;
    const move = (ev: PointerEvent) => {
      if (!started) {
        beginGesture();
        started = true;
      }
      const p = local(ev);
      const nx = (range.start + (p.x / w) * (range.end - range.start) - a.t) / (b.t - a.t);
      const ny = (vOf(c, p.y) - a.v) / (b.v - a.v);
      const next: [number, number, number, number] = which === 0 ? [nx, ny, bez[2], bez[3]] : [bez[0], bez[1], nx, ny];
      const draft = structuredClone(base);
      const l = draft.layers.find((x) => x.id === c.layer);
      const raw = l?.props[c.prop];
      if (!l || !isKeyed(raw)) return;
      const r = setSegmentBezier(raw, i, next);
      if (!r) return;
      l.props[c.prop] = r;
      replaceDoc(draft);
    };
    const up = () => {
      if (started) endGesture();
    };
    trackPointer(e, { move, up });
  };

  /** 框选（在空白处拖）；点一下是定位 */
  const startBox = (e: ReactPointerEvent) => {
    if (e.button !== 0) return;
    const p0 = local(e);
    const additive = e.shiftKey || e.ctrlKey || e.metaKey;
    let moved = false;
    const move = (ev: PointerEvent) => {
      const p = local(ev);
      if (!moved && Math.hypot(p.x - p0.x, p.y - p0.y) < 3) return;
      moved = true;
      setBox({ x0: p0.x, y0: p0.y, x1: p.x, y1: p.y });
    };
    const up = (ev: PointerEvent) => {
      setBox(null);
      const p = local(ev);
      if (!moved) {
        if (!additive) useAnimationUi.getState().selectKeys([]);
        useTransportStore.getState().setPlaying(false);
        useTransportStore.getState().setTime(tOf(p.x));
        return;
      }
      const [x0, x1] = [Math.min(p0.x, p.x), Math.max(p0.x, p.x)];
      const [y0, y1] = [Math.min(p0.y, p.y), Math.max(p0.y, p.y)];
      const hits: KeyRef[] = [];
      for (const c of visible) {
        for (const k of keysOf(layerOf(c.layer).props[c.prop])) {
          const kx = xOf(k.t);
          const ky = yOf(c, mode === 'speed' ? evalAt(c, k.t) : k.v);
          // 框碰到小方块（边长 8）就算选中
          if (kx + 4 >= x0 && kx - 4 <= x1 && ky + 4 >= y0 && ky - 4 <= y1) hits.push({ layer: c.layer, prop: c.prop, t: k.t });
        }
      }
      useAnimationUi.getState().selectKeys(hits, additive ? 'add' : 'replace');
    };
    trackPointer(e, { move, up });
  };

  const path = (c: Curve) => {
    const pts: string[] = [];
    for (let i = 0; i <= SAMPLES; i++) {
      const tt = range.start + (i / SAMPLES) * (range.end - range.start);
      pts.push(`${xOf(tt).toFixed(1)},${yOf(c, evalAt(c, tt)).toFixed(1)}`);
    }
    return `M${pts.join('L')}`;
  };

  return (
    <div className="relative flex min-h-0 flex-1 px-3 pb-2" data-testid="anim-graph" data-mode={mode}>
      <ul className="flex shrink-0 flex-col gap-0.5 overflow-y-auto pr-2" style={{ width: NAME_W }} aria-label={t('anim.graph.curves')}>
        {curves.length === 0 && <li className="text-xs leading-snug text-fg-subtle">{t('anim.graph.empty')}</li>}
        {curves.map((c) => {
          const id = `${c.layer}.${c.prop}`;
          const on = !hidden[id];
          return (
            <li key={id}>
              <button
                type="button"
                aria-pressed={on}
                className={cn('flex h-6 w-full items-center gap-1.5 rounded-sm px-1 text-left text-xs hover:bg-control', on ? 'text-foreground' : 'text-fg-subtle')}
                onClick={() => setHidden((s) => ({ ...s, [id]: on }))}
                data-testid="anim-graph-curve"
                data-curve={id}
              >
                <span className="size-2 shrink-0 rounded-full" style={{ background: on ? COLORS[c.prop] : 'var(--control-hi)' }} />
                <span className="min-w-0 truncate">{selectedLayer ? t(`anim.propNames.${c.prop}`) : `${c.layerName} · ${t(`anim.propNames.${c.prop}`)}`}</span>
              </button>
            </li>
          );
        })}
      </ul>
      <div ref={measure} className="relative min-w-0 flex-1 overflow-hidden rounded-sm bg-well">
        <svg ref={plotRef} width={w} height={h} className="absolute inset-0 select-none" onPointerDown={startBox} data-testid="anim-graph-plot" role="img" aria-label={t(mode === 'speed' ? 'anim.graph.speed' : 'anim.graph.value')}>
          {/* 零线与范围读数 */}
          {!separate && focus && lo < 0 && hi > 0 && <line x1={0} x2={w} y1={yOf(focus, 0)} y2={yOf(focus, 0)} stroke="var(--divider)" strokeWidth={1} />}
          <text x={4} y={11} fontSize={10} fill={separate && focus ? COLORS[focus.prop] : 'var(--fg-subtle)'} className="num" data-testid="anim-graph-max">
            {round(hi, 2)}
            {mode === 'speed' ? ' /s' : ''}
          </text>
          <text x={4} y={h - 4} fontSize={10} fill={separate && focus ? COLORS[focus.prop] : 'var(--fg-subtle)'} className="num" data-testid="anim-graph-min">
            {round(lo, 2)}
            {mode === 'speed' ? ' /s' : ''}
          </text>
          {visible.map((c) => (
            <path key={`${c.layer}.${c.prop}`} d={path(c)} fill="none" stroke={COLORS[c.prop]} strokeWidth={1.5} data-testid="anim-graph-path" />
          ))}
          {/* 选中关键帧所在段的贝塞尔手柄（只在数值曲线上） */}
          {mode === 'value' &&
            visible.flatMap((c) => {
              const keys = keysOf(layerOf(c.layer).props[c.prop]);
              return keys.slice(0, -1).flatMap((a, i) => {
                const b = keys[i + 1]!;
                const touching = isSel({ layer: c.layer, prop: c.prop, t: a.t }) || isSel({ layer: c.layer, prop: c.prop, t: b.t });
                const bez = touching && Math.abs(b.v - a.v) > 1e-9 ? easeToBezier(a.ease) : null;
                if (!bez) return [];
                const h1 = { x: xOf(a.t + bez[0] * (b.t - a.t)), y: yOf(c, a.v + bez[1] * (b.v - a.v)) };
                const h2 = { x: xOf(a.t + bez[2] * (b.t - a.t)), y: yOf(c, a.v + bez[3] * (b.v - a.v)) };
                return [
                  <g key={`${c.layer}.${c.prop}.${a.t}.h`}>
                    <line x1={xOf(a.t)} y1={yOf(c, a.v)} x2={h1.x} y2={h1.y} stroke="var(--fg-subtle)" strokeWidth={1} />
                    <line x1={xOf(b.t)} y1={yOf(c, b.v)} x2={h2.x} y2={h2.y} stroke="var(--fg-subtle)" strokeWidth={1} />
                    <circle cx={h1.x} cy={h1.y} r={4} fill="var(--surface-1)" stroke={COLORS[c.prop]} strokeWidth={1.5} className="cursor-move" onPointerDown={dragHandle(c, a.t, 0)} data-testid="anim-graph-handle" data-handle="out" />
                    <circle cx={h2.x} cy={h2.y} r={4} fill="var(--surface-1)" stroke={COLORS[c.prop]} strokeWidth={1.5} className="cursor-move" onPointerDown={dragHandle(c, a.t, 1)} data-testid="anim-graph-handle" data-handle="in" />
                  </g>,
                ];
              });
            })}
          {visible.flatMap((c) =>
            keysOf(layerOf(c.layer).props[c.prop]).map((k) => {
              const ref = { layer: c.layer, prop: c.prop, t: k.t };
              const sel = isSel(ref);
              const y = yOf(c, mode === 'speed' ? evalAt(c, k.t) : k.v);
              return (
                <rect
                  key={`${c.layer}.${c.prop}.${k.t}`}
                  x={xOf(k.t) - 4}
                  y={y - 4}
                  width={8}
                  height={8}
                  rx={1.5}
                  fill={sel ? 'var(--primary)' : 'var(--surface-1)'}
                  stroke={COLORS[c.prop]}
                  strokeWidth={1.5}
                  className={mode === 'value' ? 'cursor-move' : 'cursor-pointer'}
                  onPointerDown={dragKey(c, k.t)}
                  data-testid="anim-graph-key"
                  data-key-layer={c.layer}
                  data-key-prop={c.prop}
                  data-key-t={k.t}
                  aria-label={t('anim.timeline.propKeyAt', { prop: t(`anim.propNames.${c.prop}`), t: k.t })}
                />
              );
            }),
          )}
          <line x1={xOf(time)} x2={xOf(time)} y1={0} y2={h} stroke="var(--primary)" strokeWidth={1} pointerEvents="none" />
          {box && <rect x={Math.min(box.x0, box.x1)} y={Math.min(box.y0, box.y1)} width={Math.abs(box.x1 - box.x0)} height={Math.abs(box.y1 - box.y0)} fill="var(--primary-soft)" pointerEvents="none" data-testid="anim-graph-box" />}
        </svg>
      </div>
      <p className="pointer-events-none absolute right-5 bottom-3 text-[11px] text-fg-subtle">{t(mode === 'speed' ? 'anim.graph.speedHint' : 'anim.graph.valueHint')}</p>
    </div>
  );
}
