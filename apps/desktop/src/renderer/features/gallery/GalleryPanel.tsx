import { AllayEmpty, AllayLoader } from '@allay/mascot';
import type { TemplateManifest } from '@allay/template-sdk';
import { Button } from '@allay/ui/components/button';
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuTrigger } from '@allay/ui/components/context-menu';
import { Input, Skeleton } from '@allay/ui/components/misc';
import { Select, SelectContent, SelectItem, SelectSeparator, SelectTrigger, SelectValue } from '@allay/ui/components/select';
import { Tabs, TabsList, TabsTrigger } from '@allay/ui/components/tabs';
import { TemplateCard } from '@allay/ui/editor';
import { ICON } from '@allay/ui/lib/icons';
import { MagnifyingGlass, Plus, X } from '@phosphor-icons/react';
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type RefObject } from 'react';
import type { TFunction } from 'i18next';
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
import { COVER_H, COVER_W, coverKey, covers, useCoverStore, type HoverSheet } from './covers';
import {
  CATEGORY_TABS,
  GRID_KEYS,
  gridRows,
  itemKey,
  LIBRARY_GROUPS,
  libraryView,
  moveInGrid,
  prepareItems,
  type CategoryTab,
  type GridKey,
  type GroupFilter,
  type GroupLabels,
  type LibraryGroup,
  type LibraryItem,
  type LibraryView,
} from './library';

// 左面板（6.4）的两个标签页（经注册表挂到 TabbedPanel 上，见 app/core.tsx）：“模板 | 预设”；模板页的标题行右侧是搜索和导入图标。
// 模板页（docs/decisions.md“模板库撑到一百个模板”）：
// - 上面两行筛选：类别（全部 / 转场 / 叠加 / 标题 / 我的，安静的文字切换）；分组（下拉，带每组的数量）和结果数。
// - 列表按组分段（段头吸顶，写组名和数量），每段两列缩略图；顺序见 library.ts 的 compareItems。
// - 封面只给可见范围附近的卡片要（两个 IntersectionObserver：可见、上下各一屏），悬停预览等指针停够了才要（covers.ts）。
// - 键盘：类别、分组、卡片各是一个 Tab 停靠点；卡片之间用方向键、Home/End、PageUp/PageDown 移动（漫游 tabindex），回车选中。
// 预设页：当前模板的预设（沿用已有的预设存取），点一下应用。

/** 每行几张：面板宽 240–360，两列 */
const COLUMNS = 2;

/**
 * 悬停预览：按 30 fps 把网格图里的帧画到一块小画布上（一个 rAF 循环）。渲染中的网格图（partial）只有前 ready 帧画好了，
 * 播到还没画好的地方就停在最后一张画好的上；画完换成位图时接着播，不从头开始
 */
function HoverPlayer({ source, frames, ready, cols }: Pick<HoverSheet, 'frames' | 'ready' | 'cols'> & { source: ImageBitmap | OffscreenCanvas }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const t0 = useRef(performance.now());
  const readyRef = useRef(ready);
  readyRef.current = ready;
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas || frames === 0) return;
    const g = canvas.getContext('2d');
    if (!g) return;
    let raf = 0;
    let last = -1;
    const tick = (now: number) => {
      const i = Math.min(Math.floor(((now - t0.current) / 1000) * 30) % frames, Math.max(0, readyRef.current - 1));
      if (i !== last) {
        last = i;
        g.clearRect(0, 0, COVER_W, COVER_H);
        try {
          g.drawImage(source, (i % cols) * COVER_W, Math.floor(i / cols) * COVER_H, COVER_W, COVER_H, 0, 0, COVER_W, COVER_H);
        } catch {
          // 位图已经释放（换了一张卡片）：这一帧不画，组件马上就卸载
          return;
        }
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [source, frames, cols]);
  return <canvas ref={ref} width={COVER_W} height={COVER_H} className="preview-checker-sm size-full" aria-hidden="true" />;
}

/** 骨架：形状与第一段一致（段头一行加三行卡片） */
function GridSkeleton() {
  return (
    <div aria-hidden="true">
      <div className="flex h-8 items-center px-3.5">
        <Skeleton className="h-3 w-16 rounded-sm" />
      </div>
      <div className="grid grid-cols-2 gap-x-2.5 gap-y-3 px-3">
        {Array.from({ length: 6 }, (_, i) => (
          <div key={i} className="flex flex-col gap-[7px]">
            <Skeleton className="aspect-video w-full" />
            <Skeleton className="h-3 w-2/3 rounded-sm" />
          </div>
        ))}
      </div>
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

/** 组名的两种语言（搜组名用） */
function useGroupLabels(): GroupLabels {
  const { i18n } = useTranslation();
  return useMemo(() => {
    const zh = i18n.getFixedT('zh-CN');
    const en = i18n.getFixedT('en');
    return Object.fromEntries(LIBRARY_GROUPS.map((g) => [g, [zh(`gallery.groups.${g}`), en(`gallery.groups.${g}`)]])) as unknown as GroupLabels;
  }, [i18n]);
}

/**
 * 可见范围：两个 IntersectionObserver（可见；上下各一屏），结果按界面上的先后报给封面服务（每帧最多一次）。
 * 卡片用 register 登记自己的外层元素；卸载（换到别的标签页）时把请求全部撤掉。
 */
function useCoverRequests(scroller: RefObject<HTMLDivElement | null>, order: readonly LibraryItem[]) {
  const state = useRef({
    order,
    near: new Set<string>(),
    visible: new Set<string>(),
    keys: new Map<Element, string>(),
    io: null as { near: IntersectionObserver; view: IntersectionObserver } | null,
    raf: 0,
  });
  state.current.order = order;
  const report = useCallback(() => {
    const s = state.current;
    s.raf = 0;
    const items: { entry: TemplateEntry; lane: 'visible' | 'near' }[] = [];
    for (const it of s.order) {
      if (s.visible.has(it.key)) items.push({ entry: it.entry, lane: 'visible' });
      else if (s.near.has(it.key)) items.push({ entry: it.entry, lane: 'near' });
    }
    covers.setView(items);
  }, []);
  const schedule = useCallback(() => {
    const s = state.current;
    if (!s.raf) s.raf = requestAnimationFrame(report);
  }, [report]);
  useLayoutEffect(() => {
    const root = scroller.current;
    if (!root) return;
    const s = state.current;
    const track = (set: Set<string>, mark: boolean) => (entries: IntersectionObserverEntry[]) => {
      for (const e of entries) {
        const key = s.keys.get(e.target);
        if (!key) continue;
        if (e.isIntersecting) set.add(key);
        else set.delete(key);
        if (mark) (e.target as HTMLElement).dataset.inView = String(e.isIntersecting);
      }
      schedule();
    };
    s.io = { near: new IntersectionObserver(track(s.near, false), { root, rootMargin: '100% 0px' }), view: new IntersectionObserver(track(s.visible, true), { root }) };
    for (const el of s.keys.keys()) {
      s.io.near.observe(el);
      s.io.view.observe(el);
    }
    return () => {
      s.io?.near.disconnect();
      s.io?.view.disconnect();
      s.io = null;
      if (s.raf) cancelAnimationFrame(s.raf);
      s.raf = 0;
      s.near.clear();
      s.visible.clear();
      covers.setView([]);
      covers.setHover(null);
    };
  }, [scroller, schedule]);
  // 筛选变了：顺序变了，重新报一次（新出现的卡片由观察者的第一次回调报上来）
  useEffect(() => schedule(), [order, schedule]);
  const register = useCallback((key: string, el: HTMLElement) => {
    const s = state.current;
    s.keys.set(el, key);
    s.io?.near.observe(el);
    s.io?.view.observe(el);
    return () => {
      s.keys.delete(el);
      s.io?.near.unobserve(el);
      s.io?.view.unobserve(el);
      s.near.delete(key);
      s.visible.delete(key);
      schedule();
    };
  }, [schedule]);
  return register;
}

interface CardProps {
  item: LibraryItem;
  selected: boolean;
  tabbable: boolean;
  duration: string | undefined;
  register(key: string, el: HTMLElement): () => void;
  setButton(key: string, el: HTMLButtonElement | null): void;
  onActive(key: string): void;
}

/** 一张卡片：只订阅自己的封面和悬停预览，别的卡片的封面到了不重画它 */
const LibraryCard = memo(function LibraryCard({ item, selected, tabbable, duration, register, setButton, onActive }: CardProps) {
  const { t, i18n } = useTranslation();
  const e = item.entry;
  const ck = coverKey(e.id, e.version);
  const cover = useCoverStore((s) => s.covers[ck]);
  const failure = useCoverStore((s) => s.failures[ck]);
  const hover = useCoverStore((s) => (s.hover?.key === ck ? s.hover : null));
  const wrapper = useCallback((el: HTMLDivElement | null) => (el ? register(item.key, el) : undefined), [register, item.key]);
  const button = useCallback((el: HTMLButtonElement | null) => setButton(item.key, el), [setButton, item.key]);
  const warning = warningOf(e, t);
  const card = (
    <TemplateCard
      ref={button}
      testId={`template-${e.id}`}
      name={item.name}
      duration={duration}
      coverUrl={cover?.url ?? null}
      // 基模板缺失的不会有封面：静止的占位，不是一直呼吸的骨架
      coverState={e.baseMissing || cover === null ? 'failed' : cover ? 'ready' : 'loading'}
      coverError={failure ? t('gallery.coverFailed', { reason: failure }) : undefined}
      selected={selected}
      user={e.source === 'user'}
      userLabel={t('gallery.user')}
      warning={warning}
      disabled={e.baseMissing}
      description={t(`gallery.categories.${e.manifest.category}`)}
      detail={t('gallery.detail', { category: t(`gallery.categories.${e.manifest.category}`), group: t(`gallery.groups.${item.group}`) })}
      preview={hover && hover.state !== 'failed' && (hover.sheet ?? hover.partial) && hover.ready > 0 ? <HoverPlayer source={(hover.sheet ?? hover.partial)!} frames={hover.frames} ready={hover.ready} cols={hover.cols} /> : undefined}
      previewProgress={hover?.state === 'loading' ? hover.progress : null}
      onPreviewIntent={(on) => {
        if (on) covers.setHover(e);
        else if (useCoverStore.getState().hover?.key === ck) covers.setHover(null);
      }}
      tabIndex={tabbable ? 0 : -1}
      onFocus={() => onActive(item.key)}
      onSelect={() => void selectTemplate(e.id, e.version, i18n.language)}
    />
  );
  return (
    <div ref={wrapper} data-card-key={item.key} data-group={item.group}>
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
            <ContextMenuItem className="text-danger" onClick={() => void removeTemplate(e.id, e.version, i18n.language)}>
              {t('gallery.remove')}
            </ContextMenuItem>
          </ContextMenuContent>
        </ContextMenu>
      ) : (
        card
      )}
    </div>
  );
});

/** 结果数：搜索时是“n 个结果”，否则是当前类别、分组下的模板数 */
function countText(view: LibraryView, searching: boolean, t: TFunction): string {
  if (searching) return view.shown === 1 ? t('gallery.resultsOne') : t('gallery.results', { count: view.shown });
  return view.shown === 1 ? t('gallery.totalOne') : t('gallery.total', { count: view.shown });
}

/** 类别、分组两行筛选 */
function FilterBar({ view, searching }: { view: LibraryView; searching: boolean }) {
  const { t } = useTranslation();
  const tab = useUiStore((s) => s.galleryTab);
  const group = useUiStore((s) => s.galleryGroup);
  const groupName = (g: GroupFilter) => (g === 'all' ? t('gallery.groupAll') : t(`gallery.groups.${g}`));
  return (
    <div className="flex shrink-0 flex-col gap-1.5 px-2.5">
      <Tabs value={tab} onValueChange={(v) => useUiStore.setState({ galleryTab: v as CategoryTab })}>
        <TabsList className="flex-wrap" aria-label={t('gallery.categoriesLabel')}>
          {CATEGORY_TABS.map((k) => (
            <TabsTrigger key={k} value={k} className="px-[7px]" data-testid={`gallery-tab-${k}`}>
              {t(`gallery.tabs.${k}`)}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>
      <div className="flex h-control items-center justify-between gap-2">
        <Select value={group} onValueChange={(v) => useUiStore.setState({ galleryGroup: v as GroupFilter })}>
          <SelectTrigger className="h-6 max-w-[64%] gap-1 px-2 text-xs" aria-label={t('gallery.groupLabel')} data-testid="gallery-group">
            <SelectValue>{(v: unknown) => <span className="truncate">{groupName(v as GroupFilter)}</span>}</SelectValue>
          </SelectTrigger>
          <SelectContent className="min-w-48">
            <SelectItem value="all" data-testid="gallery-group-all">
              <span className="flex-1 truncate">{t('gallery.groupAll')}</span>
              <span className="num text-xs text-fg-subtle">{view.inCategory}</span>
            </SelectItem>
            <SelectSeparator />
            {LIBRARY_GROUPS.filter((g) => g !== 'other' || view.groupCounts.other > 0 || group === 'other').map((g) => (
              <SelectItem key={g} value={g} disabled={view.groupCounts[g] === 0 && group !== g} data-testid={`gallery-group-${g}`}>
                <span className="flex-1 truncate">{t(`gallery.groups.${g}`)}</span>
                <span className="num text-xs text-fg-subtle">{view.groupCounts[g]}</span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <span className="truncate num text-xs text-fg-subtle" role="status" data-testid="gallery-count">
          {countText(view, searching, t)}
        </span>
      </div>
    </div>
  );
}

/** 没有结果时：说明为什么、给一个出路 */
function EmptyResults({ view, query, setQuery }: { view: LibraryView; query: string; setQuery(q: string): void }) {
  const { t, i18n } = useTranslation();
  const tab = useUiStore((s) => s.galleryTab);
  const group = useUiStore((s) => s.galleryGroup);
  const showAll = () => useUiStore.setState({ galleryTab: 'all', galleryGroup: 'all' });
  if (query.trim()) {
    const elsewhere = view.anywhere - view.shown;
    return (
      <div className="flex flex-col items-center gap-2 px-5 py-8 text-center" data-testid="gallery-no-results">
        <p className="text-foreground">{t('gallery.noResults', { query: query.trim() })}</p>
        <p className="max-w-64 text-xs text-fg-subtle">{elsewhere > 0 ? t('gallery.noResultsElsewhere', { count: elsewhere }) : t('gallery.noResultsHint')}</p>
        <div className="mt-1 flex flex-wrap justify-center gap-1.5">
          {elsewhere > 0 && (
            <Button variant="secondary" onClick={showAll} data-testid="gallery-show-everywhere">
              {t('gallery.showEverywhere')}
            </Button>
          )}
          <Button variant={elsewhere > 0 ? 'ghost' : 'secondary'} onClick={() => setQuery('')} data-testid="gallery-clear-search">
            {t('gallery.clearSearch')}
          </Button>
        </div>
      </div>
    );
  }
  if (tab === 'mine' && group === 'all') {
    return (
      <AllayEmpty
        title={t('gallery.mineEmptyTitle')}
        description={t('gallery.mineEmpty')}
        action={
          <Button variant="secondary" onClick={() => void installViaDialog(t, i18n.language)}>
            {t('gallery.import')}
          </Button>
        }
      />
    );
  }
  if (group !== 'all') {
    return (
      <div className="flex flex-col items-center gap-2 px-5 py-8 text-center" data-testid="gallery-filtered-empty">
        <p className="text-xs text-fg-subtle">{t('gallery.filteredEmpty', { category: t(`gallery.tabs.${tab}`), group: t(`gallery.groups.${group}`) })}</p>
        <Button variant="secondary" onClick={() => useUiStore.setState({ galleryGroup: 'all' })}>
          {t('gallery.showAllGroups')}
        </Button>
      </div>
    );
  }
  return <p className="p-4 text-xs text-fg-subtle">{t('gallery.empty')}</p>;
}

function TemplatesPage({ query, setQuery }: { query: string; setQuery(q: string): void }) {
  const { t, i18n } = useTranslation();
  const entries = useTemplateStore((s) => s.entries);
  const loaded = useTemplateStore((s) => s.loaded);
  const current = useProjectStore((s) => s.template?.ref);
  const currentDuration = useTransportStore((s) => s.duration);
  const redrawing = useCoverStore((s) => s.redrawing);
  const anyCover = useCoverStore((s) => Object.keys(s.covers).length > 0);
  const tab = useUiStore((s) => s.galleryTab);
  const group = useUiStore((s) => s.galleryGroup);
  const locale = i18n.language;
  const labels = useGroupLabels();

  const items = useMemo(() => prepareItems(entries, locale, labels), [entries, locale, labels]);
  const view = useMemo(() => libraryView(items, { tab, group, query }), [items, tab, group, query]);
  const flat = useMemo(() => view.sections.flatMap((s) => s.items), [view]);
  const rows = useMemo(() => gridRows(view.sections, COLUMNS), [view]);
  const searching = query.trim() !== '';
  const headers = group === 'all';

  // 漫游 tabindex：Tab 进来落在上次聚焦的、或者当前选中的、或者第一张
  const currentKey = current ? itemKey(current) : null;
  const [active, setActive] = useState<string | null>(null);
  // 基模板缺失的卡片是禁用的，拿不到焦点：不当停靠点，方向键也跳过它
  const present = useMemo(() => new Set(flat.filter((i) => !i.entry.baseMissing).map((i) => i.key)), [flat]);
  const tabbable = active && present.has(active) ? active : currentKey && present.has(currentKey) ? currentKey : (flat.find((i) => !i.entry.baseMissing)?.key ?? null);
  const buttons = useRef(new Map<string, HTMLButtonElement>());
  const setButton = useCallback((key: string, el: HTMLButtonElement | null) => {
    if (el) buttons.current.set(key, el);
    else buttons.current.delete(key);
  }, []);
  const scroller = useRef<HTMLDivElement>(null);
  const register = useCoverRequests(scroller, flat);

  const onGridKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (!GRID_KEYS.has(e.key) || e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
    const from = (e.target as HTMLElement).closest('[data-card-key]')?.getAttribute('data-card-key');
    if (!from) return;
    // 方向键归卡片：不再交给全局快捷键（逐帧、回到开头）
    e.preventDefault();
    const sample = buttons.current.get(from);
    const rowHeight = (sample?.offsetHeight ?? 90) + 12;
    const pageRows = Math.max(1, Math.floor((scroller.current?.clientHeight ?? rowHeight * 3) / rowHeight) - 1);
    const next = moveInGrid(rows, from, e.key as GridKey, pageRows, (k) => !present.has(k));
    if (!next || next === from) return;
    setActive(next);
    buttons.current.get(next)?.focus();
  };

  // 换了筛选：滚回顶上（结果是另一批，停在原来的位置没有意义）
  useLayoutEffect(() => {
    scroller.current?.scrollTo({ top: 0 });
  }, [tab, group]);

  const loaderLabel = !loaded ? t('gallery.loading') : anyCover ? t('gallery.redrawing') : t('gallery.rendering');
  return (
    <>
      <FilterBar view={view} searching={searching} />
      <div className="relative min-h-0 flex-1">
        <div ref={scroller} className="h-full overflow-y-auto overscroll-contain" data-testid="template-scroll">
          {!loaded ? (
            <GridSkeleton />
          ) : view.shown === 0 ? (
            <EmptyResults view={view} query={query} setQuery={setQuery} />
          ) : (
            <div role="group" aria-label={t('gallery.listLabel')} className="pb-3" data-testid="template-list" onKeyDown={onGridKey}>
              {view.sections.map((section) => (
                <Section key={section.group} group={section.group} count={section.items.length} header={headers}>
                  {section.items.map((item) => {
                    const selected = current?.id === item.entry.id && current.version === item.entry.version;
                    const d = manifestDuration(item.entry.manifest) ?? (selected && currentDuration > 0 ? currentDuration : null);
                    return (
                      <LibraryCard
                        key={item.key}
                        item={item}
                        selected={selected}
                        tabbable={item.key === tabbable}
                        duration={d !== null ? `${d.toFixed(1)} s` : undefined}
                        register={register}
                        setButton={setButton}
                        onActive={setActive}
                      />
                    );
                  })}
                </Section>
              ))}
            </div>
          )}
        </div>
        {/* 加载编排盖在列表上面（不包住它：重画封面时列表照常显示、滚动位置不丢） */}
        <div className="pointer-events-none absolute inset-0">
          <AllayLoader loading={!loaded || redrawing} label={loaderLabel} priority="gallery" className="h-full" testId="gallery-loader">
            <span />
          </AllayLoader>
        </div>
      </div>
    </>
  );
}

/** 一个组：吸顶的段头（组名、数量）加两列卡片 */
function Section({ group, count, header, children }: { group: LibraryGroup; count: number; header: boolean; children: React.ReactNode }) {
  const { t } = useTranslation();
  const id = `gallery-section-${group}`;
  return (
    <section aria-labelledby={header ? id : undefined} data-testid={id}>
      {header && (
        <h3 id={id} className="gallery-section-head sticky top-0 z-[1] flex h-8 items-center gap-2 bg-surface-1 px-3.5 text-sm font-semibold text-foreground">
          <span className="truncate">{t(`gallery.groups.${group}`)}</span>
          <span className="num text-xs font-normal text-fg-subtle">{count}</span>
          <span className="gallery-section-rule pointer-events-none absolute inset-x-0 bottom-0 h-px bg-divider" aria-hidden="true" />
        </h3>
      )}
      <div className={`grid grid-cols-2 gap-x-2.5 gap-y-3 px-3 ${header ? 'pb-2' : 'pt-1 pb-2'}`}>{children}</div>
    </section>
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

/** 模板页：搜索框（展开时）、筛选、按组分段的缩略图网格 */
export function TemplatesTab() {
  const { t } = useTranslation();
  const searchOpen = useUiStore((s) => s.searchOpen);
  const query = useUiStore((s) => s.galleryQuery);
  const setQuery = (galleryQuery: string) => useUiStore.setState({ galleryQuery });
  const showSearch = searchOpen || query !== '';
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-1.5">
      {showSearch && (
        <div className="relative mx-2.5">
          <MagnifyingGlass size={ICON.sm} className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-fg-subtle" aria-hidden="true" />
          <Input
            id="gallery-search"
            value={query}
            onChange={(e) => setQuery(e.currentTarget.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape' && query === '') useUiStore.setState({ searchOpen: false });
              // 下方向键：到结果的第一张卡片（之后用方向键在卡片间走）
              if (e.key === 'ArrowDown') {
                const first = document.querySelector<HTMLButtonElement>('[data-testid="template-list"] [data-card-key] button:not([disabled])');
                if (first) {
                  e.preventDefault();
                  first.focus();
                }
              }
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
