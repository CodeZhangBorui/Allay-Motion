import { useVirtualizer } from '@tanstack/react-virtual';
import { cn } from 'cn';
import { ImageOff, Search } from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Button } from '../components/ui/button';
import { Input, Skeleton } from '../components/ui/misc';
import { Popover, PopoverContent, PopoverTrigger } from '../components/ui/popover';
import { useEditor, type CatalogEntry } from './context';

// BlockPicker / ItemPicker（6.5）：弹层网格，可搜索（ID、中文名、英文名），分组，最近使用，虚拟滚动；
// 缩略图来自当前资源栈（引擎的缩略图服务）。没有素材层时显示占位和引导。

type Kind = 'block' | 'item';

/** 一张缩略图：取到之前是骨架块，像素化显示 */
export function ResourceThumb({ kind, id, size = 32, className }: { kind: Kind; id: string; size?: number; className?: string }) {
  const editor = useEditor();
  const [url, setUrl] = useState<string | null | undefined>(undefined);
  useEffect(() => {
    let alive = true;
    setUrl(undefined);
    if (!editor.hasAssets) {
      setUrl(null);
      return;
    }
    void editor.thumbnail(kind, id).then((u) => alive && setUrl(u));
    return () => {
      alive = false;
    };
    // resourceStamp 变了要重新取
  }, [kind, id, editor, editor.hasAssets, editor.resourceStamp]);
  if (url === undefined) return <Skeleton className={cn('shrink-0', className)} style={{ width: size, height: size }} />;
  if (url === null)
    return (
      <span className={cn('inline-flex shrink-0 items-center justify-center bg-skeleton text-fg-muted', className)} style={{ width: size, height: size }} aria-hidden="true">
        <ImageOff className="size-(--icon-sm)" />
      </span>
    );
  return <img src={url} alt="" width={size} height={size} draggable={false} className={cn('pixelated shrink-0', className)} />;
}

export function entryName(entry: CatalogEntry | undefined, id: string, locale: string): string {
  if (!entry) return id;
  return locale.startsWith('zh') ? entry.names['zh-CN'] : entry.names.en;
}

function matches(entry: CatalogEntry, q: string): boolean {
  if (!q) return true;
  const s = q.toLowerCase();
  return entry.id.toLowerCase().includes(s) || entry.names.en.toLowerCase().includes(s) || entry.names['zh-CN'].includes(q);
}

const COLS = 7;
const CELL = 40;

type Row = { kind: 'header'; label: string } | { kind: 'cells'; entries: CatalogEntry[] };

function PickerGrid({ kind, value, onPick }: { kind: Kind; value: string | null; onPick(id: string): void }) {
  const editor = useEditor();
  const [q, setQ] = useState('');
  const entries = kind === 'block' ? editor.blocks : editor.items;
  const groups = kind === 'block' ? editor.blockGroups : editor.itemGroups;
  const byId = useMemo(() => new Map(entries.map((e) => [e.id, e])), [entries]);
  const rows = useMemo<Row[]>(() => {
    const out: Row[] = [];
    const push = (label: string, list: CatalogEntry[]) => {
      if (list.length === 0) return;
      out.push({ kind: 'header', label });
      for (let i = 0; i < list.length; i += COLS) out.push({ kind: 'cells', entries: list.slice(i, i + COLS) });
    };
    if (!q) {
      const recent = editor
        .recent(kind)
        .map((id) => byId.get(id))
        .filter((e): e is CatalogEntry => !!e)
        .slice(0, COLS);
      push(editor.t('picker.recent'), recent);
    }
    for (const g of groups) push(g.label, entries.filter((e) => e.group === g.key && matches(e, q)));
    return out;
  }, [q, entries, groups, editor, kind, byId]);
  const scrollRef = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: (i) => (rows[i]!.kind === 'header' ? 24 : CELL + 2),
    overscan: 6,
  });
  const anyMatch = rows.some((r) => r.kind === 'cells');
  return (
    <div className="flex flex-col gap-2">
      <div className="relative">
        <Search className="pointer-events-none absolute top-1/2 left-2 size-(--icon-sm) -translate-y-1/2 text-fg-muted" aria-hidden="true" />
        <Input autoFocus value={q} onChange={(e) => setQ(e.currentTarget.value)} placeholder={editor.t('picker.search')} aria-label={editor.t('picker.search')} className="pl-8" />
      </div>
      {!editor.hasAssets && (
        <div className="flex items-center justify-between gap-2 bg-well px-2 py-1.5 text-xs text-fg-muted" data-testid="picker-no-assets">
          <span>{editor.t('picker.noAssets')}</span>
          {editor.openResources && (
            <Button size="xs" variant="secondary" onClick={editor.openResources}>
              {editor.t('picker.addAssets')}
            </Button>
          )}
        </div>
      )}
      <div ref={scrollRef} className="h-[300px] overflow-y-auto" role="listbox" aria-label={editor.t(kind === 'block' ? 'picker.blocks' : 'picker.items')}>
        {!anyMatch && <p className="py-6 text-center text-xs text-fg-muted">{editor.t('picker.empty', { q })}</p>}
        <div style={{ height: virtualizer.getTotalSize(), position: 'relative' }}>
          {virtualizer.getVirtualItems().map((vi) => {
            const row = rows[vi.index]!;
            return (
              <div key={vi.key} className="absolute inset-x-0" style={{ transform: `translateY(${vi.start}px)`, height: vi.size }}>
                {row.kind === 'header' ? (
                  <div className="flex h-6 items-end px-0.5 pb-1 font-px12 text-fg-muted">{row.label}</div>
                ) : (
                  <div className="flex gap-0.5">
                    {row.entries.map((e) => {
                      const name = entryName(e, e.id, editor.locale);
                      return (
                        <button
                          key={e.id}
                          type="button"
                          role="option"
                          aria-selected={value === e.id}
                          aria-label={name}
                          title={`${name}\n${e.id}`}
                          data-testid={`pick-${e.id}`}
                          className={cn('flex size-10 items-center justify-center blk-sunken hover:bg-surface-2', value === e.id && 'outline-2 -outline-offset-2 outline-(--ring)')}
                          onClick={() => {
                            editor.addRecent(kind, e.id);
                            onPick(e.id);
                          }}
                        >
                          <ResourceThumb kind={kind} id={e.id} />
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

/** 弹出选择器；trigger 由调用方给（单个方块的按钮、方块列表的“+”芯片） */
export function ResourcePickerPopover({ kind, value, onPick, trigger, label }: { kind: Kind; value: string | null; onPick(id: string): void; trigger: ReactNode; label: string }) {
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      {trigger}
      <PopoverContent side="left" align="start" className="w-[304px]" aria-label={label}>
        {open && (
          <PickerGrid
            kind={kind}
            value={value}
            onPick={(id) => {
              onPick(id);
              setOpen(false);
            }}
          />
        )}
      </PopoverContent>
    </Popover>
  );
}

function SinglePicker({ kind, value, onChange, label, testId }: { kind: Kind; value: string; onChange(v: string): void; label: string; testId?: string }) {
  const editor = useEditor();
  const entries = kind === 'block' ? editor.blocks : editor.items;
  const entry = entries.find((e) => e.id === value);
  return (
    <ResourcePickerPopover
      kind={kind}
      value={value}
      onPick={onChange}
      label={label}
      trigger={
        <PopoverTrigger
          data-testid={testId}
          aria-label={label}
          className="inline-flex h-7 w-full min-w-0 items-center gap-2 blk blk-sunken px-1 text-sm hover:[--blk-c:var(--fg-muted)]"
        >
          <ResourceThumb kind={kind} id={value} size={20} />
          <span className="truncate">{entryName(entry, value, editor.locale)}</span>
        </PopoverTrigger>
      }
    />
  );
}

export function BlockPicker(props: { value: string; onChange(v: string): void; label: string; testId?: string }) {
  return <SinglePicker kind="block" {...props} />;
}

export function ItemPicker(props: { value: string; onChange(v: string): void; label: string; testId?: string }) {
  return <SinglePicker kind="item" {...props} />;
}
