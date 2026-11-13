import { Button } from '@allay/ui/components/button';
import { ArrowDown, ArrowUp, Trash2, TriangleAlert } from 'lucide-react';
import type { TFunction } from 'i18next';
import { useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import type { LayerInfo, ResourceState } from '../../../shared/resources';
import { useResourceStore } from '../../stores/resourceStore';
import { addPack } from './actions';
import { VanillaSourceActions } from './VanillaSourceActions';

// 资源栈弹层的内容（6.4）：自上而下列出各层（与解析顺序一致），每行图标、名称、描述、类型徽标、开关、删除。
// 排序用上移、下移按钮（键盘可用；拖拽排序在 M4 换成 dnd-kit，见 decisions.md M2b）。
// v1 的内置层是空的，不列出。

export function layerDisplayName(t: TFunction, layer: LayerInfo): string {
  return layer.kind === 'vanilla' ? t('resources.vanillaName', { version: layer.name }) : layer.name;
}

function useIconUrl(icon: Uint8Array | undefined): string | null {
  const url = useMemo(() => (icon ? URL.createObjectURL(new Blob([icon as Uint8Array<ArrayBuffer>], { type: 'image/png' })) : null), [icon]);
  useEffect(() => () => {
    if (url) URL.revokeObjectURL(url);
  }, [url]);
  return url;
}

function LayerRow({ layer, index, packs, state }: { layer: LayerInfo; index: number; packs: LayerInfo[]; state: ResourceState }) {
  const { t } = useTranslation();
  const icon = useIconUrl(layer.icon);
  const name = layerDisplayName(t, layer);
  const isPack = layer.kind === 'pack';
  // packs 是从上到下的顺序；reorder 要从下往上的 id
  const move = (delta: number) => {
    const order = packs.map((p) => p.id);
    const to = index + delta;
    if (to < 0 || to >= order.length) return;
    [order[index], order[to]] = [order[to]!, order[index]!];
    void window.allay.resources.reorder(order.reverse()).then((s) => useResourceStore.getState().replace(s));
  };
  const sub =
    layer.kind === 'vanilla'
      ? t(layer.source === 'downloaded' ? 'resources.vanillaDownloaded' : 'resources.vanillaLocal')
      : (layer.description ?? (layer.source === 'folder' ? t('resources.folder') : ''));
  return (
    <li data-testid="layer-row" data-layer-id={layer.id} data-enabled={layer.enabled} className="flex items-start gap-2 rounded-md px-2 py-1.5 hover:bg-surface-3">
      <div className="mt-0.5 size-8 shrink-0 overflow-hidden rounded-sm bg-skeleton">
        {icon && <img src={icon} alt="" className="size-8" style={{ imageRendering: 'pixelated' }} />}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className="truncate text-sm font-medium" title={name}>
            {name}
          </span>
          <span className="shrink-0 rounded-sm border px-1 text-[10px] leading-4 text-fg-muted">{t(`resources.kinds.${layer.kind}`)}</span>
        </div>
        {sub && <p className="truncate text-xs text-fg-muted" title={sub}>{sub}</p>}
        {layer.legacyFormat && (
          <p className="flex items-center gap-1 text-xs text-warning">
            <TriangleAlert className="size-3" />
            {t('resources.legacy')}
          </p>
        )}
        {layer.warnings.length > 0 && <p className="text-xs text-fg-muted">{t('resources.skipped', { count: layer.warnings.length })}</p>}
      </div>
      <div className="flex shrink-0 items-center gap-0.5">
        {isPack && (
          <>
            <Button variant="ghost" size="icon-xs" aria-label={t('resources.moveUp', { name })} data-testid="layer-up" disabled={index === 0} onClick={() => move(-1)}>
              <ArrowUp />
            </Button>
            <Button variant="ghost" size="icon-xs" aria-label={t('resources.moveDown', { name })} data-testid="layer-down" disabled={index === packs.length - 1} onClick={() => move(1)}>
              <ArrowDown />
            </Button>
          </>
        )}
        <input
          type="checkbox"
          className="mx-1 size-4 accent-(--primary)"
          aria-label={t('resources.toggle', { name })}
          data-testid="layer-toggle"
          checked={layer.enabled}
          disabled={state.download.status === 'running' && layer.kind === 'vanilla'}
          onChange={(e) => void window.allay.resources.setEnabled(layer.id, e.target.checked).then((s) => useResourceStore.getState().replace(s))}
        />
        <Button
          variant="ghost"
          size="icon-xs"
          aria-label={t('resources.remove', { name })}
          data-testid="layer-remove"
          onClick={() => void window.allay.resources.removeLayer(layer.id).then((s) => useResourceStore.getState().replace(s))}
        >
          <Trash2 />
        </Button>
      </div>
    </li>
  );
}

export function ResourceStackPanel() {
  const { t } = useTranslation();
  const state = useResourceStore((s) => s.state);
  if (!state) return null;
  // 从上到下显示
  const top = [...state.layers].reverse().filter((l) => !(l.kind === 'builtin' && l.empty));
  const packs = top.filter((l) => l.kind === 'pack');
  const hasVanilla = state.layers.some((l) => l.kind === 'vanilla');
  return (
    <div className="flex flex-col gap-3" data-testid="resource-stack">
      <p className="text-xs text-fg-muted">{t('resources.subtitle')}</p>
      <ul className="flex flex-col gap-0.5">
        {top.map((layer) => (
          <LayerRow key={layer.id} layer={layer} index={packs.indexOf(layer)} packs={packs} state={state} />
        ))}
        {state.brokenPacks.map((b) => (
          <li key={b.id} data-testid="layer-broken" data-layer-id={b.id} className="flex items-start gap-2 rounded-md px-2 py-1.5">
            <TriangleAlert className="mt-0.5 size-4 shrink-0 text-warning" />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm">{b.name}</p>
              <p className="text-xs text-fg-muted">{t(`resources.broken.${b.problem}`)}</p>
            </div>
            <Button
              variant="ghost"
              size="icon-xs"
              aria-label={t('resources.remove', { name: b.name })}
              onClick={() => void window.allay.resources.removeLayer(b.id).then((s) => useResourceStore.getState().replace(s))}
            >
              <Trash2 />
            </Button>
          </li>
        ))}
      </ul>
      {state.vanilla.problem && (
        <p role="status" className="flex items-start gap-1 text-xs text-warning">
          <TriangleAlert className="mt-0.5 size-3 shrink-0" />
          {t('resources.vanillaProblem')}
        </p>
      )}
      {!hasVanilla && (
        <section className="flex flex-col gap-2 border-t pt-3" data-testid="vanilla-missing">
          <p className="text-sm font-medium">{t('resources.noVanilla')}</p>
          <VanillaSourceActions />
        </section>
      )}
      <section className="flex flex-col gap-1.5 border-t pt-3">
        <div className="flex gap-2">
          <Button variant="secondary" data-testid="pack-add" onClick={() => void addPack(t, 'zip')}>
            {t('resources.addPack')}
          </Button>
          <Button variant="ghost" data-testid="pack-add-folder" onClick={() => void addPack(t, 'folder')}>
            {t('resources.addFolder')}
          </Button>
        </div>
        <p className="text-xs text-fg-muted">{t('resources.dropHint')}</p>
      </section>
    </div>
  );
}
