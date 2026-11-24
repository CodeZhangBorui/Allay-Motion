// 模板精选一节：展示固定 5 个精选模板（封面网格由单个临时导出 Worker 顺序渲染并释放），点击可直接载入首屏预览。
import { localize } from '@allay/template-sdk';
import { buttonVariants } from '@allay/ui/components/button';
import { Badge, Skeleton } from '@allay/ui/components/misc';
import { ArrowUpRight, Play, Plus } from '@phosphor-icons/react';
import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';
import { defaultDuration, showcaseEntries, type SiteTemplateEntry } from '../../host/templates';
import { COVER_H, COVER_W, drawCoverSlot, nextCoverSlot, useShowcaseCovers, type ShowcaseCover } from '../engine/covers';
import { REPO_URL, SECTION } from '../links';
import { useReveal } from '../motion/interactions';
import { usePrefs } from '../prefs';

export const SHOWCASE_MAX = 5;
export const AUTHORING_URL = `${REPO_URL}/blob/main/docs/template-authoring.md`;

/** 封面帧绘制：静态默认停在代表帧 posterSlot，悬停或聚焦卡片时播放帧网格循环 */
function SheetPlayer({ cover, label, playing }: { cover: ShowcaseCover; label: string; playing: boolean }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const { reducedMotion } = usePrefs();

  useEffect(() => {
    const canvas = ref.current;
    const sheet = cover.sheet;
    if (!canvas || !sheet || cover.frames <= 0 || reducedMotion) return;
    const g = canvas.getContext('2d');
    if (!g) return;
    drawCoverSlot(g, cover, cover.posterSlot);
    if (!playing) return;
    let raf = 0;
    let start = 0;
    let last = cover.posterSlot;
    const draw = (now: number) => {
      raf = requestAnimationFrame(draw);
      start ||= now;
      const i = nextCoverSlot(cover, (now - start) / 1000);
      if (i === last) return;
      last = i;
      drawCoverSlot(g, cover, i);
    };
    raf = requestAnimationFrame(draw);
    return () => {
      if (raf !== 0) cancelAnimationFrame(raf);
    };
  }, [cover, playing, reducedMotion]);

  if (reducedMotion) {
    return <img src={cover.url} alt={label} className="pointer-events-none absolute inset-0 size-full object-cover" draggable={false} />;
  }
  return (
    <canvas
      ref={ref}
      width={COVER_W}
      height={COVER_H}
      className="pointer-events-none absolute inset-0 size-full object-cover"
      role="img"
      aria-label={label}
      data-testid="template-sheet"
    />
  );
}

function Tile({
  entry,
  cover,
  featured,
  wideCover = false,
  onPreview,
}: {
  entry: SiteTemplateEntry;
  cover: ShowcaseCover | null | undefined;
  featured: boolean;
  wideCover?: boolean;
  onPreview: (id: string) => void;
}) {
  const { t } = useTranslation();
  const { language } = usePrefs();
  const [hovering, setHovering] = useState(false);
  const m = entry.manifest;
  const name = localize(m.name, language);
  const duration = defaultDuration(m);
  const category = t(`site.categories.${m.category}`);

  return (
    <article
      className="card hoverable group flex h-full flex-col p-2"
      data-testid="template-card"
      data-template={entry.id}
      onPointerEnter={() => setHovering(true)}
      onPointerLeave={() => setHovering(false)}
      onFocus={() => setHovering(true)}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget)) setHovering(false);
      }}
    >
      <div className={`preview-checker relative overflow-hidden rounded-md ${wideCover ? 'aspect-video lg:aspect-[2/1]' : 'aspect-video'}`}>
        <div className="absolute inset-0 transition-transform duration-500 ease-(--ease-expo) group-hover:scale-[1.03]">
          {cover ? (
            <SheetPlayer cover={cover} label={name} playing={hovering} />
          ) : cover === null ? (
            <div className="flex size-full items-center justify-center p-4 text-center text-[12px] text-fg-subtle">{t('site.templates.failed')}</div>
          ) : (
            <div className="size-full" aria-busy="true" aria-label={t('site.templates.rendering')} role="img">
              <Skeleton className="size-full rounded-none" />
            </div>
          )}
        </div>
      </div>

      <div className={`flex flex-1 flex-col justify-end ${featured ? 'px-4 pt-5 pb-4 sm:px-5' : 'px-3 pt-4 pb-3'}`}>
        <div className="flex items-center gap-2.5">
          {featured && <Badge className="text-primary-text">{t('site.templates.featured')}</Badge>}
          <span className="t-mono text-[10.5px] text-fg-subtle">
            {duration !== null ? t('site.templates.meta', { category, duration: duration.toFixed(2) }) : t('site.templates.metaNoDuration', { category })}
          </span>
        </div>
        <div className="mt-2.5 flex items-end justify-between gap-3">
          <div className="min-w-0">
            <h3 className={featured ? 't-h2 !text-[clamp(26px,2.4vw,38px)]' : 't-h3'}>{name}</h3>
            {m.description && <p className={`t-body mt-1.5 ${featured ? 'max-w-[34em]' : 'line-clamp-2 !text-[13.5px]'}`}>{localize(m.description, language)}</p>}
          </div>
          <button
            type="button"
            onClick={() => onPreview(entry.id)}
            className={buttonVariants({ variant: 'secondary', size: 'icon' })}
            data-testid="template-open"
            aria-label={`${t('site.templates.preview')}：${name}`}
            title={t('site.templates.preview')}
          >
            <Play size={14} weight="fill" />
          </button>
        </div>
        {featured && (
          <ul className="mt-4 flex flex-wrap gap-1.5" aria-label={t('site.templates.params')}>
            {(m.params ?? [])
              .filter((p) => p.group !== 'sound' && p.type !== 'seed')
              .slice(0, 8)
              .map((p) => (
                <li key={p.key}>
                  <Badge>{localize(p.label, language)}</Badge>
                </li>
              ))}
          </ul>
        )}
      </div>
    </article>
  );
}

function MoreTile() {
  const { t } = useTranslation();
  return (
    <a href={AUTHORING_URL} target="_blank" rel="noreferrer noopener" className="card group link-focus relative flex h-full min-h-[240px] flex-col justify-between overflow-hidden p-6" data-testid="templates-more">
      <div className="pointer-events-none absolute inset-0 bg-grid fade-mask opacity-60" aria-hidden="true" />
      <span className="relative flex size-9 items-center justify-center rounded-lg bg-control text-fg-muted transition-transform duration-500 ease-(--ease-expo) group-hover:rotate-90">
        <Plus size={18} weight="bold" />
      </span>
      <div className="relative">
        <h3 className="t-h3">{t('site.templates.moreTitle')}</h3>
        <p className="t-body mt-2 !text-[14px]">{t('site.templates.moreBody')}</p>
        <span className="mt-4 inline-flex items-center gap-1.5 text-[14px] font-medium text-primary-text">
          {t('site.templates.moreLink')}
          <ArrowUpRight size={15} className="transition-transform duration-300 group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
        </span>
      </div>
    </a>
  );
}

export function TemplatesSection({ onPreview }: { onPreview: (id: string) => void }) {
  const { t } = useTranslation();
  const { language } = usePrefs();
  const shown = useMemo(() => showcaseEntries().slice(0, SHOWCASE_MAX), []);
  const covers = useShowcaseCovers(language);
  const head = useReveal<HTMLDivElement>();
  const gridReveal = useReveal<HTMLDivElement>(0.08);
  const spans = ['sm:col-span-2 lg:col-span-8 lg:row-span-2', 'lg:col-span-4', 'lg:col-span-4', 'lg:col-span-4', 'lg:col-span-4'];

  return (
    <section id={SECTION.templates} aria-labelledby="templates-title" className="relative border-t border-[var(--site-line)] py-20 lg:py-28">
      <div className="wrap relative">
        <div ref={head} className="reveal grid items-end gap-6 lg:grid-cols-[1.15fr_1fr] lg:gap-16">
          <div>
            <p className="t-mono text-fg-subtle">{t('site.templates.kicker')}</p>
            <h2 id="templates-title" className="t-h2 mt-3">
              {t('site.templates.title')}
            </h2>
          </div>
          <p className="t-lead max-w-[34em]">{t('site.templates.lead')}</p>
        </div>

        <div ref={gridReveal} className="reveal mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-12 lg:gap-5">
          {shown.map((e, i) => (
            <div key={e.id} className={spans[i] ?? 'lg:col-span-4'} style={{ '--i': i } as CSSProperties}>
              <Tile entry={e} cover={covers[e.id]} featured={i === 0} wideCover={i === 1 || i === 2} onPreview={onPreview} />
            </div>
          ))}
          <div className="lg:col-span-4" style={{ '--i': shown.length } as CSSProperties}>
            <MoreTile />
          </div>
        </div>
      </div>
    </section>
  );
}
