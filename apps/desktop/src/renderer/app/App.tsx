import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ExportDialog } from '../features/export/ExportDialog';
import { resolveLanguage } from '../i18n';
import { useUiStore } from '../stores/uiStore';
import { TopBar } from './TopBar';
import { useThemeSync } from './useThemeSync';
import { Workspace } from './Workspace';

export function App() {
  const settings = useUiStore((s) => s.settings);
  const { i18n, t } = useTranslation();
  useThemeSync(settings);
  const [exporting, setExporting] = useState(false);

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
    </div>
  );
}
