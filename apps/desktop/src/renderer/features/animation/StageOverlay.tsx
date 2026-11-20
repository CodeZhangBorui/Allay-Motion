// 预览画面上的选择与变换（docs/animation-editor.md 6.10）：动画工作区里盖在预览上的一层。
// - 点画面选中图层（画在最前面的、可见、没锁定的），Shift / Ctrl 加选；点空白处取消选择。
// - 选中的图层画出外框；最后点中的那个有四角的缩放手柄和上方的旋转手柄。拖框内移动，拖角缩放（等比），拖上方手柄旋转（Shift 按 15° 吸附）。
// - 移动时图层中心吸附到舞台中线、四边和别的图层的中心（6 像素内），吸住时画参考线；按住 Alt 不吸附。
// - 改的是当前时刻的 x、y、scale、rotZ：有关键帧的自动落关键帧，绑定到参数的改参数的默认值（同检查器）。一次拖动一步撤销。
// - 图层有路径时画出路径（父级坐标里、加上 x、y 的偏移）：拖点移动，拖手柄改弯度，按住 Alt 从点上拖出一对对称的手柄。
// 几何是平面近似（stage-geometry.ts）：透视相机下、有 z 时框会偏；文字的宽高是估的。
import { cn } from '@allay/ui/lib/utils';
import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { setPropValues } from '../../../shared/animation/params';
import { resolveDoc } from '../../../shared/animation/resolve';
import { apply, corners, hitTest, invert, layerFrames, snapPoint, stageSize, type LayerFrame } from '../../../shared/animation/stage-geometry';
import { round } from '../../../shared/animation/edit';
import { pathPolyline } from '../../../shared/animation/path';
import { beginGesture, endGesture, useProjectStore } from '../../stores/projectStore';
import { useTransportStore } from '../../stores/transportStore';
import { easeEval } from './easeEval';
import { trackPointer } from './pointer';
import { currentAnimation, replaceDoc } from './source';
import { useAnimationUi } from './uiState';

const SNAP_PX = 6;
const HANDLE = 8;

interface Box {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** 预览画框（preview-frame）在这一层里的位置：跟着窗口大小、缩放、滚动变 */
function useFrameBox(host: React.RefObject<HTMLDivElement | null>): Box | null {
  const [box, setBox] = useState<Box | null>(null);
  useEffect(() => {
    const el = host.current;
    const section = el?.parentElement;
    const frame = section?.querySelector<HTMLElement>('[data-testid="preview-frame"]');
    if (!el || !section || !frame) return undefined;
    const measure = () => {
      const s = section.getBoundingClientRect();
      const f = frame.getBoundingClientRect();
      setBox((b) => {
        const next = { left: f.left - s.left, top: f.top - s.top, width: f.width, height: f.height };
        return b && Math.abs(b.left - next.left) < 0.5 && Math.abs(b.top - next.top) < 0.5 && Math.abs(b.width - next.width) < 0.5 && Math.abs(b.height - next.height) < 0.5 ? b : next;
      });
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(section);
    ro.observe(frame);
    const scroller = frame.parentElement;
    scroller?.addEventListener('scroll', measure);
    return () => {
      ro.disconnect();
      scroller?.removeEventListener('scroll', measure);
    };
  }, [host]);
  return box;
}

export function StageOverlay() {
  const { t } = useTranslation();
  const hostRef = useRef<HTMLDivElement>(null);
  const box = useFrameBox(hostRef);
  const doc = useProjectStore((s) => s.template?.animation?.doc ?? null);
  const output = useProjectStore((s) => s.output);
  const time = useTransportStore((s) => s.time);
  const selected = useAnimationUi((s) => s.layers);
  const primary = useAnimationUi((s) => s.layer);
  const [guides, setGuides] = useState<{ x: number | null; y: number | null }>({ x: null, y: null });
  const resolved = useMemo(() => (doc ? resolveDoc(doc) : null), [doc]);
  const stageH = stageSize(output).height;
  const frames = useMemo(() => (resolved ? layerFrames(resolved, time, easeEval, stageH) : []), [resolved, time, stageH]);
  if (!doc || !resolved || !box) return <div ref={hostRef} className="hidden" />;
  const stage = stageSize(output);
  const k = box.width / stage.width;
  const toScreen = (p: { x: number; y: number }) => ({ x: (p.x + stage.width / 2) * k, y: (stage.height / 2 - p.y) * k });
  const toStageIn = (r: DOMRect, clientX: number, clientY: number) => ({ x: (clientX - r.left) / k - stage.width / 2, y: stage.height / 2 - (clientY - r.top) / k });
  const toStage = (clientX: number, clientY: number) => toStageIn(hostRef.current!.getBoundingClientRect(), clientX, clientY);
  const frameOf = (id: string) => frames.find((f) => f.id === id);
  /** 图层中心在画面上的位置（透视时已按深度缩放） */
  const centerOf = (f: LayerFrame) => apply(f.screen, 0, 0);

  /** 拖动：从按下时的那份文档重新算（一次手势、一步撤销） */
  const startDrag = (e: ReactPointerEvent, kind: 'move' | 'scale' | 'rotate', id: string) => {
    const cur = currentAnimation();
    const f = frameOf(id);
    if (!cur || !f) return;
    const base = cur.doc;
    const at = useTransportStore.getState().time;
    useTransportStore.getState().setPlaying(false);
    // 起点都取当前时刻（frames 按当前时刻算）：中心、自己的缩放（世界缩放 ÷ 父级缩放）、自己的旋转。
    // 画框的位置在按下时记下：拖动中界面重画（预览重新装载），不再去读元素
    const rect0 = hostRef.current!.getBoundingClientRect();
    const start = toStageIn(rect0, e.clientX, e.clientY);
    const center = centerOf(f);
    const scale0 = Math.hypot(f.world.a, f.world.b) / Math.max(1e-9, Math.hypot(f.parent.a, f.parent.b));
    // 有路径时自动朝向的角度不是 rotZ 的一部分，要减掉
    const rot0 = ((Math.atan2(f.world.b, f.world.a) - Math.atan2(f.parent.b, f.parent.a)) * 180) / Math.PI - f.onPath.angle;
    const others = frames.filter((o) => o.id !== id && o.visible).map(centerOf);
    const edges = [
      { x: -stage.width / 2, y: -stage.height / 2 },
      { x: stage.width / 2, y: stage.height / 2 },
    ];
    let started = false;
    trackPointer(e, {
      move: (ev) => {
        const p = toStageIn(rect0, ev.clientX, ev.clientY);
        if (!started && Math.hypot(p.x - start.x, p.y - start.y) * k < 3) return;
        if (!started) {
          beginGesture();
          started = true;
        }
        let values: Record<string, number>;
        if (kind === 'move') {
          let target = { x: center.x + p.x - start.x, y: center.y + p.y - start.y };
          if (useAnimationUi.getState().snap && !ev.altKey) {
            const s = snapPoint(target, [...others, ...edges], SNAP_PX / k);
            target = { x: s.x, y: s.y };
            setGuides({ x: s.guideX, y: s.guideY });
          } else setGuides({ x: null, y: null });
          // 画面上的位置 ÷ 透视缩放 = 图层所在深度的平面上的位置
          const local = apply(invert(f.parent), target.x / f.k, target.y / f.k);
          // 有路径时 x、y 是相对路径的偏移
          values = { x: round(local.x - f.onPath.x, 2), y: round(local.y - f.onPath.y, 2) };
        } else if (kind === 'scale') {
          const d0 = Math.hypot(start.x - center.x, start.y - center.y) || 1;
          const d1 = Math.hypot(p.x - center.x, p.y - center.y);
          values = { scale: round(Math.max(0.01, scale0 * (d1 / d0)), 3) };
        } else {
          const a0 = Math.atan2(start.y - center.y, start.x - center.x);
          const a1 = Math.atan2(p.y - center.y, p.x - center.x);
          let r = rot0 + ((a1 - a0) * 180) / Math.PI;
          if (ev.shiftKey) r = Math.round(r / 15) * 15;
          values = { rotZ: round(r, 2) };
        }
        const next = setPropValues(base, id, values, at);
        if (next) replaceDoc(next);
      },
      up: () => {
        setGuides({ x: null, y: null });
        if (started) endGesture();
      },
    });
  };

  /** 拖路径上的点或手柄：which 是 'pt'、'in'、'out'；Alt 拖点时拉出一对对称手柄 */
  const startPathDrag = (e: ReactPointerEvent, id: string, index: number, which: 'pt' | 'in' | 'out') => {
    e.stopPropagation();
    const cur = currentAnimation();
    const f = frameOf(id);
    const li = cur?.doc.layers.findIndex((l) => l.id === id) ?? -1;
    const path0 = li >= 0 ? cur!.doc.layers[li]!.path : undefined;
    if (!cur || !f || !path0) return;
    const base = cur.doc;
    const rect0 = hostRef.current!.getBoundingClientRect();
    const inv = invert(f.parent);
    // 舞台坐标 → 路径坐标（父级坐标减去 x、y 偏移）
    const toPath = (cx: number, cy: number) => {
      const s = toStageIn(rect0, cx, cy);
      const l = apply(inv, s.x / f.k, s.y / f.k);
      return { x: l.x - f.offset.x, y: l.y - f.offset.y };
    };
    const start = toPath(e.clientX, e.clientY);
    const mode = which === 'pt' && e.altKey ? 'pull' : which;
    let started = false;
    trackPointer(e, {
      move: (ev) => {
        const p = toPath(ev.clientX, ev.clientY);
        if (!started && Math.hypot(p.x - start.x, p.y - start.y) * k < 3) return;
        if (!started) {
          beginGesture();
          started = true;
        }
        const points = path0.points.map((q) => ({ ...q }));
        const q = points[index]!;
        const o = path0.points[index]!;
        if (mode === 'pt') {
          q.x = round(o.x + p.x - start.x, 2);
          q.y = round(o.y + p.y - start.y, 2);
        } else {
          const h = { x: round(p.x - o.x, 2), y: round(p.y - o.y, 2) };
          if (mode === 'in') q.in = h;
          else {
            q.out = h;
            if (mode === 'pull') q.in = { x: -h.x, y: -h.y };
          }
        }
        const next = structuredClone(base);
        next.layers[li]!.path = { ...path0, points };
        replaceDoc(next);
      },
      up: () => {
        if (started) endGesture();
      },
    });
  };

  const onDown = (e: ReactPointerEvent) => {
    if (e.button !== 0) return;
    const p = toStage(e.clientX, e.clientY);
    const hit = hitTest(frames, resolved, p.x, p.y);
    const ui = useAnimationUi.getState();
    if (!hit) {
      if (!e.shiftKey && !e.ctrlKey && !e.metaKey) ui.selectLayers([]);
      return;
    }
    if (e.shiftKey || e.ctrlKey || e.metaKey) {
      ui.selectLayers([hit], 'toggle');
      return;
    }
    if (!ui.layers.includes(hit)) ui.selectLayers([hit]);
    else useAnimationUi.setState({ layer: hit });
    startDrag(e, 'move', hit);
  };

  const primaryFrame = primary ? frameOf(primary) : undefined;
  const handles = primaryFrame && primaryFrame.visible && !primaryFrame.locked && doc.layers[primaryFrame.index]?.type !== 'group' ? corners(primaryFrame).map(toScreen) : null;
  const top = handles ? { x: (handles[0]!.x + handles[1]!.x) / 2, y: (handles[0]!.y + handles[1]!.y) / 2 } : null;
  const c = primaryFrame ? toScreen(centerOf(primaryFrame)) : null;
  const rotHandle = top && c ? { x: top.x + ((top.x - c.x) / (Math.hypot(top.x - c.x, top.y - c.y) || 1)) * 24, y: top.y + ((top.y - c.y) / (Math.hypot(top.x - c.x, top.y - c.y) || 1)) * 24 } : null;

  // 主选中图层的路径（没锁定、可见时）
  const pathLayer = primaryFrame && !primaryFrame.locked ? doc.layers[primaryFrame.index] : undefined;
  const path = pathLayer?.path;
  const pathToScreen = (x: number, y: number) => {
    const p = apply(primaryFrame!.parent, x + primaryFrame!.offset.x, y + primaryFrame!.offset.y);
    return toScreen({ x: p.x * primaryFrame!.k, y: p.y * primaryFrame!.k });
  };

  return (
    <div
      ref={hostRef}
      className="absolute z-[15]"
      style={{ left: box.left, top: box.top, width: box.width, height: box.height }}
      onPointerDown={onDown}
      data-testid="anim-stage-overlay"
      role="application"
      aria-label={t('anim.stage.region')}
    >
      <svg width={box.width} height={box.height} className="pointer-events-none absolute inset-0 overflow-visible">
        {selected.map((id) => {
          const f = frameOf(id);
          if (!f || !f.visible) return null;
          const pts = corners(f).map(toScreen);
          return <polygon key={id} points={pts.map((p) => `${p.x},${p.y}`).join(' ')} fill="none" stroke="var(--primary)" strokeWidth={id === primary ? 1.5 : 1} strokeDasharray={id === primary ? undefined : '4 3'} data-testid="anim-stage-outline" data-layer={id} />;
        })}
        {guides.x !== null && <line x1={toScreen({ x: guides.x, y: 0 }).x} x2={toScreen({ x: guides.x, y: 0 }).x} y1={0} y2={box.height} stroke="var(--mark)" strokeWidth={1} data-testid="anim-stage-guide" />}
        {guides.y !== null && <line y1={toScreen({ x: 0, y: guides.y }).y} y2={toScreen({ x: 0, y: guides.y }).y} x1={0} x2={box.width} stroke="var(--mark)" strokeWidth={1} data-testid="anim-stage-guide" />}
        {path && (
          <polyline
            points={pathPolyline(path)
              .map((q) => pathToScreen(q.x, q.y))
              .map((q) => `${q.x},${q.y}`)
              .join(' ')}
            fill="none"
            stroke="var(--primary)" strokeOpacity={0.7}
            strokeWidth={1.5}
            data-testid="anim-stage-path"
          />
        )}
        {path &&
          path.points.flatMap((q, i) =>
            (['in', 'out'] as const).flatMap((w) => {
              const h = q[w];
              if (!h) return [];
              const a = pathToScreen(q.x, q.y);
              const b = pathToScreen(q.x + h.x, q.y + h.y);
              return [<line key={`${i}${w}`} x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="var(--primary)" strokeOpacity={0.6} strokeWidth={1} strokeDasharray="3 2" />];
            }),
          )}
        {top && rotHandle && <line x1={top.x} y1={top.y} x2={rotHandle.x} y2={rotHandle.y} stroke="var(--primary)" strokeWidth={1} />}
      </svg>
      {handles &&
        primary &&
        handles.map((p, i) => (
          <span
            key={i}
            role="slider"
            aria-label={t('anim.stage.scale')}
            aria-valuenow={0}
            tabIndex={-1}
            className="absolute cursor-nwse-resize rounded-[2px] border border-primary bg-surface-1"
            style={{ left: p.x - HANDLE / 2, top: p.y - HANDLE / 2, width: HANDLE, height: HANDLE }}
            onPointerDown={(e) => {
              e.stopPropagation();
              startDrag(e, 'scale', primary);
            }}
            data-testid="anim-stage-scale"
          />
        ))}
      {path &&
        primary &&
        path.points.map((q, i) => {
          const s = pathToScreen(q.x, q.y);
          return (
            <span key={`p${i}`}>
              {(['in', 'out'] as const).map((w) => {
                const h = q[w];
                if (!h) return null;
                const b = pathToScreen(q.x + h.x, q.y + h.y);
                return (
                  <span
                    key={w}
                    role="slider"
                    aria-label={t('anim.stage.pathHandle')}
                    aria-valuenow={i}
                    tabIndex={-1}
                    className="absolute cursor-move rounded-full border border-primary bg-surface-1"
                    style={{ left: b.x - 3.5, top: b.y - 3.5, width: 7, height: 7 }}
                    onPointerDown={(e) => startPathDrag(e, primary, i, w)}
                    data-testid={`anim-stage-path-${w}`}
                  />
                );
              })}
              <span
                role="slider"
                aria-label={t('anim.stage.pathPoint')}
                aria-valuenow={i}
                tabIndex={-1}
                className="absolute cursor-move rounded-[1px] border border-primary bg-surface-1"
                style={{ left: s.x - HANDLE / 2, top: s.y - HANDLE / 2, width: HANDLE, height: HANDLE }}
                onPointerDown={(e) => startPathDrag(e, primary, i, 'pt')}
                data-testid="anim-stage-path-point"
              />
            </span>
          );
        })}
      {rotHandle && primary && (
        <span
          role="slider"
          aria-label={t('anim.stage.rotate')}
          aria-valuenow={0}
          tabIndex={-1}
          className={cn('absolute cursor-grab rounded-full border border-primary bg-surface-1')}
          style={{ left: rotHandle.x - HANDLE / 2, top: rotHandle.y - HANDLE / 2, width: HANDLE, height: HANDLE }}
          onPointerDown={(e) => {
            e.stopPropagation();
            startDrag(e, 'rotate', primary);
          }}
          data-testid="anim-stage-rotate"
        />
      )}
    </div>
  );
}
