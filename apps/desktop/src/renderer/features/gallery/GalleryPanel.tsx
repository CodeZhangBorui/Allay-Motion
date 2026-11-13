import { AllayEmpty, AllayLoader } from '@allay/mascot';
import { localize } from '@allay/template-sdk';
import { Button } from '@allay/ui/components/button';
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuTrigger } from '@allay/ui/components/context-menu';
import { Input, Skeleton } from '@allay/ui/components/misc';
import { Tabs, TabsList, TabsTrigger } from '@allay/ui/components/tabs';
import { TemplateCard } from '@allay/ui/editor';
import { Import, Search, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { TemplateEntry } from '../../../shared/templates';
import { notify } from '../../stores/noticeStore';
import { useProjectStore } from '../../stores/projectStore';
import { useTemplateStore } from '../../stores/templateStore';
import { installViaDialog, removeTemplate, selectTemplate } from '../templates/actions';
import { COVER_FPS, COVER_H, COVER_W, coverKey, covers, useCoverStore, type Cover } from './covers';

// 左栏：模板库（6.4）。搜索框（Ctrl+F 聚焦），分类标签：全部、转场、叠加、我的。两列卡片，16:9 的封面加一行名称；
// 悬停时播放预览循环；选中时 --ring 描边加四角的小方块标记；用户模板角上有 --amethyst 的小标记。底部“导入模板…”。
// 首次加载、资源栈变化后重建封面时：骨架加悦灵（AllayLoader）。

type Tab = 'all' | 'transition' | 'overlay' | 'mine';

/** 悬停预览：按 30 fps 把网格图里的帧画到一块小画布上（一个 rAF 循环） */
function HoverPlayer({ cover }: { cover: Cover }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    const sheet = cover.sheet;
    if (!canvas || !sheet || cover.frames === 0) return;
    const g = canvas.getContext('2d');
    if (!g) return;
    let raf = 0;
    let last = -1;
    const t0 = performance.now();
    const tick = (now: number) => {
      const i = Math.floor(((now - t0) / 1000) * COVER_FPS) % cover.frames;
      if (i !== last) {
        last = i;
        g.clearRect(0, 0, COVER_W, COVER_H);
        g.drawImage(sheet, (i % cover.cols) * COVER_W, Math.floor(i / cover.cols) * COVER_H, COVER_W, COVER_H, 0, 0, COVER_W, COVER_H);
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [cover]);
  return <canvas ref={ref} width={COVER_W} height={COVER_H} className="preview-checker-sm size-full" aria-hidden="true" />;
}

function GridSkeleton() {
  return (
    <div className="grid grid-cols-2 gap-2 p-3" aria-hidden="true">
      {Array.from({ length: 6 }, (_, i) => (
        <div key={i} className="flex flex-col gap-1.5 p-1.5">
          <Skeleton className="aspect-video w-full" />
          <Skeleton className="h-3 w-2/3" />
        </div>
      ))}
    </div>
  );
}

function warningOf(e: TemplateEntry, t: (k: string) => string): string | undefined {
  if (e.baseMissing) return t('gallery.baseMissing');
  if (e.trialWarnings.length > 0) return e.trialWarnings.map((w) => t(`templates.warnings.${w}`)).join(t('templates.listSeparator'));
  return undefined;
}

export function GalleryPanel() {
  const { t, i18n } = useTranslation();
  const entries = useTemplateStore((s) => s.entries);
  const loaded = useTemplateStore((s) => s.loaded);
  const current = useProjectStore((s) => s.template?.ref);
  const coverMap = useCoverStore((s) => s.covers);
  const pending = useCoverStore((s) => s.pending);
  const [tab, setTab] = useState<Tab>('all');
  const [query, setQuery] = useState('');
  const locale = i18n.language;

  useEffect(() => covers.ensure(entries), [entries]);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return entries.filter((e) => {
      if (tab === 'mine' && e.source !== 'user') return false;
      if ((tab === 'transition' || tab === 'overlay') && e.manifest.category !== tab) return false;
      if (!q) return true;
      const names = [localize(e.manifest.name, 'zh-CN'), localize(e.manifest.name, 'en'), e.id, ...(e.manifest.tags ?? [])];
      return names.some((n) => n.toLowerCase().includes(q));
    });
  }, [entries, tab, query]);

  // 首次加载，或者资源栈变了、封面全部作废正在重画
  const anyCover = Object.values(coverMap).some(Boolean);
  const loading = !loaded || (pending > 0 && !anyCover);
  const loaderLabel = loaded ? t('gallery.redrawing') : t('gallery.loading');

  return (
    <aside aria-label={t('gallery.title')} className="flex h-full min-w-0 flex-col bg-surface-1" data-testid="gallery">
      <div className="flex flex-col gap-2.5 border-b-2 p-3">
        <div className="relative">
          <Search className="pointer-events-none absolute top-1/2 left-2 size-(--icon-sm) -translate-y-1/2 text-fg-muted" aria-hidden="true" />
          <Input id="gallery-search" value={query} onChange={(e) => setQuery(e.currentTarget.value)} placeholder={t('gallery.search')} aria-label={t('gallery.search')} className="pr-8 pl-8" data-testid="gallery-search" />
          {query && (
            <button type="button" aria-label={t('gallery.clearSearch')} className="absolute top-1/2 right-1 inline-flex size-6 -translate-y-1/2 items-center justify-center text-fg-muted hover:text-foreground" onClick={() => setQuery('')}>
              <X className="size-(--icon-sm)" />
            </button>
          )}
        </div>
        <Tabs value={tab} onValueChange={(v) => setTab(v as Tab)}>
          <TabsList className="h-8 w-full p-0" aria-label={t('gallery.categoriesLabel')}>
            {(['all', 'transition', 'overlay', 'mine'] as const).map((k) => (
              <TabsTrigger key={k} value={k} data-testid={`gallery-tab-${k}`} className="flex-auto px-1.5">
                {t(`gallery.tabs.${k}`)}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <AllayLoader loading={loading} label={loaderLabel} className="min-h-full" testId="gallery-loader">
          {loading ? (
            <GridSkeleton />
          ) : shown.length === 0 ? (
            query ? (
              <div className="flex flex-col items-center gap-2 px-4 py-8 text-center" data-testid="gallery-no-results">
                <p className="font-px12">{t('gallery.noResults', { query: query.trim() })}</p>
                <Button variant="secondary" onClick={() => setQuery('')}>
                  {t('gallery.clearSearch')}
                </Button>
              </div>
            ) : tab === 'mine' ? (
              <AllayEmpty
                title={t('gallery.mineEmptyTitle')}
                description={t('gallery.mineEmpty')}
                action={
                  <Button variant="secondary" onClick={() => void installViaDialog(t, locale)}>
                    {t('gallery.import')}
                  </Button>
                }
              />
            ) : (
              <p className="p-4 text-xs text-fg-muted">{t('gallery.empty')}</p>
            )
          ) : (
            <div className="grid grid-cols-2 gap-2 p-3" data-testid="template-list">
              {shown.map((e) => {
                const key = coverKey(e.id, e.version);
                const cover = coverMap[key];
                const name = localize(e.manifest.name, locale);
                const warning = warningOf(e, t);
                const card = (
                  <TemplateCard
                    testId={`template-${e.id}`}
                    name={name}
                    coverUrl={cover?.url ?? null}
                    selected={current?.id === e.id && current.version === e.version}
                    user={e.source === 'user'}
                    userLabel={t('gallery.user')}
                    warning={warning}
                    disabled={e.baseMissing}
                    description={t(`gallery.categories.${e.manifest.category}`)}
                    renderPreview={cover?.sheet ? () => <HoverPlayer cover={cover} /> : undefined}
                    onSelect={() => void selectTemplate(e.id, e.version, locale)}
                  />
                );
                return (
                  <div key={`${e.id}@${e.version}`} data-allay-item>
                    {e.source === 'user' ? (
                      <ContextMenu>
                        <ContextMenuTrigger render={<div />}>{card}</ContextMenuTrigger>
                        <ContextMenuContent>
                          <ContextMenuItem
                            onClick={() =>
                              void window.allay.templates.exportPackage(e.id, e.version).then((r) => {
                                if (!r.canceled) notify('info', t('gallery.exported'));
                              })
                            }
                          >
                            {t('gallery.exportPackage')}
                          </ContextMenuItem>
                          <ContextMenuItem className="text-danger" onClick={() => void removeTemplate(e.id, e.version, locale)}>
                            {t('gallery.remove')}
                          </ContextMenuItem>
                        </ContextMenuContent>
                      </ContextMenu>
                    ) : (
                      card
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </AllayLoader>
      </div>
      <div className="border-t-2 p-2">
        <Button variant="ghost" className="w-full justify-start text-fg-muted" data-testid="template-import" onClick={() => void installViaDialog(t, locale)}>
          <Import />
          {t('gallery.import')}
        </Button>
      </div>
    </aside>
  );
}
