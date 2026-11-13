import { NumberField } from '@base-ui/react/number-field';
import { cn } from 'cn';
import { MoveHorizontal } from 'lucide-react';
import type { ReactNode } from 'react';
import { Slider } from '../components/ui/slider';
import { beginGesture, useEditor } from './context';

// ScrubNumberField（6.5）：基于 Base UI 的 NumberField（自带 ScrubArea）。
// 在标签或数字左边的拖动区按住左右拖动改值（Base UI 拖动时锁定指针）；Shift 十倍、Alt 十分之一（largeStep / smallStep）；
// 输入框可以直接键入；上下键步进；越界钳制；带单位后缀。一次拖动只产生一条撤销记录（按下时开始、松开时结束一次连续操作）。

export interface ScrubNumberFieldProps {
  value: number;
  onChange(value: number): void;
  min?: number;
  max?: number;
  step?: number;
  /** 小数位数；缺省按 step 推出 */
  decimals?: number;
  unit?: string;
  label: string;
  /** 拖动区里显示的内容（缺省是一个双向箭头图标） */
  scrubLabel?: ReactNode;
  className?: string;
  disabled?: boolean;
  id?: string;
  testId?: string;
}

export function decimalsOf(step: number): number {
  if (!Number.isFinite(step) || step <= 0 || step >= 1) return 0;
  return Math.min(6, Math.ceil(-Math.log10(step) - 1e-9));
}

export function ScrubNumberField({ value, onChange, min, max, step = 1, decimals, unit, label, scrubLabel, className, disabled, id, testId }: ScrubNumberFieldProps) {
  const editor = useEditor();
  const digits = decimals ?? decimalsOf(step);
  return (
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
      format={{ maximumFractionDigits: digits, minimumFractionDigits: 0, useGrouping: false }}
      onValueChange={(v) => {
        if (v === null || !Number.isFinite(v)) return;
        const clamped = Math.min(max ?? Infinity, Math.max(min ?? -Infinity, v));
        if (clamped !== value) onChange(clamped);
      }}
      className={cn('flex h-7 min-w-0 items-center blk blk-sunken focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-(--ring) hover:[--blk-c:var(--fg-muted)]', disabled && 'opacity-50', className)}
      data-testid={testId}
    >
      <NumberField.ScrubArea
        direction="horizontal"
        pixelSensitivity={2}
        className="flex h-full shrink-0 cursor-ew-resize items-center px-1.5 text-fg-muted hover:text-foreground"
        onPointerDownCapture={() => beginGesture(editor)}
        aria-hidden="true"
      >
        {scrubLabel ?? <MoveHorizontal className="size-(--icon-sm)" />}
        <NumberField.ScrubAreaCursor>
          <MoveHorizontal className="size-(--icon-sm)" />
        </NumberField.ScrubAreaCursor>
      </NumberField.ScrubArea>
      <NumberField.Group className="flex h-full min-w-0 flex-1 items-center">
        <NumberField.Input aria-label={label} className="h-full w-full min-w-0 bg-transparent pr-1.5 text-right font-px12 text-foreground outline-none select-text" />
        {unit && <span className="shrink-0 pr-2 font-px12 text-fg-muted">{unit}</span>}
      </NumberField.Group>
    </NumberField.Root>
  );
}

/** SliderField（6.5）：滑块加 ScrubNumberField */
export function SliderField(props: ScrubNumberFieldProps & { min: number; max: number }) {
  const editor = useEditor();
  const { value, onChange, min, max, step = 1, label, disabled, testId } = props;
  return (
    <div className="flex min-w-0 items-center gap-2" data-testid={testId}>
      <Slider
        value={value}
        min={min}
        max={max}
        step={step}
        disabled={disabled}
        thumbLabel={label}
        className="min-w-0 flex-1"
        onPointerDownCapture={() => beginGesture(editor)}
        onValueChange={(v) => {
          const n = Array.isArray(v) ? (v[0] as number) : (v as number);
          if (Number.isFinite(n) && n !== value) onChange(n);
        }}
      />
      <ScrubNumberField {...props} testId={undefined} className="w-[76px] shrink-0" />
    </div>
  );
}
