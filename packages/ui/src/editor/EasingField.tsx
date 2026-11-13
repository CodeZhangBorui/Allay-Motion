import { useEffect, useRef, type PointerEvent as ReactPointerEvent } from 'react';
import { Select, SelectContent, SelectItem, SelectSeparator, SelectTrigger } from '../components/ui/select';
import { beginGesture, useEditor } from './context';
import { EASING_FUNCTIONS, easingFn, easingPath, type EasingValue } from './easing';

// EasingField（6.5）：下拉里每个预设配一条小曲线；“自定义”展开一个 SVG 贝塞尔编辑器（两个可拖控制点）
// 和一个按曲线运动的小方块。小方块只动 transform；减少动效时不动。控制点是方的凸块。

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
    <svg width="28" height="16" viewBox="0 0 28 16" aria-hidden="true" className="shrink-0 text-primary-text">
      <path d={easingPath(value, 28, 16)} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="square" strokeLinejoin="miter" />
    </svg>
  );
}

const BOX = 160;
const PAD = 0.3;
const SPAN = 1 + PAD * 2;
const toX = (x: number) => x * BOX;
const toY = (y: number) => BOX - ((y + PAD) / SPAN) * BOX;

function BezierEditor({ value, onChange, label }: { value: readonly [number, number, number, number]; onChange(v: [number, number, number, number]): void; label: string }) {
  const editor = useEditor();
  const svgRef = useRef<SVGSVGElement>(null);
  const dotRef = useRef<SVGRectElement>(null);
  const dragging = useRef<0 | 1 | null>(null);
  const valueRef = useRef(value);
  valueRef.current = value;

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
        <line x1={ax} y1={ay} x2={cx} y2={cy} stroke="var(--fg-muted)" strokeWidth="2" />
        <rect
          x={cx - 6}
          y={cy - 6}
          width="12"
          height="12"
          fill="var(--surface-2)"
          stroke="var(--primary-text)"
          strokeWidth="2"
          className="cursor-grab"
          role="slider"
          aria-label={editor.t(which === 0 ? 'easing.handle1' : 'easing.handle2')}
          aria-valuetext={`${value[which * 2]}, ${value[which * 2 + 1]}`}
          tabIndex={0}
          onKeyDown={(e) => {
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
            beginGesture(editor);
          }}
          onPointerUp={() => (dragging.current = null)}
        />
      </g>
    );
  };
  return (
    <div className="flex flex-col gap-1">
      <svg ref={svgRef} width={BOX} height={BOX} viewBox={`0 0 ${BOX} ${BOX}`} className="touch-none self-center overflow-visible blk blk-sunken" onPointerMove={onMove} role="group" aria-label={label}>
        <rect x="0" y={toY(1)} width={BOX} height={toY(0) - toY(1)} fill="none" stroke="var(--input-border)" strokeWidth="2" strokeDasharray="4 4" />
        <path d={easingPath(value, BOX, BOX, PAD, 64)} fill="none" stroke="var(--primary-text)" strokeWidth="2" strokeLinejoin="miter" />
        {handle(0)}
        {handle(1)}
        <rect ref={dotRef} x="-4" y="-4" width="8" height="8" fill="var(--allay)" />
      </svg>
      <span className="text-center font-px12 text-fg-muted">[{value.map((n) => n.toFixed(2)).join(', ')}]</span>
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
