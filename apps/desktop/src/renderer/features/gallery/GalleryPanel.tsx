import { useTranslation } from 'react-i18next';

// 左栏：模板库（6.4）。M0 只有外形；卡片、搜索、分类在 M4。
export function GalleryPanel() {
  const { t } = useTranslation();
  const categories = ['all', 'transition', 'overlay', 'mine'] as const;
  return (
    <aside aria-label={t('gallery.title')} className="flex h-full min-w-0 flex-col bg-surface-1">
      <div className="flex flex-col gap-2 p-3">
        <div className="flex h-7 items-center rounded-md border border-input-border bg-surface-3 px-2 text-fg-subtle">
          {t('gallery.search')}
        </div>
        <div className="flex gap-1 text-xs">
          {categories.map((c, i) => (
            <span
              key={c}
              className={i === 0 ? 'rounded-md bg-surface-3 px-2 py-1 text-foreground' : 'rounded-md px-2 py-1 text-fg-muted'}
            >
              {t(`gallery.categories.${c}`)}
            </span>
          ))}
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2 px-3" aria-hidden="true">
        {Array.from({ length: 6 }, (_, i) => (
          <div key={i} className="flex flex-col gap-1.5">
            <div className="aspect-video rounded-lg bg-skeleton" />
            <div className="h-3 w-2/3 rounded bg-skeleton" />
          </div>
        ))}
      </div>
      <p className="px-3 pt-3 text-xs text-fg-muted">{t('gallery.placeholder')}</p>
      <div className="mt-auto border-t p-3 text-xs text-fg-muted">{t('gallery.import')}</div>
    </aside>
  );
}
