// “图层”标签页（docs/animation-editor.md 5.1）：动画里的对象，最上面的画在最前面。
// 选中一个图层，右栏的“动画”页显示它的内容和属性，时间轴高亮它那一行。
// 加图层、删、上移下移都经类型化命令或 editDoc，一次操作一步撤销。
import { Button } from '@allay/ui/components/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuItemIcon, DropdownMenuTrigger } from '@allay/ui/components/dropdown-menu';
import { ScrollArea } from '@allay/ui/components/misc';
import { ICON } from '@allay/ui/lib/icons';
import { cn } from '@allay/ui/lib/utils';
import { ArrowDown, ArrowUp, Cube, Plus, Square, Sword, TextT, Trash, type Icon } from '@phosphor-icons/react';
import { useTranslation } from 'react-i18next';
import { LAYER_TYPES, type Layer, type LayerType } from '../../../shared/animation/schema';
import { trigger } from '../../app/registry';
import { useProjectStore } from '../../stores/projectStore';
import { editDoc } from './source';
import { useAnimationUi } from './uiState';

export const LAYER_ICONS: Record<LayerType, Icon> = { block: Cube, item: Sword, text: TextT, rect: Square };

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

function move(id: string, delta: number): void {
  editDoc((doc) => {
    const i = doc.layers.findIndex((l) => l.id === id);
    const j = i + delta;
    if (i < 0 || j < 0 || j >= doc.layers.length) return;
    const [l] = doc.layers.splice(i, 1);
    doc.layers.splice(j, 0, l!);
  });
}

function Row({ layer, index, count }: { layer: Layer; index: number; count: number }) {
  const { t } = useTranslation();
  const selected = useAnimationUi((s) => s.layer === layer.id);
  const LayerIcon = LAYER_ICONS[layer.type];
  return (
    <li
      className={cn('group flex h-8 cursor-default items-center gap-2 rounded-md pr-1 pl-2 text-sm', selected ? 'bg-control-hi text-foreground' : 'text-fg-muted hover:bg-control hover:text-foreground')}
      onClick={() => useAnimationUi.getState().select({ layer: layer.id, key: null })}
      data-testid="anim-layer"
      data-layer={layer.id}
      data-selected={selected}
      aria-selected={selected}
      role="option"
    >
      <LayerIcon size={ICON.sm} weight={selected ? 'fill' : 'regular'} className="shrink-0" />
      <span className="min-w-0 flex-1 truncate">{layer.name}</span>
      <span className="hidden shrink-0 items-center group-hover:flex">
        {/* 列表最上面是最后一个图层（画在最前面）：“上移”是往数组后面挪 */}
        <Button variant="ghost" size="icon-xs" aria-label={t('anim.layers.up')} disabled={index === count - 1} onClick={(e) => (e.stopPropagation(), move(layer.id, 1))}>
          <ArrowUp size={ICON.xs} />
        </Button>
        <Button variant="ghost" size="icon-xs" aria-label={t('anim.layers.down')} disabled={index === 0} onClick={(e) => (e.stopPropagation(), move(layer.id, -1))}>
          <ArrowDown size={ICON.xs} />
        </Button>
        <Button
          variant="ghost"
          size="icon-xs"
          aria-label={t('anim.layers.remove')}
          data-testid="anim-remove-layer"
          onClick={(e) => {
            e.stopPropagation();
            trigger('animRemoveLayer', { layer: layer.id });
          }}
        >
          <Trash size={ICON.xs} />
        </Button>
      </span>
    </li>
  );
}

export function LayersPanel() {
  const { t } = useTranslation();
  const doc = useDoc();
  if (!doc) return null;
  const rows = doc.layers.map((l, i) => ({ l, i })).reverse();
  return (
    <ScrollArea className="min-h-0 flex-1" data-testid="anim-layers">
      {rows.length === 0 ? (
        <p className="px-3.5 py-2 text-xs leading-snug text-fg-subtle">{t('anim.layers.empty')}</p>
      ) : (
        <ul className="flex flex-col gap-0.5 px-1.5 pb-2" role="listbox" aria-label={t('anim.layers.title')}>
          {rows.map(({ l, i }) => (
            <Row key={l.id} layer={l} index={i} count={doc.layers.length} />
          ))}
        </ul>
      )}
    </ScrollArea>
  );
}
