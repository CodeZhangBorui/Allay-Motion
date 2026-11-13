import { cn } from 'cn';
import { ImagePlus, Plus, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/misc';
import { Popover, PopoverContent, PopoverTrigger } from '../components/ui/popover';
import { useEditor } from './context';
import { entryName, ResourcePickerPopover, ResourceThumb } from './ResourcePicker';
import { ScrubNumberField } from './ScrubNumberField';

// BlockListField 与 TextureField（6.5）。

export interface BlockListEntry {
  id: string;
  weight: number;
}

/** BlockListField：多个方块芯片，每个带权重（可拖拽调值），可增删 */
export function BlockListField({ value, onChange, max = 64, label, testId }: { value: readonly BlockListEntry[]; onChange(v: BlockListEntry[]): void; max?: number; label: string; testId?: string }) {
  const editor = useEditor();
  const byId = useMemo(() => new Map(editor.blocks.map((b) => [b.id, b])), [editor.blocks]);
  const update = (i: number, patch: Partial<BlockListEntry>) => onChange(value.map((e, j) => (j === i ? { ...e, ...patch } : e)));
  return (
    <div className="flex min-w-0 flex-col gap-2 py-0.5" role="group" aria-label={label} data-testid={testId}>
      {value.map((entry, i) => {
        const name = entryName(byId.get(entry.id), entry.id, editor.locale);
        return (
          <div key={`${entry.id}-${i}`} className="flex h-8 min-w-0 items-center gap-1 blk blk-raised pr-0.5 pl-1">
            <ResourcePickerPopover
              kind="block"
              value={entry.id}
              label={editor.t('blockList.replace', { name })}
              onPick={(id) => update(i, { id })}
              trigger={
                <PopoverTrigger aria-label={editor.t('blockList.replace', { name })} className="flex min-w-0 flex-1 items-center gap-1.5 text-left text-xs hover:text-foreground">
                  <ResourceThumb kind="block" id={entry.id} size={20} />
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
              scrubLabel={<span className="font-px12">×</span>}
              className="h-6 w-14 shrink-0"
            />
            <Button
              variant="ghost"
              size="icon-xs"
              aria-label={editor.t('blockList.remove', { name })}
              disabled={value.length <= 1}
              onClick={() => onChange(value.filter((_, j) => j !== i))}
            >
              <X />
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
            <PopoverTrigger className="inline-flex h-6 items-center gap-1 self-start px-1.5 font-px12 text-fg-muted hover:blk hover:blk-raised hover:text-foreground active:blk-down" data-testid={testId ? `${testId}-add` : undefined}>
              <Plus className="size-4" />
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
    <img src={url} alt="" width={size} height={size} className="pixelated shrink-0 object-contain" />
  ) : (
    <span className="shrink-0 bg-skeleton" style={{ width: size, height: size }} aria-hidden="true" />
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
        <PopoverTrigger aria-label={label} className="inline-flex h-7 min-w-0 flex-1 items-center gap-2 blk blk-sunken px-1 text-sm hover:[--blk-c:var(--fg-muted)]">
          <TexturePreview value={value} />
          <span className="truncate font-px12">{textureLabel(value, fileNames, editor.t('texture.none'))}</span>
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
                  className={cn('flex size-10 items-center justify-center blk-sunken hover:bg-surface-2', value === id && 'outline-2 -outline-offset-2 outline-(--ring)')}
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
          size="icon"
          aria-label={editor.t('texture.import')}
          title={editor.t('texture.import')}
          onClick={() =>
            void editor.pickImage().then((picked) => {
              if (picked) onChange(picked.value);
            })
          }
        >
          <ImagePlus />
        </Button>
      )}
    </div>
  );
}
