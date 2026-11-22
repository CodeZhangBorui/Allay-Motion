import { Button } from '@allay/ui/components/button';
import { ResourceStackList, type StackRow } from '@allay/ui/editor';
import { ICON } from '@allay/ui/lib/icons';
import { FolderPlus, GameController, ListMagnifyingGlass, Package, Trash, Warning } from '@phosphor-icons/react';
import type { TFunction } from 'i18next';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { LayerInfo } from '../../../shared/resources';
import { useResourceStore } from '../../stores/resourceStore';
import { addPack } from './actions';
import { compatText } from './compat';
import { LocalPacksDialog } from './LocalPacksDialog';
import { VanillaSourceActions } from './VanillaSourceActions';
import { VersionPickerDialog } from './VersionPickerDialog';

// 资源栈弹层的内容（6.4）：自上而下列出各层（与解析顺序一致），每行拖动手柄、图标、名称、描述、类型徽标、开关、删除。
// 资源包之间、原版层之间都能拖（dnd-kit，键盘可用）；原版层整体在资源包之下（decisions.md M2b）。
// 可以有多个原版来源（2026-11 反馈）：最上面启用的那个标“基底”，资源包按它的格式号匹配。
// v1 的内置层是空的，导入的音效只在音效选择器里出现，这两层都不列出。

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
  const top = useMemo(() => (state ? [...state.layers].reverse().filter((l) => !(l.kind === 'builtin' && l.empty) && l.source !== 'imported') : []), [state]);
  const icons = useIconUrls(top);
  const [versionsOpen, setVersionsOpen] = useState(false);
  const [localOpen, setLocalOpen] = useState(false);
  if (!state) return null;
  const hasVanilla = state.layers.some((l) => l.kind === 'vanilla');
  const baseVersion = state.vanilla.baseVersion;
  const replace = (p: Promise<typeof state>) => void p.then((s) => useResourceStore.getState().replace(s));
  const rows: StackRow[] = top.map((layer) => {
    let sub: string;
    let warning: string | undefined = layer.legacyFormat ? t('resources.legacy') : layer.warnings.length > 0 ? t('resources.skipped', { count: layer.warnings.length }) : undefined;
    if (layer.kind === 'vanilla') {
      const where = layer.source === 'downloaded' ? t('resources.vanillaDownloaded') : layer.gameDir ? t('resources.vanillaLocalAt', { dir: layer.gameDir }) : t('resources.vanillaLocal');
      // 层名是真实的游戏版本；模组版本、整合包的目录名和它不同，写在描述里
      const folder = layer.source === 'local' && layer.versionId && layer.versionId !== layer.name ? t('resources.vanillaDir', { dir: layer.versionId }) : null;
      sub = [folder, where, layer.resourceFormat ? t('resources.format', { format: layer.resourceFormat }) : null].filter(Boolean).join(' · ');
      if (!warning && layer.hasAssetIndex === false) warning = t('resources.noAssetIndex');
    } else {
      const compat = compatText(t, layer, baseVersion);
      sub = layer.description ?? (layer.source === 'folder' || layer.source === 'linked' ? (layer.path ?? t('resources.folder')) : '');
      if (!warning && compat?.warn) warning = compat.text;
      else if (compat && !sub) sub = compat.text;
    }
    return {
      id: layer.id,
      name: layerDisplayName(t, layer),
      description: sub,
      kindLabel: layer.base ? t('resources.base') : t(`resources.kinds.${layer.kind}`),
      iconUrl: icons.get(layer.id) ?? null,
      enabled: layer.enabled,
      sortable: layer.kind === 'pack' || layer.kind === 'vanilla',
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
        // 列表给的是从上到下的顺序；主进程要从下往上（资源包、原版层各排各的）
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
              <Warning size={ICON.md} className="shrink-0 text-warning" aria-hidden="true" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm">{b.name}</p>
                <p className="text-xs text-warning">{t(`resources.broken.${b.problem}`)}</p>
              </div>
              <Button variant="ghost" size="icon-sm" aria-label={t('resources.remove', { name: b.name })} onClick={() => replace(window.allay.resources.removeLayer(b.id))}>
                <Trash size={ICON.md} />
              </Button>
            </li>
          ))}
        </ul>
      )}
      {state.vanilla.missingSources.length > 0 && (
        <ul className="flex flex-col gap-0.5">
          {state.vanilla.missingSources.map((m) => (
            <li key={m.id} data-testid="vanilla-missing-source" data-layer-id={m.id} className="flex items-center gap-2 py-1.5 pr-1 pl-6">
              <Warning size={ICON.md} className="shrink-0 text-warning" aria-hidden="true" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm" title={m.versionId}>
                  {t('resources.vanillaName', { version: m.versionId })}
                </p>
                {m.problem === 'missing' ? (
                  <p className="truncate text-xs text-warning" title={m.gameDir}>
                    {t(m.kind === 'local' ? 'resources.missingLocal' : 'resources.missingDownloaded', { dir: m.gameDir ?? '' })}
                  </p>
                ) : (
                  <p className="text-xs leading-relaxed text-warning" title={m.gameDir} data-problem={m.problem}>
                    {t(m.problem === 'not-client' ? 'resources.sourceNotClient' : 'resources.sourceUnreadable')}
                  </p>
                )}
              </div>
              <Button variant="ghost" size="icon-sm" aria-label={t('resources.remove', { name: m.versionId })} onClick={() => replace(window.allay.resources.removeLayer(m.id))}>
                <Trash size={ICON.md} />
              </Button>
            </li>
          ))}
        </ul>
      )}
      {hasVanilla && <p className="text-xs leading-relaxed text-fg-muted">{t('resources.baseHint')}</p>}
      {state.vanilla.problem && (
        <p role="status" className="flex items-start gap-1 text-xs text-warning">
          <Warning size={ICON.sm} className="mt-0.5 shrink-0" aria-hidden="true" />
          {t(
            state.vanilla.problem === 'not-client'
              ? 'resources.vanillaProblemNotClient'
              : state.vanilla.problem === 'jar-unreadable'
                ? 'resources.vanillaProblemUnreadable'
                : 'resources.vanillaProblem',
          )}
        </p>
      )}
      {!hasVanilla && (
        <section className="flex flex-col gap-2 border-t border-divider pt-3" data-testid="vanilla-missing">
          <p className="font-medium">{t('resources.noVanilla')}</p>
          <VanillaSourceActions />
        </section>
      )}
      <section className="flex flex-col gap-2 border-t border-divider pt-3">
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" data-testid="pack-add" onClick={() => void addPack(t, 'zip')}>
            <Package size={ICON.md} />
            {t('resources.addPack')}
          </Button>
          <Button variant="ghost" data-testid="pack-add-folder" onClick={() => void addPack(t, 'folder')}>
            <FolderPlus size={ICON.md} />
            {t('resources.addFolder')}
          </Button>
          <Button variant="ghost" data-testid="pack-add-local" onClick={() => setLocalOpen(true)}>
            <GameController size={ICON.md} />
            {t('resources.localPacks.button')}
          </Button>
          <Button variant="ghost" data-testid="vanilla-add-version" onClick={() => setVersionsOpen(true)}>
            <ListMagnifyingGlass size={ICON.md} />
            {t('resources.versions.button')}
          </Button>
        </div>
        <p className="text-xs text-fg-muted">{t('resources.dropHint')}</p>
      </section>
      <VersionPickerDialog open={versionsOpen} onOpenChange={setVersionsOpen} />
      <LocalPacksDialog open={localOpen} onOpenChange={setLocalOpen} />
    </div>
  );
}
