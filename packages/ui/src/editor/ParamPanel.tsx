import { localize, sameValue, type LocalizedString, type ParamDef, type ParamValue, type ParamValues } from '@allay/template-sdk';
import { ArrowCounterClockwise, CaretRight } from '@phosphor-icons/react';
import { cn } from 'cn';
import { memo, useCallback, type ReactNode } from 'react';
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuTrigger } from '../components/ui/context-menu';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '../components/ui/misc';
import { Tooltip, TooltipContent, TooltipTrigger } from '../components/ui/tooltip';
import { ICON, ICON_WEIGHT } from '../lib/icons';
import { ColorField } from './ColorField';
import { useEditor } from './context';
import { EasingField } from './EasingField';
import { FontField, type FontValue } from './FontField';
import { AngleField, BooleanField, DurationField, EnumField, SeedField, TextField, type EnumOption } from './fields';
import { SoundField, SpatialAudioRow } from './SoundPicker';
import { BlockListField, TextureField, type BlockListEntry } from './listFields';
import { BlockPicker, ItemPicker } from './ResourcePicker';
import { ScrubNumberField, SliderField } from './ScrubNumberField';

// ParamRow / ParamGroup / ParamPanel（6.4、6.5）：由 manifest 的参数定义自动生成整个属性面板。
// 15 种参数类型各对应一个控件（4.4）。分组是标题行（实心小三角 + 半粗标题）加组间 1 px 分隔线。
// 每一行：左标签（次要色，过长截断，悬停显示 hint）+ 右控件；改过的参数在标签左侧有一个琥珀小点，悬停这一行时变成“重置”按钮；
// 右键菜单：重置、复制值、粘贴值。图案类 enum 占整行（标签和当前项名称在上，小格在下）。
// 一个分组里全是 duration 时，并排成一组数值框（框内左侧是标签），组标题右侧显示总帧数。
// 聚焦层（docs/decisions.md“2026-11 反馈：时间线与曲线编辑”）：某个控件（自定义缓动曲线编辑器）浮起时，它在根上加
// data-focus-layer、在自己那一行加 data-focus-owner；其余各行和组标题（data-dim）降到 35% 不透明度。

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

function enumOptions(def: Extract<ParamDef, { type: 'enum' }>, locale: string): EnumOption[] {
  return def.options.map((o) => ({ value: o.value, label: localize(o.label, locale), pattern: o.pattern }));
}

function isPattern(def: ParamDef): boolean {
  return def.type === 'enum' && def.ui === 'pattern' && def.options.every((o) => o.pattern);
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
      return def.ui === 'field' ? <ScrubNumberField {...props} /> : <SliderField {...props} />;
    }
    case 'boolean':
      return <BooleanField value={value as boolean} onChange={onChange} label={label} testId={testId} />;
    case 'enum':
      return <EnumField value={value as string} onChange={onChange} label={label} testId={testId} ui={def.ui} options={enumOptions(def, editor.locale)} />;
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
    case 'font':
      return <FontField value={value as unknown as FontValue} onChange={(v) => onChange(v as unknown as ParamValue)} label={label} testId={testId} />;
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

/** 改过的标记：琥珀小点；悬停这一行时变成“重置”按钮 */
function ChangedMark({ def, label, onReset }: { def: ParamDef; label: string; onReset(): void }) {
  const editor = useEditor();
  return (
    <button
      type="button"
      aria-label={editor.t('param.resetOne', { name: label })}
      title={editor.t('param.resetOne', { name: label })}
      data-testid={`param-reset-${def.key}`}
      className="-ml-4 inline-flex size-4 shrink-0 items-center justify-center rounded-sm text-fg-muted hover:text-foreground"
      onClick={onReset}
    >
      <span className="size-[5px] rounded-full bg-mark group-hover/row:hidden" />
      <ArrowCounterClockwise size={ICON.xs} className="hidden group-hover/row:block" />
    </button>
  );
}

function RowMenu({ def, value, defaultValue, changed, onChange, clipboard, children }: ParamRowProps & { changed: boolean; children: ReactNode }) {
  const editor = useEditor();
  return (
    <ContextMenu>
      {children}
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
}

export const ParamRow = memo(function ParamRow(props: ParamRowProps) {
  const { def, value, defaultValue, onChange, fileNames } = props;
  const editor = useEditor();
  const label = localize(def.label, editor.locale);
  const hint = def.hint ? localize(def.hint, editor.locale) : undefined;
  const changed = !sameValue(value, defaultValue);
  const set = useCallback((v: ParamValue) => onChange(def.key, v), [onChange, def.key]);
  const pattern = isPattern(def);
  const tall = def.type === 'blockList' || def.type === 'font' || (def.type === 'text' && def.multiline) || (def.type === 'easing' && typeof value !== 'string');
  const labelText = (
    <span className="min-w-0 truncate" data-testid={`param-label-${def.key}`}>
      {label}
    </span>
  );
  const labelEl = (
    <span className={cn('flex min-w-0 items-center gap-1.5 text-fg-muted', changed && 'text-foreground')}>
      {changed && <ChangedMark def={def} label={label} onReset={() => onChange(def.key, defaultValue)} />}
      {hint ? (
        <Tooltip>
          <TooltipTrigger render={<span className="min-w-0 truncate" />}>{labelText}</TooltipTrigger>
          <TooltipContent side="left">{hint}</TooltipContent>
        </Tooltip>
      ) : (
        <span className="min-w-0 truncate" title={label}>
          {labelText}
        </span>
      )}
    </span>
  );
  // 方块列表占整行（每个方块一行），标签不单独占一列
  if (def.type === 'blockList' || pattern) {
    const current = pattern && def.type === 'enum' ? enumOptions(def, editor.locale).find((o) => o.value === value)?.label : undefined;
    return (
      <RowMenu {...props} changed={changed}>
        <ContextMenuTrigger render={<div />} data-testid={`param-row-${def.key}`} data-changed={changed} data-dim="" className="group/row flex flex-col gap-2 py-1.5">
          {(pattern || changed) && (
            <div className="flex min-w-0 items-center justify-between gap-2">
              {labelEl}
              {current && <span className="truncate text-foreground">{current}</span>}
            </div>
          )}
          {!pattern && !changed && <span className="sr-only">{label}</span>}
          <ParamControl def={def} value={value} onChange={set} label={label} fileNames={fileNames} />
        </ContextMenuTrigger>
      </RowMenu>
    );
  }
  return (
    <RowMenu {...props} changed={changed}>
      <ContextMenuTrigger
        render={<div />}
        data-testid={`param-row-${def.key}`}
        data-changed={changed}
        data-dim=""
        className={cn('group/row grid min-h-row grid-cols-[minmax(72px,30%)_1fr] gap-2.5', tall ? 'items-start py-1' : 'items-center')}
      >
        <div className={cn('flex min-w-0 items-center', tall && 'h-control')}>{labelEl}</div>
        <div className="min-w-0">
          <ParamControl def={def} value={value} onChange={set} label={label} fileNames={fileNames} />
        </div>
      </ContextMenuTrigger>
    </RowMenu>
  );
});

/** 全是 duration 的分组：并排的数值框，框内左侧是标签、右侧是秒数 */
function DurationGroup({ defs, values, defaults, onChange, clipboard, fileNames }: { defs: ParamDef[]; values: ParamValues; defaults: ParamValues } & Pick<ParamPanelProps, 'onChange' | 'clipboard'> & { fileNames: Readonly<Record<string, string>> }) {
  const editor = useEditor();
  const fps = editor.fps;
  return (
    <div className="grid gap-[5px] py-1" style={{ gridTemplateColumns: `repeat(${Math.min(3, defs.length)}, minmax(0, 1fr))` }}>
      {defs.map((def) => {
        if (def.type !== 'duration') return null;
        const label = localize(def.label, editor.locale);
        const value = (values[def.key] ?? defaults[def.key]) as number;
        const defaultValue = defaults[def.key] ?? null;
        const changed = !sameValue(value, defaultValue);
        const snap = (v: number) => Math.min(def.max, Math.max(def.min, Math.round(v * fps) / fps));
        return (
          <RowMenu key={def.key} def={def} value={value} defaultValue={defaultValue} onChange={onChange} clipboard={clipboard} fileNames={fileNames} changed={changed}>
            <ContextMenuTrigger render={<div />} data-testid={`param-row-${def.key}`} data-changed={changed} data-dim="" className="group/row relative min-w-0">
              {changed && (
                <span className="absolute -top-1 -left-1 z-10">
                  <span className="ml-4 inline-flex">
                    <ChangedMark def={def} label={label} onReset={() => onChange(def.key, defaultValue)} />
                  </span>
                </span>
              )}
              <ScrubNumberField
                value={value}
                onChange={(v) => onChange(def.key, snap(v))}
                min={def.min}
                max={def.max}
                step={1 / fps}
                decimals={3}
                minDecimals={2}
                unit="s"
                lead={<span data-testid={`param-label-${def.key}`}>{label}</span>}
                label={label}
                testId={`param-${def.key}`}
              />
            </ContextMenuTrigger>
          </RowMenu>
        );
      })}
    </div>
  );
}

export function ParamGroup({ id, title, extra, collapsed, onToggle, children }: { id: string; title: string; extra?: ReactNode; collapsed: boolean; onToggle(collapsed: boolean): void; children: ReactNode }) {
  return (
    <Collapsible open={!collapsed} onOpenChange={(open) => onToggle(!open)} className="border-t border-divider px-3.5 pt-2.5 pb-3">
      <div className="flex h-6 items-center gap-1.5" data-dim="">
        <CollapsibleTrigger data-testid={`param-group-${id}`} className="group flex min-w-0 items-center gap-1.5 rounded-sm text-left font-semibold text-foreground">
          <CaretRight size={ICON.xs - 1} weight={ICON_WEIGHT.active} className="shrink-0 text-fg-subtle transition-transform duration-(--dur-2) group-data-[panel-open]:rotate-90" aria-hidden="true" />
          <span className="truncate">{title}</span>
        </CollapsibleTrigger>
        {extra && <span className="ml-auto shrink-0 text-xs text-fg-subtle">{extra}</span>}
      </div>
      <CollapsibleContent className="pt-1">{children}</CollapsibleContent>
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
    <div
      className="flex flex-col [&_[data-dim]]:transition-opacity [&_[data-dim]]:duration-(--dur-2) [&[data-focus-layer]_[data-dim]:not([data-focus-owner])]:opacity-35"
      data-testid="param-panel"
      data-focus-scope=""
    >
      {loose.length > 0 && (
        <div className="border-t border-divider px-3.5 py-2">
          {loose.map(row)}
          {loose.some((d) => d.type === 'sound') && <SpatialAudioRow />}
        </div>
      )}
      {groups.map((g) => {
        const rows = shown.filter((d) => d.group === g.key);
        if (rows.length === 0) return null;
        const durations = rows.length <= 3 && rows.every((d) => d.type === 'duration');
        const total = durations ? Math.round(rows.reduce((a, d) => a + ((values[d.key] ?? defaults[d.key]) as number), 0) * editor.fps) : 0;
        return (
          <ParamGroup
            key={g.key}
            id={g.key}
            title={localize(g.label, editor.locale)}
            extra={durations ? <span className="num">{editor.t('duration.total', { n: total })}</span> : undefined}
            collapsed={collapsed[g.key] ?? g.collapsed ?? false}
            onToggle={(c) => onToggleGroup(g.key, c)}
          >
            {durations ? <DurationGroup defs={rows} values={values} defaults={defaults} onChange={onChange} clipboard={clipboard} fileNames={fileNames} /> : rows.map(row)}
            {/* 空间音效开关放在含音效参数的那一组末尾（2026-11 反馈） */}
            {rows.some((d) => d.type === 'sound') && <SpatialAudioRow />}
          </ParamGroup>
        );
      })}
    </div>
  );
}
