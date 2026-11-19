import { cn } from 'cn';
import { DotsSixVertical, ImageSquare, Plus, X } from '@phosphor-icons/react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/misc';
import { Popover, PopoverContent, PopoverTrigger } from '../components/ui/popover';
import { ICON } from '../lib/icons';
import { useEditor } from './context';
import { moveEntry } from './listOrder';
import { entryName, ResourcePickerPopover, ResourceThumb } from './ResourcePicker';
import { ScrubNumberField } from './ScrubNumberField';

// BlockListField 与 TextureField（6.5）。

export interface BlockListEntry {
  id: string;
  weight: number;
}

/**
 * BlockListField：多个方块芯片，每个带权重（可拖拽调值），可增删。
 * 顺序有意义（“方块排列”按列表顺序铺条带）：拖动左侧把手排序，把手聚焦时上下方向键也能移动。
 */
export function BlockListField({ value, onChange, max = 64, label, testId }: { value: readonly BlockListEntry[]; onChange(v: BlockListEntry[]): void; max?: number; label: string; testId?: string }) {
  const editor = useEditor();
  const byId = useMemo(() => new Map(editor.blocks.map((b) => [b.id, b])), [editor.blocks]);
  const update = (i: number, patch: Partial<BlockListEntry>) => onChange(value.map((e, j) => (j === i ? { ...e, ...patch } : e)));
  const [drag, setDrag] = useState<{ from: number; over: number } | null>(null);
  const handles = useRef<(HTMLSpanElement | null)[]>([]);
  const move = (from: number, to: number, focus = false) => {
    if (to < 0 || to >= value.length || from === to) return;
    onChange(moveEntry(value, from, to));
    if (focus) requestAnimationFrame(() => handles.current[to]?.focus());
  };
  return (
    <div className="flex min-w-0 flex-col gap-1" role="group" aria-label={label} data-testid={testId}>
      {value.map((entry, i) => {
        const name = entryName(byId.get(entry.id), entry.id, editor.locale);
        const dropHere = drag !== null && drag.over === i && drag.from !== i;
        return (
          <div
            key={`${entry.id}-${i}`}
            className={cn(
              'flex h-8 min-w-0 items-center gap-1.5 rounded-lg bg-control pr-1',
              drag?.from === i && 'opacity-50',
              dropHere && (drag.from < i ? 'shadow-[inset_0_-2px_0_var(--primary)]' : 'shadow-[inset_0_2px_0_var(--primary)]'),
            )}
            data-testid={testId ? `${testId}-row-${i}` : undefined}
            onDragOver={(e) => {
              if (!drag) return;
              e.preventDefault();
              e.dataTransfer.dropEffect = 'move';
              if (drag.over !== i) setDrag({ from: drag.from, over: i });
            }}
            onDrop={(e) => {
              if (!drag) return;
              e.preventDefault();
              move(drag.from, i);
              setDrag(null);
            }}
          >
            {value.length > 1 ? (
              <span
                ref={(el) => {
                  handles.current[i] = el;
                }}
                role="button"
                tabIndex={0}
                draggable
                aria-label={editor.t('blockList.reorder', { name })}
                title={editor.t('blockList.reorder', { name })}
                className="flex h-full w-4 shrink-0 cursor-grab items-center justify-center rounded-sm text-fg-subtle hover:text-foreground active:cursor-grabbing"
                data-testid={testId ? `${testId}-handle-${i}` : undefined}
                onDragStart={(e) => {
                  e.dataTransfer.effectAllowed = 'move';
                  e.dataTransfer.setData('text/plain', String(i));
                  const row = e.currentTarget.parentElement;
                  if (row) e.dataTransfer.setDragImage(row, 8, 16);
                  setDrag({ from: i, over: i });
                }}
                onDragEnd={() => setDrag(null)}
                onKeyDown={(e) => {
                  if (e.key === 'ArrowUp') move(i, i - 1, true);
                  else if (e.key === 'ArrowDown') move(i, i + 1, true);
                  else return;
                  e.preventDefault();
                }}
              >
                <DotsSixVertical size={ICON.xs} weight="bold" />
              </span>
            ) : (
              <span className="w-1 shrink-0" aria-hidden="true" />
            )}
            <ResourcePickerPopover
              kind="block"
              value={entry.id}
              label={editor.t('blockList.replace', { name })}
              onPick={(id) => update(i, { id })}
              trigger={
                <PopoverTrigger aria-label={editor.t('blockList.replace', { name })} className="flex min-w-0 flex-1 items-center gap-2 rounded-sm text-left text-foreground">
                  <ResourceThumb kind="block" id={entry.id} size={22} className="rounded-[4px]" />
                  <span className="truncate" title={entry.id}>
                    {name}
                  </span>
                </PopoverTrigger>
              }
            />
            <ScrubNumberField
              value={entry.weight}
              onChange={(w) => update(i, { weight: w })}
              min={0}
              max={1000}
              step={0.1}
              decimals={1}
              label={editor.t('blockList.weight', { name })}
              lead={<span className="num">×</span>}
              bare
              className="w-16 shrink-0"
            />
            <Button
              variant="ghost"
              size="icon-xs"
              className="text-fg-subtle"
              aria-label={editor.t('blockList.remove', { name })}
              disabled={value.length <= 1}
              onClick={() => onChange(value.filter((_, j) => j !== i))}
            >
              <X size={ICON.xs} />
            </Button>
          </div>
        );
      })}
      {value.length < max && (
        <ResourcePickerPopover
          kind="block"
          value={null}
          label={editor.t('blockList.add')}
          onPick={(id) => onChange([...value, { id, weight: 1 }])}
          trigger={
            <PopoverTrigger className="inline-flex h-[30px] items-center gap-2 rounded-lg px-2.5 text-fg-muted shadow-[inset_0_0_0_1px_var(--control-hi)] hover:bg-control hover:text-foreground" data-testid={testId ? `${testId}-add` : undefined}>
              <Plus size={ICON.xs + 1} />
              {editor.t('blockList.add')}
            </PopoverTrigger>
          }
        />
      )}
    </div>
  );
}

function TexturePreview({ value, size = 20 }: { value: string; size?: number }) {
  const editor = useEditor();
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    setUrl(null);
    if (value) void editor.texturePreview(value).then((u) => alive && setUrl(u));
    return () => {
      alive = false;
    };
  }, [value, editor, editor.resourceStamp]);
  return url ? (
    <img src={url} alt="" width={size} height={size} className="pixelated shrink-0 rounded-[3px] object-contain" />
  ) : (
    <span className="shrink-0 rounded-[3px] bg-skeleton" style={{ width: size, height: size }} aria-hidden="true" />
  );
}

/** 显示用的名字：file: 引用显示文件名，asset: 显示路径，资源 ID 原样 */
function textureLabel(value: string, fileNames: Readonly<Record<string, string>>, none: string): string {
  if (!value) return none;
  if (value.startsWith('file:')) return fileNames[value] ?? value.slice(5, 13);
  if (value.startsWith('asset:')) return value.slice(6);
  return value;
}

/** TextureField：从资源栈按 ID 选，或导入本地图片（allowFile 时） */
export function TextureField({
  value,
  onChange,
  allowFile,
  fileNames = {},
  label,
  testId,
}: {
  value: string;
  onChange(v: string): void;
  allowFile?: boolean;
  /** file: 引用对应的文件名（只用于显示） */
  fileNames?: Readonly<Record<string, string>>;
  label: string;
  testId?: string;
}) {
  const editor = useEditor();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const ids = useMemo(() => editor.textureIds.filter((id) => !q || id.includes(q.toLowerCase())).slice(0, 300), [editor.textureIds, q]);
  return (
    <div className="flex min-w-0 items-center gap-1" data-testid={testId}>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger aria-label={label} className="inline-flex h-control min-w-0 flex-1 items-center gap-2 rounded-md bg-control px-1 text-sm hover:bg-control-hi">
          <TexturePreview value={value} />
          <span className="truncate num text-xs">{textureLabel(value, fileNames, editor.t('texture.none'))}</span>
        </PopoverTrigger>
        <PopoverContent side="left" align="start" className="w-[304px]" aria-label={label}>
          <div className="flex flex-col gap-2">
            <Input autoFocus value={q} onChange={(e) => setQ(e.currentTarget.value)} placeholder={editor.t('texture.search')} aria-label={editor.t('texture.search')} />
            <div className="grid max-h-[260px] grid-cols-7 gap-0.5 overflow-y-auto" role="listbox" aria-label={editor.t('texture.fromStack')}>
              {ids.map((id) => (
                <button
                  key={id}
                  type="button"
                  role="option"
                  aria-selected={value === id}
                  title={id}
                  aria-label={id}
                  className={cn('flex size-10 items-center justify-center rounded-md hover:bg-control', value === id && 'bg-primary-soft shadow-[inset_0_0_0_1.5px_var(--primary)]')}
                  onClick={() => {
                    onChange(id);
                    setOpen(false);
                  }}
                >
                  <TexturePreview value={id} size={32} />
                </button>
              ))}
            </div>
          </div>
        </PopoverContent>
      </Popover>
      {allowFile && (
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={editor.t('texture.import')}
          title={editor.t('texture.import')}
          onClick={() =>
            void editor.pickImage().then((picked) => {
              if (picked) onChange(picked.value);
            })
          }
        >
          <ImageSquare size={ICON.md} />
        </Button>
      )}
    </div>
  );
}
