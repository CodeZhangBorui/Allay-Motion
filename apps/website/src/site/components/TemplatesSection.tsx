// 模板一节：卡片列表由内置模板的 manifest 推导（名称、说明、分类、默认时长、参数个数），
// 封面和循环播放的帧来自桌面版模板库同一个封面服务（features/gallery/covers.ts：杂务引擎 Worker，320×180、30 fps）。
// packages/templates 下多一个模板，这里就多一张卡片。
import { localize } from '@allay/template-sdk';
import { ArrowRight } from '@phosphor-icons/react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Cover } from '../../../../desktop/src/renderer/features/gallery/covers';
import type { TemplateEntry } from '../../../../desktop/src/shared/templates';
import { builtinEntries, defaultDuration } from '../../host/templates';
import { SECTION } from '../links';
import { usePrefs } from '../prefs';
import { AllayLoader } from '@allay/mascot';
import { BlockSkeleton } from '../motion/BlockSkeleton';
import { PixelReveal } from '../motion/PixelReveal';
import { Section, SectionHead } from './Section';
import { requestOpenTemplate } from './SimulatorSection';

type CoverMap = Record<string, Cover | null>;

const COVER_W = 320;
const COVER_H = 180;
const COVER_FPS = 30;

function useCovers(entries: TemplateEntry[], anchor: React.RefObject<HTMLElement | null>): { covers: CoverMap; keyOf: (e: TemplateEntry) => string } {
  const [covers, setCovers] = useState<CoverMap>({});
  const [keyOf, setKeyOf] = useState<(e: TemplateEntry) => string>(() => () => '');
  useEffect(() => {
    const el = anchor.current;
    if (!el) return;
    let off: (() => void) | null = null;
    let alive = true;
    let started = false;
    let idle = 0;
    let timer = 0;
    const start = () => {
      if (started) return;
      started = true;
      io.disconnect();
      void (async () => {
        const rt = await import('../engine/runtime');
        await rt.ensureRuntime();
        if (!alive) return;
        setKeyOf(() => (e: TemplateEntry) => rt.coverKey(e.id, e.version));
        setCovers(rt.useCoverStore.getState().covers);
        off = rt.useCoverStore.subscribe((s) => setCovers(s.covers));
        if (rt.hasWebgl2()) rt.covers.ensure(entries);
      })();
    };
    // 不等滚到这里：页面空闲下来就开始渲染（杂务 Worker 一个模板一个模板地排队，不和首屏抢），
    // 访客滚到这里时多半已经好了；滚得快的话，离视口 1200 px 时也会开始
    const io = new IntersectionObserver((es) => es.some((e) => e.isIntersecting) && start(), { rootMargin: '1200px 0px' });
    io.observe(el);
    const onLoad = () => {
      timer = window.setTimeout(() => {
        if ('requestIdleCallback' in window) idle = window.requestIdleCallback(start, { timeout: 2500 });
        else start();
      }, 800);
    };
    if (document.readyState === 'complete') onLoad();
    else window.addEventListener('load', onLoad, { once: true });
    return () => {
      alive = false;
      io.disconnect();
      window.removeEventListener('load', onLoad);
      window.clearTimeout(timer);
      if (idle) window.cancelIdleCallback(idle);
      off?.();
    };
  }, [entries, anchor]);
  return { covers, keyOf };
}

/** 一张卡片里的循环播放：把帧网格图一格一格画到小画布上（和模板库悬停预览同一个做法） */
function SheetPlayer({ cover, label }: { cover: Cover; label: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const { reducedMotion } = usePrefs();
  useEffect(() => {
    const canvas = ref.current;
    const sheet = cover.sheet;
    if (!canvas || !sheet || cover.frames <= 0 || reducedMotion) return;
    const g = canvas.getContext('2d');
    if (!g) return;
    let raf = 0;
    let visible = false;
    let start = 0;
    let last = -1;
    const draw = (now: number) => {
      raf = requestAnimationFrame(draw);
      if (!visible) return;
      start ||= now;
      // 片尾停 0.4 秒再循环
      const span = cover.frames + Math.round(COVER_FPS * 0.4);
      const f = Math.floor(((now - start) / 1000) * COVER_FPS) % span;
      const i = Math.min(cover.frames - 1, f);
      if (i === last) return;
      last = i;
      g.clearRect(0, 0, COVER_W, COVER_H);
      g.drawImage(sheet, (i % cover.cols) * COVER_W, Math.floor(i / cover.cols) * COVER_H, COVER_W, COVER_H, 0, 0, COVER_W, COVER_H);
    };
    const io = new IntersectionObserver((es) => (visible = es.some((e) => e.isIntersecting)));
    io.observe(canvas);
    raf = requestAnimationFrame(draw);
    return () => {
      io.disconnect();
      cancelAnimationFrame(raf);
    };
  }, [cover, reducedMotion]);
  return (
    <>
      <img src={cover.url} alt={label} className="absolute inset-0 size-full object-cover" draggable={false} />
      {cover.sheet && !reducedMotion && <canvas ref={ref} width={COVER_W} height={COVER_H} className="absolute inset-0 size-full" aria-hidden="true" data-testid="template-sheet" />}
    </>
  );
}

function TemplateCardBig({ entry, cover, pending }: { entry: TemplateEntry; cover: Cover | null | undefined; pending: boolean }) {
  const { t } = useTranslation();
  const { language } = usePrefs();
  const m = entry.manifest;
  const name = localize(m.name, language);
  const duration = defaultDuration(m);
  const category = t(`gallery.categories.${m.category}`);
  const visibleParams = m.params?.length ?? 0;
  return (
    <article
      className="site-card site-lift group flex h-full flex-col overflow-hidden"
      data-testid="template-card"
      data-template={entry.id}
    >
      <div className="p-2">
        <div className="preview-checker relative aspect-video overflow-hidden rounded-[9px]">
          <div className="absolute inset-0 transition-transform duration-[600ms] ease-(--ease-out) group-hover:scale-[1.04]">
            {cover ? (
              // 封面到了：从骨架像素溶解到真实的帧
              <PixelReveal bg="--skeleton" variant="dissolve" immediate cell={12} duration={520} className="absolute inset-0">
                <SheetPlayer cover={cover} label={name} />
              </PixelReveal>
            ) : cover === null ? (
              <div className="absolute inset-0 flex items-center justify-center text-[12px] text-fg-subtle">{t('site.templates.failed')}</div>
            ) : (
              <div className="absolute inset-0" aria-busy={pending} aria-label={t('site.templates.rendering')} role="img">
                <BlockSkeleton className="absolute inset-0 size-full" />
              </div>
            )}
          </div>
        </div>
      </div>
      <div className="flex flex-1 flex-col px-5 pt-3 pb-5">
        <div className="flex items-baseline justify-between gap-3">
          <h3 className="site-h3">{name}</h3>
          <span className="num shrink-0 text-[12px] text-fg-subtle">
            {duration !== null ? t('site.templates.meta', { category, duration: duration.toFixed(2), count: visibleParams }) : t('site.templates.metaNoDuration', { category, count: visibleParams })}
          </span>
        </div>
        {m.description && <p className="site-body mt-2 flex-1">{localize(m.description, language)}</p>}
        <button
          type="button"
          onClick={() => requestOpenTemplate(entry.id, entry.version)}
          className="mt-4 inline-flex w-fit items-center gap-1.5 rounded-md text-[13px] font-medium text-primary-text"
          data-testid="template-open"
        >
          {t('site.templates.openInSim')}
          <ArrowRight size={14} className="transition-transform duration-(--dur-2) ease-(--ease-out) group-hover:translate-x-1" />
        </button>
      </div>
    </article>
  );
}

export function TemplatesSection() {
  const { t } = useTranslation();
  const entries = useMemo(() => builtinEntries(), []);
  const grid = useRef<HTMLDivElement>(null);
  const { covers, keyOf } = useCovers(entries, grid);
  const pendingCount = entries.filter((e) => {
    const k = keyOf(e);
    return !k || !(k in covers);
  }).length;
  return (
    <Section id={SECTION.templates} tone="alt" label={`02  ${t('site.templates.kicker')}`}>
      <SectionHead tone="alt" kicker={t('site.templates.kicker')} title={t('site.templates.title', { count: entries.length })} lead={t('site.templates.lead')} />
      <div ref={grid} className="relative mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <div className="pointer-events-none absolute inset-0 z-10" aria-hidden={pendingCount === 0}>
          <AllayLoader loading={pendingCount > 0} label={t('site.templates.rendering')} priority="gallery" className="size-full">
            <div />
          </AllayLoader>
        </div>
        {entries.map((e, i) => {
          const key = keyOf(e);
          return (
            <PixelReveal key={e.id} bg="--site-alt" variant="wipe" cell={28} delay={(i % 3) * 90} duration={800}>
              <TemplateCardBig entry={e} cover={key ? covers[key] : undefined} pending={!key || !(key in covers)} />
            </PixelReveal>
          );
        })}
      </div>
    </Section>
  );
}
