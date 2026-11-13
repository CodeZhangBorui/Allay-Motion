import { useTranslation } from 'react-i18next';

// 右栏：属性（6.4）。由参数定义生成的属性面板在 M4。
export function ParamsPanel() {
  const { t } = useTranslation();
  return (
    <aside aria-label={t('params.title')} className="flex h-full min-w-0 flex-col bg-surface-1">
      <div className="flex h-10 items-center border-b px-3 text-base font-medium">{t('params.title')}</div>
      <p className="p-3 text-xs text-fg-muted">{t('params.placeholder')}</p>
    </aside>
  );
}
