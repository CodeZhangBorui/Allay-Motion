import { DiceFive } from '@phosphor-icons/react';
import { cn } from 'cn';
import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { Button } from '../components/ui/button';
import { Input, Textarea, ToggleGroup, ToggleGroupItem } from '../components/ui/misc';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import { Switch } from '../components/ui/switch';
import { ICON } from '../lib/icons';
import { beginGesture, useEditor } from './context';
import { ScrubNumberField } from './ScrubNumberField';

// 几个小控件（6.5）：DurationField、SeedField、AngleField，以及开关、枚举、文本（SoundField 在 SoundPicker.tsx）。

/** DurationField：以秒编辑，旁边显示帧数；吸附到 1 / fps */
export function DurationField({ value, onChange, min, max, label, testId }: { value: number; onChange(v: number): void; min: number; max: number; label: string; testId?: string }) {
  const editor = useEditor();
  const fps = editor.fps;
  const snap = (v: number) => Math.min(max, Math.max(min, Math.round(v * fps) / fps));
  return (
    <div className="flex min-w-0 items-center gap-2" data-testid={testId}>
      <ScrubNumberField value={value} onChange={(v) => onChange(snap(v))} min={min} max={max} step={1 / fps} decimals={3} minDecimals={2} unit="s" label={label} fill className="min-w-0 flex-1" />
      <span className="w-12 shrink-0 text-right num text-xs text-fg-subtle">{editor.t('duration.frames', { n: Math.round(value * fps) })}</span>
    </div>
  );
}

const SEED_MAX = 2_147_483_647;

/** 种子的随机新值（界面上的骰子：用真实随机数是可以的，画面仍然只由参数决定） */
export function randomSeed(): number {
  const buf = new Uint32Array(1);
  crypto.getRandomValues(buf);
  return buf[0]! % (SEED_MAX + 1);
}

/** SeedField：数字框加骰子按钮（快捷键 R 由应用接上） */
export function SeedField({ value, onChange, label, testId }: { value: number; onChange(v: number): void; label: string; testId?: string }) {
  const editor = useEditor();
  return (
    <div className="flex min-w-0 items-center gap-1" data-testid={testId}>
      <ScrubNumberField value={value} onChange={(v) => onChange(Math.round(v))} min={0} max={SEED_MAX} step={1} label={label} className="min-w-0 flex-1" />
      <Button variant="secondary" size="icon-sm" className="text-fg-muted" aria-label={editor.t('seed.roll')} title={editor.t('seed.rollHint')} onClick={() => onChange(randomSeed())}>
        <DiceFive size={ICON.md} />
      </Button>
    </div>
  );
}

/** AngleField：圆形方向盘加数字框，支持吸附 */
export function AngleField({ value, onChange, snap, label, testId }: { value: number; onChange(v: number): void; snap?: number; label: string; testId?: string }) {
  const editor = useEditor();
  const dialRef = useRef<HTMLDivElement>(null);
  const norm = (a: number) => ((a % 360) + 360) % 360;
  const fromPointer = (e: ReactPointerEvent, shift: boolean) => {
    const rect = dialRef.current!.getBoundingClientRect();
    const dx = e.clientX - (rect.left + rect.width / 2);
    const dy = e.clientY - (rect.top + rect.height / 2);
    // 0° 朝右，顺时针为正（屏幕坐标）
    let a = norm((Math.atan2(dy, dx) * 180) / Math.PI);
    const step = snap ?? (shift ? 15 : 0);
    if (step > 0) a = norm(Math.round(a / step) * step);
    else a = Math.round(a);
    if (a !== value) onChange(a);
  };
  return (
    <div className="flex min-w-0 items-center gap-2" data-testid={testId}>
      <div
        ref={dialRef}
        role="slider"
        tabIndex={0}
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={359}
        aria-valuenow={Math.round(value)}
        title={editor.t('angle.hint')}
        className="relative size-control shrink-0 cursor-pointer touch-none rounded-full bg-control"
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId);
          beginGesture(editor);
          fromPointer(e, e.shiftKey);
        }}
        onPointerMove={(e) => {
          if (e.currentTarget.hasPointerCapture(e.pointerId)) fromPointer(e, e.shiftKey);
        }}
        onKeyDown={(e) => {
          const d = (snap ?? 1) * (e.shiftKey ? 15 : 1);
          if (e.key === 'ArrowRight' || e.key === 'ArrowUp') onChange(norm(value + d));
          else if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') onChange(norm(value - d));
          else return;
          e.preventDefault();
        }}
      >
        <span className="absolute top-1/2 left-1/2 h-0.5 w-2.5 origin-left rounded-full bg-primary-text" style={{ transform: `translateY(-50%) rotate(${value}deg)` }} />
        <span className="absolute top-1/2 left-1/2 size-1 -translate-x-1/2 -translate-y-1/2 rounded-full bg-foreground" />
      </div>
      <ScrubNumberField value={value} onChange={(v) => onChange(norm(snap ? Math.round(v / snap) * snap : v))} min={-360} max={720} step={snap ?? 1} unit="°" label={label} className="min-w-0 flex-1" />
    </div>
  );
}


export function BooleanField({ value, onChange, label, testId }: { value: boolean; onChange(v: boolean): void; label: string; testId?: string }) {
  return (
    <div className="flex h-7 items-center">
      <Switch checked={value} onCheckedChange={(v) => onChange(v)} aria-label={label} data-testid={testId} />
    </div>
  );
}

/** 选项文字的显示宽度（中日韩字符按 2 计） */
function textWidth(s: string): number {
  let n = 0;
  for (const ch of s) n += /[⺀-￿]/.test(ch) ? 2 : 1;
  return n;
}

export interface EnumOption {
  value: string;
  label: string;
  /** 4×4 的顺序值（0–1）；manifest 声明了 ui: 'pattern' 时才有 */
  pattern?: readonly number[];
}

/** 一格图案：4×4 的小方格，越早出现越亮 */
function PatternTile({ pattern }: { pattern: readonly number[] }) {
  return (
    <span className="grid size-full grid-cols-4 gap-[1.5px] p-[22%]" aria-hidden="true">
      {pattern.map((p, i) => (
        <span key={i} className="rounded-[1px] bg-current" style={{ opacity: 1 - Math.min(1, Math.max(0, p)) * 0.85 }} />
      ))}
    </span>
  );
}

/**
 * 图案小格选择器（manifest 的 enum 声明了 ui: 'pattern'）：一排方格，每格画出这个选项的出现顺序；
 * 当前项的名称由 ParamRow 显示在右上。键盘：方向键在选项间移动（radiogroup）。
 */
export function PatternField({ value, onChange, options, label, testId }: { value: string; onChange(v: string): void; options: EnumOption[]; label: string; testId?: string }) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const index = Math.max(0, options.findIndex((o) => o.value === value));
  const move = (to: number) => {
    const i = (to + options.length) % options.length;
    onChange(options[i]!.value);
    refs.current[i]?.focus();
  };
  return (
    <div role="radiogroup" aria-label={label} data-testid={testId} className="grid grid-cols-6 gap-[5px]">
      {options.map((o, i) => {
        const on = o.value === value;
        return (
          <button
            key={o.value}
            ref={(el) => {
              refs.current[i] = el;
            }}
            type="button"
            role="radio"
            aria-checked={on}
            aria-label={o.label}
            title={o.label}
            tabIndex={i === index ? 0 : -1}
            onClick={() => !on && onChange(o.value)}
            onKeyDown={(e) => {
              if (e.key === 'ArrowRight' || e.key === 'ArrowDown') move(i + 1);
              else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') move(i - 1);
              else return;
              e.preventDefault();
            }}
            className={cn(
              'aspect-square rounded-lg transition-colors duration-(--dur-1)',
              on ? 'bg-primary-soft text-primary-text shadow-[inset_0_0_0_1.5px_var(--primary)]' : 'bg-control text-fg-muted hover:bg-control-hi',
            )}
          >
            {o.pattern && <PatternTile pattern={o.pattern} />}
          </button>
        );
      })}
    </div>
  );
}

/**
 * enum：manifest 声明了 ui: 'pattern' 时用图案小格选择器；否则 4 项以内用分段控件，其余用下拉（4.4）。
 * 分段控件放不下选项文字（总宽超过约 24 个半角字符）时也用下拉，不把选项截成“Fli…”（decisions.md M4）。
 */
export function EnumField({ value, onChange, options, label, testId, ui }: { value: string; onChange(v: string): void; options: EnumOption[]; label: string; testId?: string; ui?: 'pattern' }) {
  if (ui === 'pattern' && options.every((o) => o.pattern)) return <PatternField value={value} onChange={onChange} options={options} label={label} testId={testId} />;
  const fits = options.reduce((a, o) => a + textWidth(o.label) + 2, 0) <= 24;
  if (options.length <= 4 && fits) {
    return (
      <ToggleGroup
        value={[value]}
        onValueChange={(v) => {
          const next = v[0];
          if (typeof next === 'string' && next !== value) onChange(next);
        }}
        aria-label={label}
        data-testid={testId}
        className="w-full"
      >
        {options.map((o) => (
          <ToggleGroupItem key={o.value} value={o.value} className="min-w-0" title={o.label}>
            <span className="truncate">{o.label}</span>
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
    );
  }
  return (
    <Select value={value} onValueChange={(v) => typeof v === 'string' && onChange(v)}>
      <SelectTrigger aria-label={label} data-testid={testId} className="w-full">
        <SelectValue>{(v: unknown) => <span className="truncate">{options.find((o) => o.value === v)?.label ?? String(v)}</span>}</SelectValue>
      </SelectTrigger>
      <SelectContent>
        {options.map((o) => (
          <SelectItem key={o.value} value={o.value}>
            {o.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/** text：输入时先改草稿，失焦或回车（单行）时提交，避免每个按键都产生一条撤销记录 */
export function TextField({ value, onChange, multiline, maxLength, label, testId }: { value: string; onChange(v: string): void; multiline?: boolean; maxLength?: number; label: string; testId?: string }) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  const commit = () => {
    if (draft !== value) onChange(draft);
  };
  if (multiline) {
    return <Textarea aria-label={label} data-testid={testId} value={draft} maxLength={maxLength} rows={3} onChange={(e) => setDraft(e.currentTarget.value)} onBlur={commit} />;
  }
  return (
    <Input
      aria-label={label}
      data-testid={testId}
      value={draft}
      maxLength={maxLength}
      onChange={(e) => setDraft(e.currentTarget.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') commit();
      }}
    />
  );
}
