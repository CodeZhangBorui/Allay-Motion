import { NumberField } from '@base-ui/react/number-field';
import { cn } from 'cn';
import { useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import { beginGesture, useEditor } from './context';

// ScrubNumberField（6.5）：数值框即滑块。一个控件：控件色的圆角块，数值右对齐、等宽；有范围的数值按比例用强调色 20% 填充底色。
// - 在框上按住左右拖动改值（有范围时整个框宽对应整个范围，否则每 4 px 一步）；Shift 十倍、Alt 十分之一；
// - 单击或 Tab 进入键入，双击全选后键入；上下键步进；越界钳制；带单位后缀；
// - 一次拖动只产生一条撤销记录（按下时开始、松开时结束一次连续操作）。
// 拖动自己算 clientX 的位移，不用指针锁（隐藏窗口和测试里指针锁拿不到）。

export interface ScrubNumberFieldProps {
  value: number;
  onChange(value: number): void;
  min?: number;
  max?: number;
  step?: number;
  /** 小数位数；缺省按 step 推出 */
  decimals?: number;
  /** 至少显示的小数位数（时间用 2：0.50） */
  minDecimals?: number;
  unit?: string;
  label: string;
  /** 框内左侧的标签（时间组里的“进入/停留/退出”） */
  lead?: ReactNode;
  /** 按比例填充底色（只有范围有意义的数值才填） */
  fill?: boolean;
  /** 透明底（方块列表行里的数量） */
  bare?: boolean;
  className?: string;
  disabled?: boolean;
  id?: string;
  testId?: string;
}

export function decimalsOf(step: number): number {
  if (!Number.isFinite(step) || step <= 0 || step >= 1) return 0;
  return Math.min(6, Math.ceil(-Math.log10(step) - 1e-9));
}

const DRAG_THRESHOLD = 3;
const PX_PER_STEP = 4;

export function ScrubNumberField({ value, onChange, min, max, step = 1, decimals, minDecimals = 0, unit, label, lead, fill, bare, className, disabled, id, testId }: ScrubNumberFieldProps) {
  const editor = useEditor();
  const digits = decimals ?? decimalsOf(step);
  const inputRef = useRef<HTMLInputElement>(null);
  const [editing, setEditing] = useState(false);
  const drag = useRef<{ x: number; from: number; moved: boolean; width: number } | null>(null);
  const ranged = min !== undefined && max !== undefined && Number.isFinite(min) && Number.isFinite(max) && max > min;
  const ratio = ranged ? Math.min(1, Math.max(0, (value - min) / (max - min))) : 0;

  const clamp = (v: number) => Math.min(max ?? Infinity, Math.max(min ?? -Infinity, v));
  const snap = (v: number, s: number) => Number((Math.round(v / s) * s).toFixed(Math.min(10, digits + 2)));

  const onDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (disabled || e.button !== 0) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { x: e.clientX, from: value, moved: false, width: e.currentTarget.getBoundingClientRect().width };
    beginGesture(editor);
  };
  const onMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d || !e.currentTarget.hasPointerCapture(e.pointerId)) return;
    const dx = e.clientX - d.x;
    if (!d.moved && Math.abs(dx) < DRAG_THRESHOLD) return;
    d.moved = true;
    const scale = (e.shiftKey ? 10 : 1) * (e.altKey ? 0.1 : 1);
    const unitStep = e.altKey ? step / 10 : step;
    const raw = ranged ? d.from + (dx / Math.max(1, d.width)) * (max - min) * scale : d.from + Math.round(dx / PX_PER_STEP) * step * scale;
    const next = clamp(snap(raw, unitStep));
    if (next !== value) onChange(next);
  };
  const onUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    drag.current = null;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
    // 没拖动：当作单击，进入键入
    if (d && !d.moved) inputRef.current?.focus();
  };

  return (
    <div className={cn('min-w-0', className)} data-testid={testId}>
      <NumberField.Root
        id={id}
        value={value}
        min={min}
        max={max}
        step={step}
        smallStep={step / 10}
        largeStep={step * 10}
        disabled={disabled}
        locale="en-US"
        format={{ maximumFractionDigits: digits, minimumFractionDigits: Math.min(minDecimals, digits), useGrouping: false }}
        onValueChange={(v) => {
          if (v === null || !Number.isFinite(v)) return;
          const clamped = clamp(v);
          if (clamped !== value) onChange(clamped);
        }}
        className={cn(
          'relative flex h-control min-w-0 items-center overflow-hidden rounded-md focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-(--ring)',
          bare ? 'bg-transparent hover:bg-control-hi' : 'bg-control',
          disabled && 'opacity-45',
        )}
      >
        {fill && ranged && <div aria-hidden="true" className="pointer-events-none absolute inset-y-0 left-0 bg-primary-soft" style={{ width: `${ratio * 100}%` }} />}
        {lead && <span className="pointer-events-none absolute left-2.5 truncate text-fg-subtle">{lead}</span>}
        <NumberField.Group className="relative flex h-full min-w-0 flex-1 items-center justify-end gap-1 pr-2.5">
          <NumberField.Input
            ref={inputRef}
            aria-label={label}
            onFocus={() => setEditing(true)}
            onBlur={() => setEditing(false)}
            onDoubleClick={(e) => e.currentTarget.select()}
            className="h-full w-full min-w-0 bg-transparent text-right num text-sm text-foreground outline-none select-text"
          />
          {unit && <span className="pointer-events-none shrink-0 text-fg-subtle">{unit}</span>}
        </NumberField.Group>
        {/* 拖动层：键入时让开，好放光标 */}
        {!editing && !disabled && (
          <div
            aria-hidden="true"
            className="absolute inset-0 cursor-ew-resize touch-none"
            onPointerDown={onDown}
            onPointerMove={onMove}
            onPointerUp={onUp}
            onPointerCancel={onUp}
            onDoubleClick={() => {
              inputRef.current?.focus();
              inputRef.current?.select();
            }}
          />
        )}
      </NumberField.Root>
    </div>
  );
}

/** 有范围的数值：同一个控件，按比例填充（原来的“滑块加数字框”并成一个） */
export function SliderField(props: ScrubNumberFieldProps & { min: number; max: number }) {
  return <ScrubNumberField {...props} fill />;
}
