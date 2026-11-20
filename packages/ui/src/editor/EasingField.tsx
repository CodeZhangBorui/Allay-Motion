import { cn } from 'cn';
import { useEffect, useLayoutEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type RefObject } from 'react';
import { Select, SelectContent, SelectItem, SelectSeparator, SelectTrigger } from '../components/ui/select';
import { beginGesture, useEditor } from './context';
import { EASING_FUNCTIONS, easingFn, easingPath, type EasingValue } from './easing';

// EasingField（6.5）：下拉里每个预设配一条小曲线；“自定义”展开一个 SVG 贝塞尔编辑器（两个可拖控制点）
// 和一个按曲线运动的小圆点。小圆点只动 transform；减少动效时不动。
//
// 聚焦（docs/decisions.md“2026-11 反馈：时间线与曲线编辑”）：控制点的 y 可以拉出 0–1，拉出去的部分本来会被
// 属性面板的折叠区、滚动区裁掉，或被下面的控件盖住。鼠标进入方格、按住控制点、或键盘焦点在控制点上时，
// 编辑器“浮起”：原位留一个同高的占位，编辑器本身改成 position: fixed 停在原来的位置（同一个节点，拖动中的
// 指针捕获不受影响），不再被裁剪、压在其他控件之上；属性面板的其余各行降到 35% 不透明度（ParamPanel 的聚焦层）。
// 退出：EASING_FOCUS_IDLE_MS 内没有操作（拖动中不算无操作）、在编辑器外按下（这一下照常作用于被点的控件）、
// Esc、键盘焦点离开、窗口失焦。

export interface EasingFieldProps {
  value: EasingValue;
  onChange(value: EasingValue): void;
  label: string;
  testId?: string;
}

const NAMES = Object.keys(EASING_FUNCTIONS);
const CUSTOM = '__custom';

function MiniCurve({ value }: { value: EasingValue }) {
  return (
    <svg width="28" height="16" viewBox="0 0 28 16" aria-hidden="true" className="shrink-0 text-primary">
      <path d={easingPath(value, 28, 16)} fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

const BOX = 160;
const PAD = 0.3;
const SPAN = 1 + PAD * 2;
const toX = (x: number) => x * BOX;
const toY = (y: number) => BOX - ((y + PAD) / SPAN) * BOX;

/** 没有操作多久之后退出聚焦（毫秒） */
export const EASING_FOCUS_IDLE_MS = 3000;

interface Lift {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** 浮起状态：进入或续期（touch）、退出（exit），以及给属性面板聚焦层打标记 */
function useLift(slotRef: RefObject<HTMLDivElement | null>, layerRef: RefObject<HTMLDivElement | null>, isDragging: () => boolean) {
  const [lift, setLift] = useState<Lift | null>(null);
  const active = useRef(false);
  const timer = useRef(0);
  const mark = (on: boolean) => {
    const el = slotRef.current;
    el?.closest('[data-dim]')?.toggleAttribute('data-focus-owner', on);
    el?.closest('[data-focus-scope]')?.toggleAttribute('data-focus-layer', on);
  };
  const exit = () => {
    window.clearTimeout(timer.current);
    if (!active.current) return;
    active.current = false;
    mark(false);
    setLift(null);
  };
  const schedule = () => {
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => (isDragging() ? schedule() : exit()), EASING_FOCUS_IDLE_MS);
  };
  const touch = () => {
    if (!active.current) {
      const el = slotRef.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      active.current = true;
      mark(true);
      setLift({ left: r.left, top: r.top, width: r.width, height: layerRef.current?.offsetHeight ?? r.height });
    }
    schedule();
  };
  // window 上的监听读最新的 exit
  const exitRef = useRef(exit);
  exitRef.current = exit;
  const lifted = lift !== null;

  useEffect(() => {
    if (!lifted) return;
    // 在编辑器外按下：退出（捕获阶段，不拦截：这一下照常落到被点的控件上）
    const down = (e: PointerEvent) => {
      if (!layerRef.current?.contains(e.target as Node)) exitRef.current();
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') exitRef.current();
    };
    const blur = () => exitRef.current();
    // 浮起期间面板滚动或窗口改尺寸：跟着原位走
    let raf = 0;
    const follow = () => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        const el = slotRef.current;
        if (!el) return;
        const r = el.getBoundingClientRect();
        setLift((l) => (l && (l.left !== r.left || l.top !== r.top || l.width !== r.width) ? { ...l, left: r.left, top: r.top, width: r.width } : l));
      });
    };
    document.addEventListener('pointerdown', down, true);
    document.addEventListener('keydown', key, true);
    window.addEventListener('blur', blur);
    window.addEventListener('scroll', follow, true);
    window.addEventListener('resize', follow);
    return () => {
      cancelAnimationFrame(raf);
      document.removeEventListener('pointerdown', down, true);
      document.removeEventListener('keydown', key, true);
      window.removeEventListener('blur', blur);
      window.removeEventListener('scroll', follow, true);
      window.removeEventListener('resize', follow);
    };
  }, [lifted, slotRef, layerRef]);

  // fixed 的包含块不一定是视口（祖先有 transform 时是那个祖先）：浮起后量一次，偏了就按差值挪回原位
  useLayoutEffect(() => {
    const layer = layerRef.current;
    const slot = slotRef.current;
    if (!lift || !layer || !slot) return;
    const a = layer.getBoundingClientRect();
    const b = slot.getBoundingClientRect();
    const dx = b.left - a.left;
    const dy = b.top - a.top;
    if (Math.abs(dx) > 0.5 || Math.abs(dy) > 0.5) setLift({ ...lift, left: lift.left + dx, top: lift.top + dy });
  }, [lift, slotRef, layerRef]);

  // 卸载（切回预设曲线、换模板）时撤掉聚焦层的标记
  useEffect(() => {
    const latestExit = exitRef;
    return () => latestExit.current();
  }, []);

  return { lift, touch, exit };
}

function BezierEditor({ value, onChange, label }: { value: readonly [number, number, number, number]; onChange(v: [number, number, number, number]): void; label: string }) {
  const editor = useEditor();
  const svgRef = useRef<SVGSVGElement>(null);
  const dotRef = useRef<SVGCircleElement>(null);
  const slotRef = useRef<HTMLDivElement>(null);
  const layerRef = useRef<HTMLDivElement>(null);
  const dragging = useRef<0 | 1 | null>(null);
  const valueRef = useRef(value);
  valueRef.current = value;
  const { lift, touch, exit } = useLift(slotRef, layerRef, () => dragging.current !== null);

  // 沿曲线运动的小圆点：一个 rAF 循环，只改 transform
  useEffect(() => {
    if (document.documentElement.dataset.reducedMotion === 'true') return;
    let raf = 0;
    const start = performance.now();
    const tick = (now: number) => {
      const p = ((now - start) / 1400) % 1.4;
      const x = Math.min(1, p);
      const y = easingFn(valueRef.current)(x);
      dotRef.current?.setAttribute('transform', `translate(${toX(x).toFixed(1)} ${toY(y).toFixed(1)})`);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  const pointFrom = (e: ReactPointerEvent) => {
    const rect = svgRef.current!.getBoundingClientRect();
    const x = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
    const y = (1 - (e.clientY - rect.top) / rect.height) * SPAN - PAD;
    return [Math.round(x * 100) / 100, Math.round(y * 100) / 100] as const;
  };
  const onMove = (e: ReactPointerEvent) => {
    touch();
    const which = dragging.current;
    if (which === null) return;
    const [x, y] = pointFrom(e);
    const next: [number, number, number, number] = [...valueRef.current];
    next[which * 2] = x;
    next[which * 2 + 1] = y;
    onChange(next);
  };
  const handle = (which: 0 | 1) => {
    const cx = toX(value[which * 2]!);
    const cy = toY(value[which * 2 + 1]!);
    const ax = which === 0 ? 0 : BOX;
    const ay = which === 0 ? toY(0) : toY(1);
    return (
      <g key={which}>
        <line x1={ax} y1={ay} x2={cx} y2={cy} stroke="var(--fg-subtle)" strokeWidth="1" />
        <circle
          cx={cx}
          cy={cy}
          r="6"
          fill="var(--surface-2)"
          stroke="var(--primary)"
          strokeWidth="2"
          className="cursor-grab"
          role="slider"
          aria-label={editor.t(which === 0 ? 'easing.handle1' : 'easing.handle2')}
          aria-valuetext={`${value[which * 2]}, ${value[which * 2 + 1]}`}
          data-testid={`easing-handle-${which + 1}`}
          tabIndex={0}
          onKeyDown={(e) => {
            if (e.key === 'Escape') return;
            touch();
            const d = e.shiftKey ? 0.1 : 0.01;
            const next: [number, number, number, number] = [...value];
            const ix = which * 2;
            if (e.key === 'ArrowLeft') next[ix] = Math.max(0, next[ix]! - d);
            else if (e.key === 'ArrowRight') next[ix] = Math.min(1, next[ix]! + d);
            else if (e.key === 'ArrowUp') next[ix + 1] = next[ix + 1]! + d;
            else if (e.key === 'ArrowDown') next[ix + 1] = next[ix + 1]! - d;
            else return;
            e.preventDefault();
            onChange(next.map((n) => Math.round(n * 100) / 100) as [number, number, number, number]);
          }}
          onPointerDown={(e) => {
            e.currentTarget.setPointerCapture(e.pointerId);
            dragging.current = which;
            touch();
            beginGesture(editor);
          }}
          onPointerUp={() => {
            dragging.current = null;
            touch();
          }}
          onLostPointerCapture={() => (dragging.current = null)}
        />
      </g>
    );
  };
  return (
    // 占位：浮起时编辑器脱离文档流，这里保持原来的高度，下面的行不跳动
    <div ref={slotRef} style={lift ? { height: lift.height } : undefined} data-testid="easing-editor-slot">
      <div
        ref={layerRef}
        data-testid="easing-editor"
        data-focused={lift ? 'true' : undefined}
        className={cn('flex flex-col gap-1', lift && 'fixed z-40')}
        style={lift ? { left: lift.left, top: lift.top, width: lift.width } : undefined}
        onFocus={touch}
        onBlur={(e) => {
          // 焦点移到了编辑器外的控件（Tab 等）；点在方格的空白处只是失焦、指针还在这里，不算离开
          if (e.relatedTarget && !e.currentTarget.contains(e.relatedTarget as Node)) exit();
        }}
      >
        <svg
          ref={svgRef}
          width={BOX}
          height={BOX}
          viewBox={`0 0 ${BOX} ${BOX}`}
          className="touch-none self-center overflow-visible rounded-lg bg-well"
          onPointerEnter={touch}
          onPointerMove={onMove}
          role="group"
          aria-label={label}
        >
          <rect x="0" y={toY(1)} width={BOX} height={toY(0) - toY(1)} fill="none" stroke="var(--control-hi)" strokeDasharray="3 3" />
          <path d={easingPath(value, BOX, BOX, PAD, 64)} fill="none" stroke="var(--primary)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          {handle(0)}
          {handle(1)}
          <circle ref={dotRef} r="4" fill="var(--primary)" />
        </svg>
        <span className="text-center num text-xs text-fg-subtle">[{value.map((n) => n.toFixed(2)).join(', ')}]</span>
      </div>
    </div>
  );
}

export function EasingField({ value, onChange, label, testId }: EasingFieldProps) {
  const editor = useEditor();
  const isCustom = typeof value !== 'string';
  return (
    <div className="flex min-w-0 flex-col gap-2">
      <Select
        value={isCustom ? CUSTOM : value}
        onValueChange={(v) => {
          if (v === CUSTOM) onChange(isCustom ? value : [0.25, 0.1, 0.25, 1]);
          else if (typeof v === 'string') onChange(v);
        }}
      >
        <SelectTrigger aria-label={label} data-testid={testId} className="w-full">
          <span className="flex min-w-0 items-center gap-2">
            <MiniCurve value={value} />
            <span className="truncate">{isCustom ? editor.t('easing.custom') : editor.t(`easing.names.${value}`)}</span>
          </span>
        </SelectTrigger>
        <SelectContent>
          {NAMES.map((n) => (
            <SelectItem key={n} value={n}>
              <MiniCurve value={n} />
              {editor.t(`easing.names.${n}`)}
            </SelectItem>
          ))}
          <SelectSeparator />
          <SelectItem value={CUSTOM}>{editor.t('easing.custom')}</SelectItem>
        </SelectContent>
      </Select>
      {isCustom && <BezierEditor value={value} onChange={onChange} label={label} />}
    </div>
  );
}
