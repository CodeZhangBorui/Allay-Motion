import { useVirtualizer } from '@tanstack/react-virtual';
import { cn } from 'cn';
import { CaretDown, CloudArrowDown, FileArrowUp, MagnifyingGlass, PencilSimple, Play, PlusSquare, Prohibit, Trash, FileAudio } from '@phosphor-icons/react';
import { useMemo, useRef, useState } from 'react';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/misc';
import { Popover, PopoverContent, PopoverTrigger } from '../components/ui/popover';
import { Switch } from '../components/ui/switch';
import { ICON } from '../lib/icons';
import { useEditor, type SoundLibraryItem } from './context';

// SoundField（6.5）：弹层列表，库是资源栈合并后的 sounds.json 里的全部音效事件（原版层 + 资源包 + 导入的音效），
// 规格 3.8 的常用事件置顶，然后是“导入的音效”，其余按分类（方块、实体、音乐…）分组：资源包新加的音乐、音效
// 按事件 ID 和文件路径归进对应的分类（2026-11 反馈）。名字优先用从语言文件推出的（与游戏内字幕一致），推不出时显示 ID。
// 被资源包改过、资源包新增、自己导入的各有一个标记，悬停说明来自哪个资源包。可搜索（ID、两种语言的名字、资源包名）、虚拟滚动。
// 没有任何素材层时库为空，显示引导（不提供任何自制或合成音效）。旁边是试听按钮。

const ROW = 30;
const HEADER = 24;

type Row = { kind: 'header'; label: string } | { kind: 'none' } | { kind: 'sound'; item: SoundLibraryItem };

/** 分类的显示顺序；不在表里的排在最后 */
const CATEGORY_ORDER = ['block', 'entity', 'item', 'ui', 'music', 'music_disc', 'ambient', 'weather', 'enchant', 'event', 'particle', 'other'];

/**
 * 显示名：语言文件推出的名字（当前语言，没有时用另一种语言）→ 常用事件的界面译名 → ID（minecraft: 去掉）。
 */
export function useSoundName(): (id: string) => string {
  const editor = useEditor();
  return useMemo(() => {
    const common = new Set(editor.sounds.common);
    const byId = new Map(editor.sounds.library.map((i) => [i.id, i]));
    const zh = editor.locale.startsWith('zh');
    return (id: string) => {
      const n = byId.get(id)?.names;
      const derived = zh ? (n?.['zh-CN'] ?? null) : (n?.en ?? null);
      if (derived) return derived;
      if (common.has(id)) return editor.t(`sound.names.${id.replace(/[:.]/g, '_')}`, { id });
      return n?.en ?? n?.['zh-CN'] ?? (id.startsWith('minecraft:') ? id.slice('minecraft:'.length) : id);
    };
  }, [editor]);
}

function categoryOf(item: SoundLibraryItem): string {
  if (item.category) return item.category;
  const path = item.id.slice(item.id.indexOf(':') + 1);
  const first = path.split(/[./]/)[0] ?? '';
  return CATEGORY_ORDER.includes(first) ? first : 'other';
}

function StateIcon({ state, label }: { state: SoundLibraryItem['state']; label: string }) {
  if (state === 'local') return null;
  const Icon = state === 'remote' ? CloudArrowDown : Prohibit;
  return (
    <span title={label} aria-label={label} className="inline-flex shrink-0 text-fg-subtle" data-state={state}>
      <Icon size={ICON.sm} />
    </span>
  );
}

/** 来源标记：被资源包改过（铅笔）、资源包新增（加号）、自己导入（上传）；原版不标 */
function OriginIcon({ item }: { item: SoundLibraryItem }) {
  const editor = useEditor();
  const origin = item.origin ?? 'vanilla';
  if (origin === 'vanilla') return null;
  const packs = (item.packs ?? []).join('、');
  const label = origin === 'imported' ? editor.t('sound.origin.imported') : editor.t(`sound.origin.${origin}`, { packs });
  const Icon = origin === 'overridden' ? PencilSimple : origin === 'added' ? PlusSquare : FileAudio;
  return (
    <span title={label} aria-label={label} className="inline-flex shrink-0 text-fg-muted" data-testid="sound-origin" data-origin={origin}>
      <Icon size={ICON.sm} />
    </span>
  );
}

function SoundList({ value, onPick }: { value: string | null; onPick(id: string | null): void }) {
  const editor = useEditor();
  const name = useSoundName();
  const [q, setQ] = useState('');
  const { library, common } = editor.sounds;
  const rows = useMemo<Row[]>(() => {
    const s = q.trim().toLowerCase();
    const match = (item: SoundLibraryItem) =>
      !s ||
      item.id.toLowerCase().includes(s) ||
      name(item.id).toLowerCase().includes(s) ||
      (item.names?.['zh-CN'] ?? '').toLowerCase().includes(s) ||
      (item.names?.en ?? '').toLowerCase().includes(s) ||
      (item.packs ?? []).some((p) => p.toLowerCase().includes(s));
    const out: Row[] = [];
    if (!s) out.push({ kind: 'none' });
    const byId = new Map(library.map((i) => [i.id, i]));
    const pinned = common.map((id) => byId.get(id)).filter((i): i is SoundLibraryItem => !!i && match(i));
    if (pinned.length > 0) {
      out.push({ kind: 'header', label: editor.t('sound.common') });
      for (const item of pinned) out.push({ kind: 'sound', item });
    }
    const imported = library.filter((i) => i.origin === 'imported' && match(i));
    if (imported.length > 0) {
      out.push({ kind: 'header', label: editor.t('sound.groupImported') });
      for (const item of imported) out.push({ kind: 'sound', item });
    }
    const groups = new Map<string, SoundLibraryItem[]>();
    for (const item of library) {
      if (item.origin === 'imported' || !match(item)) continue;
      const c = categoryOf(item);
      const list = groups.get(c) ?? [];
      list.push(item);
      groups.set(c, list);
    }
    const rank = (c: string) => (CATEGORY_ORDER.includes(c) ? CATEGORY_ORDER.indexOf(c) : CATEGORY_ORDER.length);
    for (const c of [...groups.keys()].sort((a, b) => rank(a) - rank(b) || a.localeCompare(b))) {
      out.push({ kind: 'header', label: editor.t(`sound.categories.${c}`) });
      for (const item of groups.get(c)!) out.push({ kind: 'sound', item });
    }
    return out;
  }, [q, library, common, editor, name]);
  const scrollRef = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: (i) => (rows[i]!.kind === 'header' ? HEADER : ROW),
    overscan: 8,
  });
  const anySound = rows.some((r) => r.kind === 'sound');
  const stateLabel = (state: SoundLibraryItem['state']) => editor.t(state === 'remote' ? 'sound.remote' : 'sound.unavailable');
  const [importing, setImporting] = useState(false);
  return (
    <div className="flex flex-col gap-2">
      <div className="relative">
        <MagnifyingGlass size={ICON.sm} className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-fg-subtle" aria-hidden="true" />
        <Input autoFocus value={q} onChange={(e) => setQ(e.currentTarget.value)} placeholder={editor.t('picker.search')} aria-label={editor.t('picker.search')} className="pl-8" data-testid="sound-search" />
      </div>
      {library.length === 0 && (
        <div className="flex items-center justify-between gap-2 rounded-md bg-control px-2.5 py-1.5 text-xs text-fg-muted" data-testid="sound-library-empty">
          <span>{editor.t(editor.sounds.loading ? 'sound.loading' : 'sound.noLibrary')}</span>
          {!editor.sounds.loading && editor.openResources && (
            <Button size="xs" variant="secondary" onClick={editor.openResources}>
              {editor.t('picker.addAssets')}
            </Button>
          )}
        </div>
      )}
      <div ref={scrollRef} className="h-[300px] overflow-y-auto" role="listbox" aria-label={editor.t('sound.library')} data-testid="sound-list">
        {!anySound && library.length > 0 && q && <p className="py-6 text-center text-xs text-fg-muted">{editor.t('picker.empty', { q })}</p>}
        <div style={{ height: virtualizer.getTotalSize(), position: 'relative' }}>
          {virtualizer.getVirtualItems().map((vi) => {
            const row = rows[vi.index]!;
            return (
              <div key={vi.key} className="absolute inset-x-0" style={{ transform: `translateY(${vi.start}px)`, height: vi.size }}>
                {row.kind === 'header' ? (
                  <div className="flex h-6 items-end px-1 pb-1 text-xs text-fg-subtle" data-testid="sound-group">
                    {row.label}
                  </div>
                ) : row.kind === 'none' ? (
                  <button
                    type="button"
                    role="option"
                    aria-selected={value === null}
                    data-testid="sound-none"
                    className={cn('flex h-7 w-full items-center rounded-md px-2 text-left text-sm hover:bg-control', value === null && 'bg-primary-soft')}
                    onClick={() => onPick(null)}
                  >
                    {editor.t('sound.none')}
                  </button>
                ) : (
                  <div className="group/sound flex h-7 items-center">
                    <button
                      type="button"
                      role="option"
                      aria-selected={value === row.item.id}
                      title={row.item.id}
                      data-testid={`sound-${row.item.id}`}
                      data-state={row.item.state}
                      data-origin={row.item.origin ?? 'vanilla'}
                      className={cn(
                        'flex h-7 min-w-0 flex-1 items-center gap-2 rounded-md px-2 text-left text-sm hover:bg-control',
                        value === row.item.id && 'bg-primary-soft',
                        row.item.state === 'missing' && 'text-fg-subtle',
                      )}
                      onClick={() => onPick(row.item.id)}
                    >
                      <span className="min-w-0 flex-1 truncate">{name(row.item.id)}</span>
                      <OriginIcon item={row.item} />
                      <StateIcon state={row.item.state} label={stateLabel(row.item.state)} />
                    </button>
                    {row.item.origin === 'imported' && editor.removeImportedSound && (
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        className="hidden shrink-0 text-fg-muted group-hover/sound:inline-flex focus-visible:inline-flex"
                        aria-label={editor.t('sound.removeImported', { name: name(row.item.id) })}
                        title={editor.t('sound.removeImported', { name: name(row.item.id) })}
                        onClick={() => editor.removeImportedSound?.(row.item.id)}
                      >
                        <Trash size={ICON.sm} />
                      </Button>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
      {editor.importSounds && (
        <Button
          variant="ghost"
          size="sm"
          className="self-start text-fg-muted"
          disabled={importing}
          data-testid="sound-import"
          onClick={() => {
            setImporting(true);
            void editor
              .importSounds?.()
              .then((ids) => {
                if (ids[0]) onPick(ids[0]);
              })
              .finally(() => setImporting(false));
          }}
        >
          <FileArrowUp size={ICON.sm} />
          {editor.t('sound.import')}
        </Button>
      )}
    </div>
  );
}

/** 音效参数区的“空间音效”开关（2026-11 反馈）：宿主给了 spatialAudio 才显示 */
export function SpatialAudioRow() {
  const editor = useEditor();
  const s = editor.spatialAudio;
  if (!s) return null;
  const label = editor.t('sound.spatial');
  return (
    <div className="grid min-h-row grid-cols-[minmax(72px,30%)_1fr] items-center gap-2.5" data-testid="param-row-spatial-audio">
      <span className="min-w-0 truncate text-fg-muted" title={editor.t('sound.spatialHint')}>
        {label}
      </span>
      <div className="flex min-w-0 items-center gap-2">
        <Switch checked={s.value} onCheckedChange={(v) => s.onChange(v)} aria-label={label} data-testid="spatial-audio-toggle" />
        <span className="min-w-0 truncate text-xs text-fg-subtle" title={editor.t('sound.spatialHint')}>
          {editor.t(s.value ? 'sound.spatialOn' : 'sound.spatialOff')}
        </span>
      </div>
    </div>
  );
}

/** SoundField：选择器加试听按钮（宿主给了 previewSound 才能试听，否则按钮禁用） */
export function SoundField({ value, onChange, label, testId }: { value: string | null; onChange(v: string | null): void; label: string; testId?: string }) {
  const editor = useEditor();
  const name = useSoundName();
  const [open, setOpen] = useState(false);
  const state = value ? editor.sounds.library.find((i) => i.id === value)?.state : undefined;
  return (
    <div className="flex min-w-0 items-center gap-1" data-testid={testId}>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger
          aria-label={label}
          data-testid={testId ? `${testId}-trigger` : undefined}
          className="inline-flex h-control min-w-0 flex-1 items-center gap-1.5 rounded-md bg-control px-2.5 text-sm hover:bg-control-hi"
        >
          <span className="min-w-0 flex-1 truncate text-left">{value === null ? editor.t('sound.none') : name(value)}</span>
          {value !== null && state !== 'local' && <StateIcon state={state ?? 'missing'} label={editor.t(state === 'remote' ? 'sound.remote' : 'sound.unavailable')} />}
          <CaretDown size={ICON.sm} className="shrink-0 text-fg-subtle" aria-hidden="true" />
        </PopoverTrigger>
        <PopoverContent side="left" align="start" className="w-[304px]" aria-label={label}>
          {open && (
            <SoundList
              value={value}
              onPick={(id) => {
                // 选中下载缓存里还没取的音效：宿主按需取回（用户操作触发，decisions.md M6b）
                if (id) editor.prepareSound?.(id);
                onChange(id);
                setOpen(false);
              }}
            />
          )}
        </PopoverContent>
      </Popover>
      <Button
        variant="secondary"
        size="icon-sm"
        className="text-fg-muted"
        aria-label={editor.t('sound.preview')}
        title={editor.previewSound ? editor.t('sound.preview') : editor.t('sound.previewLater')}
        disabled={!editor.previewSound || value === null}
        onClick={() => value && editor.previewSound?.(value)}
        data-testid={testId ? `${testId}-preview` : undefined}
      >
        <Play size={ICON.sm} weight="fill" />
      </Button>
    </div>
  );
}
