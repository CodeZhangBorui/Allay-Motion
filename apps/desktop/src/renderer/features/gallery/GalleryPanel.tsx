import { AllayEmpty, AllayLoader } from '@allay/mascot';
import { localize, type TemplateManifest } from '@allay/template-sdk';
import { Button } from '@allay/ui/components/button';
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuTrigger } from '@allay/ui/components/context-menu';
import { Input, Skeleton } from '@allay/ui/components/misc';
import { Tabs, TabsList, TabsTrigger } from '@allay/ui/components/tabs';
import { TemplateCard } from '@allay/ui/editor';
import { ICON } from '@allay/ui/lib/icons';
import { MagnifyingGlass, Plus, X } from '@phosphor-icons/react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { TemplateEntry } from '../../../shared/templates';
import { notify } from '../../stores/noticeStore';
import { useProjectStore } from '../../stores/projectStore';
import { useTemplateStore } from '../../stores/templateStore';
import { useTransportStore } from '../../stores/transportStore';
import { useUiStore } from '../../stores/uiStore';
import { usePresets } from '../params/ParamsPanel';
import { applyPresetEntry } from '../templates/presets';
import { installViaDialog, removeTemplate, selectTemplate } from '../templates/actions';
import { COVER_FPS, COVER_H, COVER_W, coverKey, covers, useCoverStore, type Cover } from './covers';

// 左面板（6.4）的两个标签页（经注册表挂到 TabbedPanel 上，见 app/core.tsx）：“模板 | 预设”；模板页的标题行右侧是搜索和导入图标。
// 模板页：分类“全部/转场/叠加/我的”是安静的文字切换（选中项有控件底色）；两列缩略图，名称在下、时长（等宽）在右；
// 悬停时播放预览循环；选中 = 面板色 2 px 间隙 + 2 px 强调色外框。首次加载、资源栈变化后重建封面时：骨架加悦灵。
// 预设页：当前模板的预设（沿用已有的预设存取），点一下应用。

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
    <div className="grid grid-cols-2 gap-x-2.5 gap-y-3 px-3 pt-3" aria-hidden="true">
      {Array.from({ length: 6 }, (_, i) => (
        <div key={i} className="flex flex-col gap-[7px]">
          <Skeleton className="aspect-video w-full" />
          <Skeleton className="h-3 w-2/3 rounded-sm" />
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

/** 模板的时长：manifest 的时间段（timeline.segments）对应的 duration 参数默认值之和；不知道时为 null */
function manifestDuration(m: TemplateManifest): number | null {
  const segs = m.timeline?.segments;
  if (!segs || segs.length === 0 || !m.params) return null;
  let sum = 0;
  for (const s of segs) {
    const p = m.params.find((d) => d.key === s.param);
    if (!p || p.type !== 'duration') return null;
    sum += p.default;
  }
  return sum;
}

function TemplatesPage({ query, setQuery }: { query: string; setQuery(q: string): void }) {
  const { t, i18n } = useTranslation();
  const entries = useTemplateStore((s) => s.entries);
  const loaded = useTemplateStore((s) => s.loaded);
  const current = useProjectStore((s) => s.template?.ref);
  const currentDuration = useTransportStore((s) => s.duration);
  const coverMap = useCoverStore((s) => s.covers);
  const pending = useCoverStore((s) => s.pending);
  const [tab, setTab] = useState<Tab>('all');
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
    <>
      <Tabs value={tab} onValueChange={(v) => setTab(v as Tab)}>
        <TabsList className="gap-0.5 px-2.5" aria-label={t('gallery.categoriesLabel')}>
          {(['all', 'transition', 'overlay', 'mine'] as const).map((k) => (
            <TabsTrigger key={k} value={k} data-testid={`gallery-tab-${k}`}>
              {t(`gallery.tabs.${k}`)}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <AllayLoader loading={loading} label={loaderLabel} className="min-h-full" testId="gallery-loader">
          {loading ? (
            <GridSkeleton />
          ) : shown.length === 0 ? (
            query ? (
              <div className="flex flex-col items-center gap-2.5 px-4 py-8 text-center" data-testid="gallery-no-results">
                <p className="text-fg-muted">{t('gallery.noResults', { query: query.trim() })}</p>
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
              <p className="p-4 text-xs text-fg-subtle">{t('gallery.empty')}</p>
            )
          ) : (
            <div className="grid grid-cols-2 gap-x-2.5 gap-y-3 px-3 pt-3 pb-3" data-testid="template-list">
              {shown.map((e) => {
                const key = coverKey(e.id, e.version);
                const cover = coverMap[key];
                const name = localize(e.manifest.name, locale);
                const warning = warningOf(e, t);
                const selected = current?.id === e.id && current.version === e.version;
                const d = manifestDuration(e.manifest) ?? (selected && currentDuration > 0 ? currentDuration : null);
                const card = (
                  <TemplateCard
                    testId={`template-${e.id}`}
                    name={name}
                    duration={d !== null ? `${d.toFixed(1)} s` : undefined}
                    coverUrl={cover?.url ?? null}
                    selected={selected}
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
    </>
  );
}

function PresetsPage() {
  const { t, i18n } = useTranslation();
  const template = useProjectStore((s) => s.template);
  const presets = usePresets(template?.ref.id);
  if (presets.length === 0) return <p className="px-3.5 py-3 text-xs leading-relaxed text-fg-subtle" data-testid="gallery-presets-empty">{t('gallery.presetsEmpty')}</p>;
  return (
    <ul className="flex flex-col gap-0.5 overflow-y-auto px-2 pb-3" data-testid="gallery-presets">
      {presets.map((p) => (
        <li key={p.id}>
          <button
            type="button"
            className="flex h-8 w-full items-center rounded-md px-2.5 text-left text-fg-muted hover:bg-control hover:text-foreground"
            onClick={() =>
              void applyPresetEntry(p, i18n.language).then((ok) => {
                if (!ok) notify('error', t('params.presets.applyFailed'));
              })
            }
          >
            <span className="truncate">{p.name}</span>
          </button>
        </li>
      ))}
    </ul>
  );
}

/** 模板页标题行右侧：搜索（展开搜索框，Ctrl+F 同）和导入 */
export function TemplatesActions() {
  const { t, i18n } = useTranslation();
  const searchOpen = useUiStore((s) => s.searchOpen);
  const query = useUiStore((s) => s.galleryQuery);
  const showSearch = searchOpen || query !== '';
  return (
    <>
      <Button
        variant="ghost"
        size="icon-sm"
        className="text-fg-subtle"
        aria-label={t('gallery.searchToggle')}
        aria-pressed={showSearch}
        data-testid="gallery-search-toggle"
        onClick={() => {
          if (showSearch) useUiStore.setState({ searchOpen: false, galleryQuery: '' });
          else {
            useUiStore.setState({ searchOpen: true });
            requestAnimationFrame(() => document.getElementById('gallery-search')?.focus());
          }
        }}
      >
        <MagnifyingGlass size={ICON.md - 1} />
      </Button>
      <Button variant="ghost" size="icon-sm" className="text-fg-subtle" aria-label={t('gallery.import')} title={t('gallery.import')} data-testid="template-import" onClick={() => void installViaDialog(t, i18n.language)}>
        <Plus size={ICON.md - 1} />
      </Button>
    </>
  );
}

/** 模板页：搜索框（展开时）、分类、缩略图网格 */
export function TemplatesTab() {
  const { t } = useTranslation();
  const searchOpen = useUiStore((s) => s.searchOpen);
  const query = useUiStore((s) => s.galleryQuery);
  const setQuery = (galleryQuery: string) => useUiStore.setState({ galleryQuery });
  const showSearch = searchOpen || query !== '';
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2">
      {showSearch && (
        <div className="relative mx-2.5">
          <MagnifyingGlass size={ICON.sm} className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-fg-subtle" aria-hidden="true" />
          <Input
            id="gallery-search"
            value={query}
            onChange={(e) => setQuery(e.currentTarget.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape' && query === '') useUiStore.setState({ searchOpen: false });
            }}
            placeholder={t('gallery.search')}
            aria-label={t('gallery.search')}
            className="h-7 pr-8 pl-8"
            data-testid="gallery-search"
          />
          {query && (
            <button type="button" aria-label={t('gallery.clearSearch')} className="absolute top-1/2 right-1 inline-flex size-6 -translate-y-1/2 items-center justify-center rounded-sm text-fg-subtle hover:text-foreground" onClick={() => setQuery('')}>
              <X size={ICON.sm} />
            </button>
          )}
        </div>
      )}
      <TemplatesPage query={query} setQuery={setQuery} />
    </div>
  );
}

/** 预设页 */
export function PresetsTab() {
  return <PresetsPage />;
}
