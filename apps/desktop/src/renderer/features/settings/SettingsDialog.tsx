import { Dialog, DialogContent, DialogTitle } from '@allay/ui/components/dialog';
import { ScrollArea } from '@allay/ui/components/misc';
import { ICON, ICON_WEIGHT } from '@allay/ui/lib/icons';
import { cn } from '@allay/ui/lib/utils';
import { useEffect, useRef, type KeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { useSettingsPages } from '../../app/registry';
import { useUiStore } from '../../stores/uiStore';

// 设置对话框（docs/06-ui-design.md 6.11）：左边是分类（图标 + 名称，来自注册表的 registerSettingsPage），右边是这一类的设置。
// 和主界面同一套语言：侧栏是面板色的一列，选中项是控件高亮底、图标换成实心；内容区是次级面，分组靠半粗标题和 1 px 分隔线。

export function SettingsDialog() {
  const { t } = useTranslation();
  const pages = useSettingsPages();
  const wanted = useUiStore((s) => s.settingsPage);
  const current = pages.find((p) => p.id === wanted) ?? pages[0];
  const close = () => useUiStore.getState().openDialog(null);
  const scroller = useRef<HTMLDivElement>(null);
  // 换页时回到顶部（新版 Chromium 的 scrollTo 返回 Promise，不能直接当 effect 的返回值）
  useEffect(() => {
    void scroller.current?.querySelector('.overscroll-contain')?.scrollTo({ top: 0 });
  }, [current?.id]);

  const go = (id: string) => useUiStore.setState({ settingsPage: id });
  const onNavKey = (e: KeyboardEvent<HTMLButtonElement>, i: number) => {
    const d = e.key === 'ArrowDown' ? 1 : e.key === 'ArrowUp' ? -1 : 0;
    if (!d) return;
    e.preventDefault();
    const next = pages[(i + d + pages.length) % pages.length]!;
    go(next.id);
    requestAnimationFrame(() => document.querySelector<HTMLElement>(`[data-testid="settings-tab-${next.id}"]`)?.focus());
  };

  return (
    <Dialog open onOpenChange={(open) => !open && close()}>
      <DialogContent closeLabel={t('common.close')} className="h-[min(640px,calc(100vh-48px))] w-[880px] flex-row gap-0 overflow-hidden p-0" data-testid="settings-dialog">
        <nav className="flex w-[208px] shrink-0 flex-col gap-0.5 bg-surface-1 px-2.5 pt-4 pb-3" aria-label={t('settings.title')}>
          <DialogTitle className="px-2.5 pb-3 text-base">{t('settings.title')}</DialogTitle>
          <div role="tablist" aria-orientation="vertical" className="flex flex-col gap-0.5">
            {pages.map((p, i) => {
              const active = p.id === current?.id;
              return (
                <button
                  key={p.id}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  aria-controls="settings-page"
                  tabIndex={active ? 0 : -1}
                  data-active={active ? '' : undefined}
                  data-testid={`settings-tab-${p.id}`}
                  onClick={() => go(p.id)}
                  onKeyDown={(e) => onNavKey(e, i)}
                  className={cn(
                    'flex h-8 items-center gap-2.5 rounded-md px-2.5 text-left text-sm transition-colors duration-(--dur-1) outline-none',
                    'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--ring)',
                    active ? 'bg-control-hi text-foreground' : 'text-fg-muted hover:bg-control hover:text-foreground',
                  )}
                >
                  <p.icon size={ICON.md} weight={active ? ICON_WEIGHT.active : ICON_WEIGHT.normal} className={active ? 'text-foreground' : 'text-fg-subtle'} aria-hidden="true" />
                  <span className="truncate">{t(p.titleKey)}</span>
                </button>
              );
            })}
          </div>
        </nav>
        <div ref={scroller} className="flex min-w-0 flex-1 flex-col">
          <ScrollArea className="h-full">
            <div id="settings-page" role="tabpanel" aria-label={current ? t(current.titleKey) : undefined} className="px-7 pt-5 pb-7" data-page={current?.id}>
              {current && <current.component key={current.id} />}
            </div>
          </ScrollArea>
        </div>
      </DialogContent>
    </Dialog>
  );
}
