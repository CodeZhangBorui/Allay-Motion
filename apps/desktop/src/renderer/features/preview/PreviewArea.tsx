import { useTranslation } from 'react-i18next';

// 中间：预览视口（6.4）。四周是中性灰 --viewport；画布按输出比例居中，四周留 24 px。M1 接入引擎画布。
export function PreviewArea() {
  const { t } = useTranslation();
  return (
    <section aria-label={t('preview.region')} className="flex min-h-0 flex-1 items-center justify-center bg-viewport p-6">
      <div className="flex aspect-video max-h-full w-full max-w-full items-center justify-center rounded-sm border border-dashed border-border-strong text-xs text-fg-subtle">
        {t('preview.placeholder')}
      </div>
    </section>
  );
}
