import { Button } from '@allay/ui/components/button';
import { useTranslation } from 'react-i18next';
import { useProjectStore } from '../../stores/projectStore';
import { useTemplateStore } from '../../stores/templateStore';
import { localized } from '../../templates/catalog';
import { installViaDialog, selectTemplate } from '../templates/actions';

// 左栏：模板库（6.4）。M3 是一个最小的列表：已安装的模板（内置和用户的）和“导入模板…”。
// 卡片、封面、悬停预览、搜索、分类在 M4。
export function GalleryPanel() {
  const { t, i18n } = useTranslation();
  const entries = useTemplateStore((s) => s.entries);
  const loaded = useTemplateStore((s) => s.loaded);
  const current = useProjectStore((s) => s.template?.ref);
  return (
    <aside aria-label={t('gallery.title')} className="flex h-full min-w-0 flex-col bg-surface-1">
      <div className="flex h-10 items-center border-b px-3 text-base font-medium">{t('gallery.title')}</div>
      <ul className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto p-2" data-testid="template-list">
        {entries.map((e) => {
          const active = current?.id === e.id && current.version === e.version;
          return (
            <li key={`${e.id}@${e.version}`}>
              <button
                type="button"
                data-testid={`template-${e.id}`}
                aria-current={active ? 'true' : undefined}
                disabled={e.baseMissing}
                onClick={() => void selectTemplate(e.id, e.version, i18n.language)}
                className={`flex w-full flex-col items-start rounded-md px-2 py-1.5 text-left text-sm ${active ? 'bg-surface-3 text-foreground' : 'text-fg-muted hover:bg-surface-2'} disabled:opacity-50`}
              >
                <span className="truncate">{localized(e.manifest.name, i18n.language)}</span>
                <span className="text-xs text-fg-subtle">
                  {e.source === 'builtin' ? t('gallery.builtin') : t('gallery.user')} · {e.version}
                  {e.baseMissing ? ` · ${t('gallery.baseMissing')}` : ''}
                  {e.trialWarnings.includes('nondeterministic') ? ` · ${t('gallery.nondeterministic')}` : ''}
                </span>
              </button>
            </li>
          );
        })}
        {loaded && entries.length === 0 && <li className="px-2 text-xs text-fg-muted">{t('gallery.empty')}</li>}
      </ul>
      <div className="border-t p-2">
        <Button variant="ghost" className="w-full justify-start text-fg-muted" data-testid="template-import" onClick={() => void installViaDialog(t, i18n.language)}>
          {t('gallery.import')}
        </Button>
      </div>
    </aside>
  );
}
