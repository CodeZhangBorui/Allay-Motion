import { cn } from 'cn';
import { useEffect, useState } from 'react';
import { HexAlphaColorPicker, HexColorPicker } from 'react-colorful';
import { Input } from '../components/ui/misc';
import { Popover, PopoverContent, PopoverTrigger } from '../components/ui/popover';
import { beginGesture, useEditor } from './context';
import { PALETTES } from './palettes';

// ColorField（6.5）：色块；弹层里是取色区域、色相条、透明度条（按需）、十六进制输入、最近用过的颜色，以及参数指定的色板。

const HEX6 = /^#[0-9a-fA-F]{6}$/;
const HEX8 = /^#[0-9a-fA-F]{8}$/;

export interface ColorFieldProps {
  value: string;
  onChange(value: string): void;
  alpha?: boolean;
  palette?: 'dye' | 'chat';
  label: string;
  testId?: string;
}

function Swatch({ hex, className }: { hex: string; className?: string }) {
  return (
    <span className={cn('relative inline-block overflow-hidden rounded-[4px]', className)} aria-hidden="true">
      <span className="preview-checker-sm absolute inset-0" />
      <span className="absolute inset-0" style={{ background: hex }} />
    </span>
  );
}

export function ColorField({ value, onChange, alpha, palette, label, testId }: ColorFieldProps) {
  const editor = useEditor();
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  const set = (hex: string) => {
    const up = hex.toUpperCase();
    const next = !alpha && up.length === 9 ? up.slice(0, 7) : up;
    if (next !== value) onChange(next);
  };
  const commitDraft = () => {
    const v = draft.startsWith('#') ? draft : `#${draft}`;
    if (HEX6.test(v) || (alpha && HEX8.test(v))) {
      set(v);
      editor.addRecent('color', v.toUpperCase());
    } else setDraft(value);
  };
  const Picker = alpha ? HexAlphaColorPicker : HexColorPicker;
  const recent = editor.recent('color').filter((c) => alpha || c.length === 7).slice(0, 8);
  return (
    <Popover
      onOpenChange={(open) => {
        if (!open) editor.addRecent('color', value);
      }}
    >
      <PopoverTrigger
        data-testid={testId}
        aria-label={label}
        className="inline-flex h-control w-full min-w-0 items-center gap-2 rounded-md bg-control px-1.5 text-sm hover:bg-control-hi"
      >
        <Swatch hex={value} className="size-4 shrink-0" />
        <span className="truncate num">{value}</span>
      </PopoverTrigger>
      <PopoverContent side="left" align="start" className="w-[232px]" aria-label={label}>
        <div className="flex flex-col gap-3">
          <div className="allay-colorful" onPointerDownCapture={() => beginGesture(editor)}>
            <Picker color={value.toLowerCase()} onChange={set} />
          </div>
          <div className="flex items-center gap-2">
            <Swatch hex={value} className="size-7 shrink-0" />
            <Input
              aria-label={editor.t('color.hex')}
              value={draft}
              maxLength={alpha ? 9 : 7}
              className="num"
              onChange={(e) => setDraft(e.currentTarget.value)}
              onBlur={commitDraft}
              onKeyDown={(e) => {
                if (e.key === 'Enter') commitDraft();
              }}
            />
          </div>
          {recent.length > 0 && (
            <div className="flex flex-col gap-1">
              <span className="text-xs text-fg-subtle">{editor.t('color.recent')}</span>
              <div className="flex flex-wrap gap-1">
                {recent.map((c) => (
                  <button key={c} type="button" aria-label={c} title={c} className="size-6" onClick={() => set(c)}>
                    <Swatch hex={c} className="size-6" />
                  </button>
                ))}
              </div>
            </div>
          )}
          {palette && (
            <div className="flex flex-col gap-1">
              <span className="text-xs text-fg-subtle">{editor.t(`color.palette.${palette}`)}</span>
              <div className="grid grid-cols-8 gap-1">
                {PALETTES[palette].map((c) => {
                  const name = editor.t(`color.${palette}.${c.key}`);
                  return (
                    <button
                      key={c.key}
                      type="button"
                      aria-label={name}
                      title={`${name} ${c.hex}`}
                      className="size-6"
                      onClick={() => {
                        set(alpha && value.length === 9 ? `${c.hex}${value.slice(7)}` : c.hex);
                        editor.addRecent('color', c.hex);
                      }}
                    >
                      <Swatch hex={c.hex} className="size-6" />
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
