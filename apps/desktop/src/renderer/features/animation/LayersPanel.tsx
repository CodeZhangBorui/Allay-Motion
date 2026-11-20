// “图层”标签页（docs/animation-editor.md 6.2、4.3）：动画里的对象，最上面的画在最前面，子图层缩进排在父级下面。
// - 点选；Ctrl 点击加选或取消；Shift 点击连选。双击名字重命名（Enter 确定、Esc 取消）。
// - 每行右边的开关：隐藏（眼睛）、独显（耳机）、锁定（锁）；开着的一直显示，关着的悬停时显示。
// - 拖动排序：拖到两行之间是挪位置，拖到组那一行的中间是放进组里（成为它的子图层）。锁定的图层不能拖。
// - 标题行右侧的 + 加图层；底部一行是成组、解组、复制、删除（与快捷键 Ctrl+G、Ctrl+Shift+G、Ctrl+D、Delete 同一组命令）。
import { Button } from '@allay/ui/components/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuItemIcon, DropdownMenuTrigger } from '@allay/ui/components/dropdown-menu';
import { ScrollArea } from '@allay/ui/components/misc';
import { ICON } from '@allay/ui/lib/icons';
import { cn } from '@allay/ui/lib/utils';
import { Circle, Copy, Cube, Image, LineSegment, Eye, EyeSlash, FolderSimple, FolderSimpleMinus, FolderSimplePlus, Headphones, Lock, LockOpen, Plus, Square, Sword, TextT, Trash, type Icon } from '@phosphor-icons/react';
import { useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { layerTree, type TreeEntry } from '../../../shared/animation/layers';
import { LAYER_TYPES, type LayerType } from '../../../shared/animation/schema';
import { commandEnabled, trigger, useRegistry } from '../../app/registry';
import { useProjectStore } from '../../stores/projectStore';
import { trackPointer } from './pointer';
import { useAnimationUi } from './uiState';

export const LAYER_ICONS: Record<LayerType, Icon> = { block: Cube, item: Sword, text: TextT, rect: Square, ellipse: Circle, line: LineSegment, image: Image, group: FolderSimple };

const ROW_H = 32;
const INDENT = 14;

function useDoc() {
  return useProjectStore((s) => s.template?.animation?.doc ?? null);
}

export function LayersActions() {
  const { t } = useTranslation();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger render={<Button variant="ghost" size="icon-sm" className="text-fg-subtle" aria-label={t('anim.layers.add')} title={t('anim.layers.add')} data-testid="anim-add-layer" />}>
        <Plus size={ICON.md - 1} />
      </DropdownMenuTrigger>
      <DropdownMenuContent className="w-44">
        {LAYER_TYPES.map((type) => (
          <DropdownMenuItem key={type} onClick={() => trigger('animAddLayer', { type })} data-testid={`anim-add-${type}`}>
            <DropdownMenuItemIcon icon={LAYER_ICONS[type]} />
            {t(`anim.layerTypes.${type}`)}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** 行右边的一个开关：开着的一直显示，关着的悬停时显示 */
function Flag({ on, label, onToggle, icon: On, off: Off, testId }: { on: boolean; label: string; onToggle(): void; icon: Icon; off?: Icon; testId: string }) {
  const Shown = on ? On : (Off ?? On);
  return (
    <Button
      variant="ghost"
      size="icon-xs"
      aria-label={label}
      aria-pressed={on}
      title={label}
      data-testid={testId}
      className={cn('shrink-0', on ? 'text-primary-text' : 'text-fg-subtle opacity-0 group-hover:opacity-100 focus-visible:opacity-100')}
      onClick={(e) => {
        e.stopPropagation();
        onToggle();
      }}
      onPointerDown={(e) => e.stopPropagation()}
    >
      <Shown size={ICON.xs} weight={on ? 'fill' : 'regular'} />
    </Button>
  );
}

interface DropTarget {
  /** 落到 doc.layers 的第几位（排序）；into 时是放进这个组 */
  index: number;
  into: string | null;
  /** 指示线 / 高亮画在显示顺序的第几行 */
  row: number;
  edge: 'above' | 'below' | 'into';
}

function Row({ entry, order, onDragStart, dragging }: { entry: TreeEntry; order: readonly string[]; onDragStart(e: ReactPointerEvent, entry: TreeEntry): void; dragging: boolean }) {
  const { t } = useTranslation();
  const { layer, depth } = entry;
  const selected = useAnimationUi((s) => s.layers.includes(layer.id));
  const primary = useAnimationUi((s) => s.layer === layer.id);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(layer.name);
  const LayerIcon = LAYER_ICONS[layer.type];
  const commit = () => {
    setEditing(false);
    if (draft.trim() && draft.trim() !== layer.name) trigger('animRenameLayer', { layer: layer.id, name: draft.trim() });
  };
  return (
    <li
      className={cn(
        'group flex cursor-default items-center gap-1.5 rounded-md pr-1 text-sm',
        selected ? 'bg-control-hi text-foreground' : 'text-fg-muted hover:bg-control hover:text-foreground',
        layer.hidden && 'opacity-60',
        dragging && 'opacity-40',
      )}
      style={{ height: ROW_H, paddingLeft: 8 + depth * INDENT }}
      onPointerDown={(e) => {
        if (e.button !== 0 || editing) return;
        const mode = e.ctrlKey || e.metaKey ? 'toggle' : e.shiftKey ? 'range' : 'replace';
        if (mode !== 'replace' || !selected) useAnimationUi.getState().selectLayers([layer.id], mode, order);
        else useAnimationUi.setState({ layer: layer.id });
        if (mode === 'replace' && !layer.locked) onDragStart(e, entry);
      }}
      onDoubleClick={() => {
        if (layer.locked) return;
        setDraft(layer.name);
        setEditing(true);
      }}
      data-testid="anim-layer"
      data-layer={layer.id}
      data-depth={depth}
      data-selected={selected}
      aria-selected={selected}
      aria-current={primary || undefined}
      role="option"
    >
      <LayerIcon size={ICON.sm} weight={selected ? 'fill' : 'regular'} className="shrink-0" />
      {editing ? (
        <input
          autoFocus
          aria-label={t('anim.layers.rename')}
          data-testid="anim-layer-rename"
          className="h-6 min-w-0 flex-1 rounded-sm bg-well px-1.5 text-sm text-foreground outline-none focus-visible:ring-1 focus-visible:ring-ring"
          value={draft}
          maxLength={60}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onPointerDown={(e) => e.stopPropagation()}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commit();
            if (e.key === 'Escape') setEditing(false);
            e.stopPropagation();
          }}
        />
      ) : (
        <span className="min-w-0 flex-1 truncate">{layer.name}</span>
      )}
      <Flag on={!!layer.hidden} label={t(layer.hidden ? 'anim.layers.show' : 'anim.layers.hide')} icon={EyeSlash} off={Eye} testId="anim-layer-hide" onToggle={() => trigger('animSetLayerFlags', { layer: layer.id, hidden: !layer.hidden })} />
      <Flag on={!!layer.solo} label={t('anim.layers.solo')} icon={Headphones} testId="anim-layer-solo" onToggle={() => trigger('animSetLayerFlags', { layer: layer.id, solo: !layer.solo })} />
      <Flag on={!!layer.locked} label={t(layer.locked ? 'anim.layers.unlock' : 'anim.layers.lock')} icon={Lock} off={LockOpen} testId="anim-layer-lock" onToggle={() => trigger('animSetLayerFlags', { layer: layer.id, locked: !layer.locked })} />
    </li>
  );
}

function Footer() {
  const { t } = useTranslation();
  const count = useAnimationUi((s) => s.layers.length);
  const commands = useRegistry((s) => s.commands);
  useProjectStore((s) => s.template);
  const btn = (id: string, icon: Icon, label: string, testId: string) => {
    const cmd = commands[id];
    const I = icon;
    return (
      <Button variant="ghost" size="icon-sm" className="text-fg-subtle" aria-label={label} title={label} data-testid={testId} disabled={!cmd || !commandEnabled(cmd)} onClick={() => trigger(id)}>
        <I size={ICON.sm} />
      </Button>
    );
  };
  return (
    <div className="flex h-9 shrink-0 items-center gap-0.5 border-t border-divider px-2">
      <span className="min-w-0 flex-1 truncate pl-1 text-xs text-fg-subtle">{count > 1 ? t('anim.layers.selected', { count }) : ''}</span>
      {btn('animGroupSelection', FolderSimplePlus, t('anim.commands.groupSelection'), 'anim-layers-group')}
      {btn('animUngroupSelection', FolderSimpleMinus, t('anim.commands.ungroupSelection'), 'anim-layers-ungroup')}
      {btn('animDuplicateSelection', Copy, t('anim.commands.duplicateSelection'), 'anim-layers-duplicate')}
      {btn('animDeleteSelection', Trash, t('anim.layers.remove'), 'anim-remove-layer')}
    </div>
  );
}

export function LayersPanel() {
  const { t } = useTranslation();
  const doc = useDoc();
  const listRef = useRef<HTMLUListElement>(null);
  const [drag, setDrag] = useState<{ id: string; target: DropTarget | null } | null>(null);
  const tree = useMemo(() => (doc ? layerTree(doc) : []), [doc]);
  if (!doc) return null;
  const order = tree.map((e) => e.layer.id);

  /** 指针在列表里的位置 → 落点。显示顺序第 r 行之上是 doc.layers 里它后面一位（画在它前面），之下是它这一位 */
  const targetAt = (clientY: number, dragged: string): DropTarget | null => {
    const ul = listRef.current;
    if (!ul) return null;
    const rows = [...ul.querySelectorAll<HTMLElement>('[data-testid="anim-layer"]')];
    for (let r = 0; r < rows.length; r++) {
      const rect = rows[r]!.getBoundingClientRect();
      if (clientY > rect.bottom) continue;
      const entry = tree[r]!;
      if (entry.layer.id === dragged) return null;
      const y = (clientY - rect.top) / rect.height;
      if (entry.layer.type === 'group' && y > 0.3 && y < 0.7) return { index: entry.index, into: entry.layer.id, row: r, edge: 'into' };
      return y < 0.5 ? { index: entry.index + 1, into: null, row: r, edge: 'above' } : { index: entry.index, into: null, row: r, edge: 'below' };
    }
    return rows.length > 0 ? { index: 0, into: null, row: rows.length - 1, edge: 'below' } : null;
  };

  const startDrag = (e: ReactPointerEvent, entry: TreeEntry) => {
    const y0 = e.clientY;
    let moved = false;
    trackPointer(e, {
      move: (ev) => {
        if (!moved && Math.abs(ev.clientY - y0) < 4) return;
        moved = true;
        setDrag({ id: entry.layer.id, target: targetAt(ev.clientY, entry.layer.id) });
      },
      up: (ev) => {
        setDrag(null);
        if (!moved) return;
        const target = targetAt(ev.clientY, entry.layer.id);
        if (!target) return;
        if (target.into) {
          trigger('animSetParent', { layer: entry.layer.id, parent: target.into });
          return;
        }
        // 挪到另一处：父级换成落点那一行的父级（同一层级里排序），再挪到它的上面或下面
        const neighbour = tree[target.row]!.layer;
        if ((neighbour.parent ?? null) !== (entry.layer.parent ?? null)) trigger('animSetParent', { layer: entry.layer.id, parent: neighbour.parent ?? null });
        trigger('animMoveLayerRelative', { layer: entry.layer.id, neighbour: neighbour.id, place: target.edge === 'above' ? 'above' : 'below' });
      },
    });
  };

  const indicator = drag?.target;
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <ScrollArea className="min-h-0 flex-1" data-testid="anim-layers">
        {tree.length === 0 ? (
          <p className="px-3.5 py-2 text-xs leading-snug text-fg-subtle">{t('anim.layers.empty')}</p>
        ) : (
          <ul ref={listRef} className="relative flex flex-col gap-0.5 px-1.5 pb-2" role="listbox" aria-multiselectable aria-label={t('anim.layers.title')}>
            {tree.map((entry) => (
              <Row key={entry.layer.id} entry={entry} order={order} onDragStart={startDrag} dragging={drag?.id === entry.layer.id} />
            ))}
            {indicator && (
              <span
                aria-hidden="true"
                data-testid="anim-layer-drop"
                className={cn('pointer-events-none absolute right-1.5 left-1.5 rounded-md', indicator.edge === 'into' ? 'bg-primary-soft' : 'h-0.5 bg-primary')}
                style={
                  indicator.edge === 'into'
                    ? { top: indicator.row * (ROW_H + 2), height: ROW_H }
                    : { top: (indicator.edge === 'above' ? indicator.row : indicator.row + 1) * (ROW_H + 2) - 1 }
                }
              />
            )}
          </ul>
        )}
      </ScrollArea>
      <Footer />
    </div>
  );
}
