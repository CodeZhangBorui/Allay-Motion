import { localize, sameValue, type LocalizedString, type ParamDef, type ParamValue, type ParamValues } from '@allay/template-sdk';
import { cn } from 'cn';
import { ChevronRight } from 'lucide-react';
import { memo, useCallback, type ReactNode } from 'react';
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuTrigger } from '../components/ui/context-menu';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '../components/ui/misc';
import { Tooltip, TooltipContent, TooltipTrigger } from '../components/ui/tooltip';
import { ColorField } from './ColorField';
import { useEditor } from './context';
import { EasingField } from './EasingField';
import { AngleField, BooleanField, DurationField, EnumField, SeedField, SoundField, TextField } from './fields';
import { BlockListField, TextureField, type BlockListEntry } from './listFields';
import { BlockPicker, ItemPicker } from './ResourcePicker';
import { ScrubNumberField, SliderField } from './ScrubNumberField';

// ParamRow / ParamGroup / ParamPanel（6.4、6.5）：由 manifest 的参数定义自动生成整个属性面板。
// 15 种参数类型各对应一个控件（4.4）。每一行：左边标签（约 40% 宽，过长截断，悬停显示 hint），右边控件；
// 值不等于默认值时标签前有一个小方块，点它恢复默认；右键菜单：重置、复制值、粘贴值。分组标题是通栏色条加像素字。

export interface ParamGroupDef {
  key: string;
  label: LocalizedString;
  collapsed?: boolean;
}

export interface ParamPanelProps {
  defs: readonly ParamDef[];
  groups?: readonly ParamGroupDef[];
  hidden?: readonly string[];
  values: ParamValues;
  defaults: ParamValues;
  onChange(key: string, value: ParamValue): void;
  /** 分组折叠状态（按模板记忆）；没有记录的用 manifest 的 collapsed */
  collapsed: Readonly<Record<string, boolean>>;
  onToggleGroup(key: string, collapsed: boolean): void;
  /** file: 引用对应的文件名，只用于显示 */
  fileNames?: Readonly<Record<string, string>>;
  /** 应用内的“剪贴板”：复制值、粘贴值 */
  clipboard: { copy(def: ParamDef, value: ParamValue): void; paste(def: ParamDef): ParamValue | undefined };
}

/** visibleWhen 只做界面显隐（4.4） */
export function isVisible(def: ParamDef, values: ParamValues): boolean {
  const w = def.visibleWhen;
  if (!w) return true;
  const v = values[w.key];
  if (w.equals !== undefined && !sameValue(v, w.equals)) return false;
  if (w.in !== undefined && !w.in.some((x) => sameValue(v, x))) return false;
  if (w.not !== undefined && sameValue(v, w.not)) return false;
  return true;
}

function ParamControl({ def, value, onChange, label, fileNames }: { def: ParamDef; value: ParamValue; onChange(v: ParamValue): void; label: string; fileNames: Readonly<Record<string, string>> }) {
  const editor = useEditor();
  const testId = `param-${def.key}`;
  switch (def.type) {
    case 'number': {
      const step = def.step ?? (def.max - def.min > 20 ? 1 : 0.01);
      const props = { value: value as number, onChange, min: def.min, max: def.max, step, unit: def.unit, label, testId };
      return def.ui === 'field' ? <ScrubNumberField {...props} /> : <SliderField {...props} />;
    }
    case 'integer': {
      const props = { value: value as number, onChange: (v: number) => onChange(Math.round(v)), min: def.min, max: def.max, step: 1, label, testId };
      return def.ui === 'slider' ? <SliderField {...props} /> : <ScrubNumberField {...props} />;
    }
    case 'boolean':
      return <BooleanField value={value as boolean} onChange={onChange} label={label} testId={testId} />;
    case 'enum':
      return <EnumField value={value as string} onChange={onChange} label={label} testId={testId} options={def.options.map((o) => ({ value: o.value, label: localize(o.label, editor.locale) }))} />;
    case 'color':
      return <ColorField value={value as string} onChange={onChange} alpha={def.alpha} palette={def.palette} label={label} testId={testId} />;
    case 'text':
      return <TextField value={value as string} onChange={onChange} multiline={def.multiline} maxLength={def.maxLength} label={label} testId={testId} />;
    case 'block':
      return <BlockPicker value={value as string} onChange={onChange} label={label} testId={testId} />;
    case 'item':
      return <ItemPicker value={value as string} onChange={onChange} label={label} testId={testId} />;
    case 'blockList':
      return <BlockListField value={value as unknown as BlockListEntry[]} onChange={(v) => onChange(v as unknown as ParamValue)} max={def.max} label={label} testId={testId} />;
    case 'texture':
      return <TextureField value={value as string} onChange={onChange} allowFile={def.allowFile} fileNames={fileNames} label={label} testId={testId} />;
    case 'sound':
      return <SoundField value={value as string | null} onChange={onChange} label={label} testId={testId} />;
    case 'easing':
      return <EasingField value={value as string | [number, number, number, number]} onChange={(v) => onChange(v as ParamValue)} label={label} testId={testId} />;
    case 'duration':
      return <DurationField value={value as number} onChange={onChange} min={def.min} max={def.max} label={label} testId={testId} />;
    case 'angle':
      return <AngleField value={value as number} onChange={onChange} snap={def.snap} label={label} testId={testId} />;
    case 'seed':
      return <SeedField value={value as number} onChange={onChange} label={label} testId={testId} />;
  }
}

interface ParamRowProps {
  def: ParamDef;
  value: ParamValue;
  defaultValue: ParamValue;
  onChange(key: string, value: ParamValue): void;
  fileNames: Readonly<Record<string, string>>;
  clipboard: ParamPanelProps['clipboard'];
}

export const ParamRow = memo(function ParamRow({ def, value, defaultValue, onChange, fileNames, clipboard }: ParamRowProps) {
  const editor = useEditor();
  const label = localize(def.label, editor.locale);
  const hint = def.hint ? localize(def.hint, editor.locale) : undefined;
  const changed = !sameValue(value, defaultValue);
  const set = useCallback((v: ParamValue) => onChange(def.key, v), [onChange, def.key]);
  const tall = def.type === 'blockList' || (def.type === 'text' && def.multiline) || (def.type === 'easing' && typeof value !== 'string');
  const labelEl = (
    <span className={cn('min-w-0 truncate text-xs', changed ? 'text-foreground' : 'text-fg-muted')} data-testid={`param-label-${def.key}`}>
      {label}
    </span>
  );
  return (
    <ContextMenu>
      <ContextMenuTrigger
        render={<div />}
        data-testid={`param-row-${def.key}`}
        data-changed={changed}
        className={cn('flex min-h-9 gap-2 px-3', tall ? 'items-start py-1.5' : 'items-center py-0.5')}
      >
        <div className={cn('flex w-[40%] min-w-0 shrink-0 items-center gap-1', tall && 'h-7')}>
          {changed ? (
            <button
              type="button"
              aria-label={editor.t('param.resetOne', { name: label })}
              title={editor.t('param.resetOne', { name: label })}
              data-testid={`param-reset-${def.key}`}
              className="-ml-2 inline-flex size-6 shrink-0 items-center justify-center hover:bg-surface-2"
              onClick={() => onChange(def.key, defaultValue)}
            >
              <span className="size-2 bg-primary-text" />
            </button>
          ) : (
            <span className="-ml-2 size-6 shrink-0" aria-hidden="true" />
          )}
          {hint ? (
            <Tooltip>
              <TooltipTrigger render={<span className="min-w-0 truncate" />}>{labelEl}</TooltipTrigger>
              <TooltipContent side="left">{hint}</TooltipContent>
            </Tooltip>
          ) : (
            <span className="min-w-0 truncate" title={label}>
              {labelEl}
            </span>
          )}
        </div>
        <div className="min-w-0 flex-1">
          <ParamControl def={def} value={value} onChange={set} label={label} fileNames={fileNames} />
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuItem disabled={!changed} onClick={() => onChange(def.key, defaultValue)}>
          {editor.t('param.reset')}
        </ContextMenuItem>
        <ContextMenuItem onClick={() => clipboard.copy(def, value)}>{editor.t('param.copy')}</ContextMenuItem>
        <ContextMenuItem
          onClick={() => {
            const v = clipboard.paste(def);
            if (v !== undefined) onChange(def.key, v);
          }}
        >
          {editor.t('param.paste')}
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
});

export function ParamGroup({ id, title, collapsed, onToggle, children }: { id: string; title: string; collapsed: boolean; onToggle(collapsed: boolean): void; children: ReactNode }) {
  return (
    <Collapsible open={!collapsed} onOpenChange={(open) => onToggle(!open)}>
      <CollapsibleTrigger
        data-testid={`param-group-${id}`}
        className="group flex h-7 w-full items-center gap-1.5 bg-surface-2 px-2 text-left font-px12 text-foreground shadow-[inset_0_2px_0_0_var(--bevel-hi),inset_0_-2px_0_0_var(--bevel-lo)] hover:bg-surface-3"
      >
        <ChevronRight className="size-4 text-fg-muted transition-transform duration-(--dur-2) ease-(--ease-step) group-data-[panel-open]:rotate-90" aria-hidden="true" />
        {title}
      </CollapsibleTrigger>
      <CollapsibleContent className="py-1.5">{children}</CollapsibleContent>
    </Collapsible>
  );
}

export function ParamPanel({ defs, groups = [], hidden = [], values, defaults, onChange, collapsed, onToggleGroup, fileNames = {}, clipboard }: ParamPanelProps) {
  const editor = useEditor();
  const shown = defs.filter((d) => !hidden.includes(d.key) && isVisible(d, values));
  const row = (d: ParamDef) => (
    <ParamRow key={d.key} def={d} value={values[d.key] ?? defaults[d.key] ?? null} defaultValue={defaults[d.key] ?? null} onChange={onChange} fileNames={fileNames} clipboard={clipboard} />
  );
  const known = new Set(groups.map((g) => g.key));
  const loose = shown.filter((d) => !d.group || !known.has(d.group));
  return (
    <div className="flex flex-col" data-testid="param-panel">
      {loose.length > 0 && <div className="py-1.5">{loose.map(row)}</div>}
      {groups.map((g) => {
        const rows = shown.filter((d) => d.group === g.key);
        if (rows.length === 0) return null;
        return (
          <ParamGroup key={g.key} id={g.key} title={localize(g.label, editor.locale)} collapsed={collapsed[g.key] ?? g.collapsed ?? false} onToggle={(c) => onToggleGroup(g.key, c)}>
            {rows.map(row)}
          </ParamGroup>
        );
      })}
    </div>
  );
}
