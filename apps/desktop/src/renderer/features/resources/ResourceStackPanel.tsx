import { Button } from '@allay/ui/components/button';
import { ResourceStackList, type StackRow } from '@allay/ui/editor';
import { FolderPlus, PackagePlus, Trash2, TriangleAlert } from 'lucide-react';
import type { TFunction } from 'i18next';
import { useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import type { LayerInfo } from '../../../shared/resources';
import { useResourceStore } from '../../stores/resourceStore';
import { addPack } from './actions';
import { VanillaSourceActions } from './VanillaSourceActions';

// 资源栈弹层的内容（6.4）：自上而下列出各层（与解析顺序一致），每行拖动手柄、图标、名称、描述、类型徽标、开关、删除。
// 只有资源包能拖（dnd-kit，键盘可用）；原版层固定在资源包之下（decisions.md M2b）。v1 的内置层是空的，不列出。

export function layerDisplayName(t: TFunction, layer: LayerInfo): string {
  return layer.kind === 'vanilla' ? t('resources.vanillaName', { version: layer.name }) : layer.name;
}

/** 包图标的 blob: URL，随层的图标数据变 */
function useIconUrls(layers: readonly LayerInfo[]): Map<string, string> {
  const urls = useMemo(() => {
    const m = new Map<string, string>();
    for (const l of layers) if (l.icon) m.set(l.id, URL.createObjectURL(new Blob([l.icon as Uint8Array<ArrayBuffer>], { type: 'image/png' })));
    return m;
  }, [layers]);
  useEffect(() => () => urls.forEach((u) => URL.revokeObjectURL(u)), [urls]);
  return urls;
}

export function ResourceStackPanel() {
  const { t } = useTranslation();
  const state = useResourceStore((s) => s.state);
  const top = useMemo(() => (state ? [...state.layers].reverse().filter((l) => !(l.kind === 'builtin' && l.empty)) : []), [state]);
  const icons = useIconUrls(top);
  if (!state) return null;
  const hasVanilla = state.layers.some((l) => l.kind === 'vanilla');
  const replace = (p: Promise<typeof state>) => void p.then((s) => useResourceStore.getState().replace(s));
  const rows: StackRow[] = top.map((layer) => {
    const sub =
      layer.kind === 'vanilla'
        ? t(layer.source === 'downloaded' ? 'resources.vanillaDownloaded' : 'resources.vanillaLocal')
        : (layer.description ?? (layer.source === 'folder' ? t('resources.folder') : ''));
    const warning = layer.legacyFormat ? t('resources.legacy') : layer.warnings.length > 0 ? t('resources.skipped', { count: layer.warnings.length }) : undefined;
    return {
      id: layer.id,
      name: layerDisplayName(t, layer),
      description: sub,
      kindLabel: t(`resources.kinds.${layer.kind}`),
      iconUrl: icons.get(layer.id) ?? null,
      enabled: layer.enabled,
      sortable: layer.kind === 'pack',
      locked: layer.kind === 'builtin',
      toggleDisabled: state.download.status === 'running' && layer.kind === 'vanilla',
      ...(warning ? { warning } : {}),
    };
  });
  return (
    <div className="flex flex-col gap-3" data-testid="resource-stack">
      <p className="text-xs text-fg-muted">{t('resources.subtitle')}</p>
      <ResourceStackList
        rows={rows}
        // 列表给的是资源包从上到下的顺序；主进程要从下往上
        onReorder={(ids) => replace(window.allay.resources.reorder([...ids].reverse()))}
        onToggle={(id, enabled) => replace(window.allay.resources.setEnabled(id, enabled))}
        onRemove={(id) => replace(window.allay.resources.removeLayer(id))}
        labels={{
          drag: (name) => t('resources.drag', { name }),
          toggle: (name) => t('resources.toggle', { name }),
          remove: (name) => t('resources.remove', { name }),
        }}
      />
      {state.brokenPacks.length > 0 && (
        <ul className="flex flex-col gap-0.5">
          {state.brokenPacks.map((b) => (
            <li key={b.id} data-testid="layer-broken" data-layer-id={b.id} className="flex items-center gap-2 py-1.5 pr-1 pl-6">
              <TriangleAlert className="size-4 shrink-0 text-warning" aria-hidden="true" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm">{b.name}</p>
                <p className="text-xs text-warning">{t(`resources.broken.${b.problem}`)}</p>
              </div>
              <Button variant="ghost" size="icon-sm" aria-label={t('resources.remove', { name: b.name })} onClick={() => replace(window.allay.resources.removeLayer(b.id))}>
                <Trash2 />
              </Button>
            </li>
          ))}
        </ul>
      )}
      {state.vanilla.problem && (
        <p role="status" className="flex items-start gap-1 text-xs text-warning">
          <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          {t('resources.vanillaProblem')}
        </p>
      )}
      {!hasVanilla && (
        <section className="flex flex-col gap-2 border-t-2 pt-3" data-testid="vanilla-missing">
          <p className="font-px12">{t('resources.noVanilla')}</p>
          <VanillaSourceActions />
        </section>
      )}
      <section className="flex flex-col gap-2 border-t-2 pt-3">
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" data-testid="pack-add" onClick={() => void addPack(t, 'zip')}>
            <PackagePlus />
            {t('resources.addPack')}
          </Button>
          <Button variant="ghost" data-testid="pack-add-folder" onClick={() => void addPack(t, 'folder')}>
            <FolderPlus />
            {t('resources.addFolder')}
          </Button>
        </div>
        <p className="text-xs text-fg-muted">{t('resources.dropHint')}</p>
      </section>
    </div>
  );
}
