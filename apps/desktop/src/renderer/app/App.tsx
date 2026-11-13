import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ExportDialog } from '../features/export/ExportDialog';
import { DiscoveryDialog, useShowDiscovery } from '../features/resources/DiscoveryDialog';
import { useDropPacks } from '../features/resources/useDropPacks';
import { resolveLanguage } from '../i18n';
import { useUiStore } from '../stores/uiStore';
import { NoticeBar } from './NoticeBar';
import { TopBar } from './TopBar';
import { useThemeSync } from './useThemeSync';
import { Workspace } from './Workspace';

export function App() {
  const settings = useUiStore((s) => s.settings);
  const { i18n, t } = useTranslation();
  useThemeSync(settings);
  const [exporting, setExporting] = useState(false);
  const showDiscovery = useShowDiscovery();
  const dragging = useDropPacks();

  // 语言设置变化时切换（“跟随系统”在启动时已经解析过，这里只处理明确的选择）
  useEffect(() => {
    if (settings.language === 'system') return;
    const lng = resolveLanguage(settings.language, '');
    if (i18n.language !== lng) {
      void i18n.changeLanguage(lng).then(() => {
        document.documentElement.lang = lng;
        document.title = t('brand.name');
      });
    }
  }, [settings.language, i18n, t]);

  return (
    <div className="flex h-full flex-col">
      <TopBar onExport={() => setExporting(true)} />
      <Workspace />
      {exporting && <ExportDialog onClose={() => setExporting(false)} />}
      {showDiscovery && !exporting && <DiscoveryDialog />}
      <NoticeBar />
      {dragging && (
        <div data-testid="drop-overlay" className="pointer-events-none fixed inset-2 z-50 flex items-center justify-center rounded-lg border-2 border-dashed border-(--ring) bg-black/30 text-sm font-medium">
          {t('resources.dropOverlay')}
        </div>
      )}
    </div>
  );
}
