import { Button } from '@allay/ui/components/button';
import { Popover, PopoverContent, PopoverTitle, PopoverTrigger } from '@allay/ui/components/popover';
import { ChevronDown, Layers } from 'lucide-react';
import { useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useResourceStore } from '../../stores/resourceStore';
import { useUiStore } from '../../stores/uiStore';
import { layerDisplayName, ResourceStackPanel } from './ResourceStackPanel';

// 顶栏的素材按钮（6.4）：显示最上层启用的那一层（图标和名称），点开是资源栈弹层（shadcn Popover）。

export function ResourceButton() {
  const { t } = useTranslation();
  const state = useResourceStore((s) => s.state);
  const open = useUiStore((s) => s.resourcesOpen);
  const top = state ? [...state.layers].reverse().find((l) => l.enabled && !(l.kind === 'builtin' && l.empty)) : undefined;
  const label = top ? t('resources.button', { name: layerDisplayName(t, top) }) : t('resources.buttonNone');
  const icon = useMemo(() => (top?.icon ? URL.createObjectURL(new Blob([top.icon as Uint8Array<ArrayBuffer>], { type: 'image/png' })) : null), [top?.icon]);
  useEffect(() => () => {
    if (icon) URL.revokeObjectURL(icon);
  }, [icon]);

  return (
    <Popover open={open} onOpenChange={(o) => useUiStore.getState().setResourcesOpen(o)}>
      <PopoverTrigger
        render={<Button variant="ghost" className="app-no-drag max-w-64 text-fg-muted" data-testid="resources-button" aria-label={`${t('resources.buttonLabel')}: ${label}`} />}
      >
        {icon ? <img src={icon} alt="" className="pixelated size-4" /> : <Layers />}
        <span className="truncate">{label}</span>
        <ChevronDown className="size-4" />
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[400px] max-h-[min(70vh,600px)]" data-testid="resources-popover" aria-label={t('resources.title')}>
        <PopoverTitle className="mb-2 font-px24">{t('resources.title')}</PopoverTitle>
        <ResourceStackPanel />
      </PopoverContent>
    </Popover>
  );
}
