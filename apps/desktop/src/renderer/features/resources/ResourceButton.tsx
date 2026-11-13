import { Button } from '@allay/ui/components/button';
import { ChevronDown, Layers } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useResourceStore } from '../../stores/resourceStore';
import { layerDisplayName, ResourceStackPanel } from './ResourceStackPanel';

// 顶栏的素材按钮（6.4）：显示最上层启用的那一层，点开是资源栈弹层。
// 弹层自己写（Escape、点外面关闭）；完整的 shadcn Popover 在 M4。

export function ResourceButton() {
  const { t } = useTranslation();
  const state = useResourceStore((s) => s.state);
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    const onPointer = (e: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('pointerdown', onPointer);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('pointerdown', onPointer);
    };
  }, [open]);

  const top = state ? [...state.layers].reverse().find((l) => l.enabled && !(l.kind === 'builtin' && l.empty)) : undefined;
  const label = top ? t('resources.button', { name: layerDisplayName(t, top) }) : t('resources.buttonNone');

  return (
    <div ref={rootRef} className="app-no-drag relative">
      <Button
        variant="ghost"
        className="max-w-64 text-fg-muted"
        data-testid="resources-button"
        aria-label={t('resources.buttonLabel')}
        aria-expanded={open}
        aria-haspopup="dialog"
        onClick={() => setOpen((v) => !v)}
      >
        <Layers />
        <span className="truncate">{label}</span>
        <ChevronDown className="size-3.5" />
      </Button>
      {open && (
        <div
          role="dialog"
          aria-label={t('resources.title')}
          data-testid="resources-popover"
          className="absolute top-full right-0 z-40 mt-1 max-h-[70vh] w-[380px] overflow-y-auto rounded-lg border bg-surface-2 p-3 shadow-[var(--shadow-popover)]"
        >
          <h2 className="mb-1 text-sm font-semibold">{t('resources.title')}</h2>
          <ResourceStackPanel />
        </div>
      )}
    </div>
  );
}
