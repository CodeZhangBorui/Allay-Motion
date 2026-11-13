import { BrandMark } from '@allay/ui/brand';
import { Button } from '@allay/ui/components/button';
import { ChevronDown, Redo2, Undo2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { ResourceButton } from '../features/resources/ResourceButton';
import { usePreviewStore } from '../stores/previewStore';

// 顶栏（6.4）：40 px；空白处是窗口拖动区，可交互元素标 no-drag；右侧给系统窗口按钮留位置。
// M0 只有外形；M1 接上“导出”，M2 接上素材按钮（资源栈弹层），其余按钮在后续里程碑接上功能。

export function TopBar({ onExport }: { onExport(): void }) {
  const { t } = useTranslation();
  const ready = usePreviewStore((s) => s.status.kind === 'ready');
  return (
    <header
      data-testid="topbar"
      className="app-drag flex h-10 shrink-0 items-center gap-2 border-b bg-surface-1 pl-3"
      style={{
        // 系统窗口按钮（title bar overlay）占用的宽度
        paddingRight: 'calc(100vw - env(titlebar-area-x, 0px) - env(titlebar-area-width, 100vw) + 8px)',
      }}
    >
      <div className="flex items-center gap-2">
        <BrandMark size={20} />
        <span className="text-sm font-semibold tracking-tight">{t('brand.wordmark')}</span>
      </div>
      <div className="mx-1 h-5 w-px bg-border" />
      <Button variant="ghost" className="app-no-drag text-fg-muted" disabled>
        {t('topbar.project')}
        <ChevronDown className="size-3.5" />
      </Button>

      <div data-testid="drag-region" className="h-full flex-1" />

      <ResourceButton />
      <div className="mx-1 h-5 w-px bg-border" />
      <Button variant="ghost" size="icon" className="app-no-drag" aria-label={t('topbar.undo')} disabled>
        <Undo2 />
      </Button>
      <Button variant="ghost" size="icon" className="app-no-drag" aria-label={t('topbar.redo')} disabled>
        <Redo2 />
      </Button>
      <Button className="app-no-drag ml-1 px-3" data-testid="topbar-export" disabled={!ready} onClick={onExport}>
        {t('topbar.export')}
      </Button>
    </header>
  );
}
