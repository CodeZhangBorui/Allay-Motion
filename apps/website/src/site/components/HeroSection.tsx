// 首屏：标准流两栏布局（桌面左右并排，窄屏上下堆叠），标题立即清晰可见，右侧面板直接可点可拖。
import { buttonVariants } from '@allay/ui/components/button';
import { ArrowDown, GithubLogo } from '@phosphor-icons/react';
import { useTranslation } from 'react-i18next';
import { REPO_URL, SECTION } from '../links';
import { LiveViewer } from './LiveViewer';

export function HeroSection({ requestPick }: { requestPick: { id: string; seq: number } | null }) {
  const { t } = useTranslation();
  const name = t('brand.name');

  return (
    <section id={SECTION.top} aria-labelledby="hero-title" className="relative overflow-hidden pt-[calc(var(--nav-h)+68px)] pb-20 md:pt-[calc(var(--nav-h)+56px)] lg:pb-28">
      <div className="pointer-events-none absolute inset-0 bg-dots fade-mask opacity-55" aria-hidden="true" />
      <div className="wrap relative grid items-center gap-10 lg:grid-cols-[minmax(0,0.95fr)_minmax(0,1.15fr)] lg:gap-14">
        <div className="min-w-0">
          <p className="t-mono flex items-center gap-2.5 text-fg-muted">
            <span className="inline-block h-px w-8 bg-primary" aria-hidden="true" />
            {t('site.hero.eyebrow')}
          </p>
          <h1 id="hero-title" className="t-display mt-5 sm:mt-6">
            <span className="block">{t('site.hero.titleA')}</span>
            <span className="block">
              {t('site.hero.titleB')}
              <span className="accent inline-block whitespace-nowrap">{t('site.hero.titleC')}</span>
            </span>
          </h1>
          <p className="t-lead mt-6 max-w-[34em]">{t('site.hero.lead', { name })}</p>
          <div className="mt-8 flex flex-wrap items-center gap-3">
            <a href={REPO_URL} target="_blank" rel="noreferrer noopener" className={buttonVariants({ size: 'lg' })} data-testid="cta-github">
              <GithubLogo size={16} weight="fill" />
              {t('site.hero.primary')}
            </a>
            <a href={`#${SECTION.workflow}`} className={buttonVariants({ variant: 'secondary', size: 'lg' })} data-testid="cta-workflow">
              {t('site.hero.secondary')}
              <ArrowDown size={14} />
            </a>
          </div>
          <ul className="mt-7 flex flex-wrap gap-x-5 gap-y-2" aria-label={t('site.hero.factsLabel')}>
            {(t('site.hero.facts', { returnObjects: true }) as string[]).map((f) => (
              <li key={f} className="t-mono flex items-center gap-2 text-[11px] text-fg-subtle">
                <span className="size-1 rounded-full bg-fg-faint" aria-hidden="true" />
                {f}
              </li>
            ))}
          </ul>
        </div>

        <div className="min-w-0">
          <LiveViewer autoCycle scrubbable requestPick={requestPick} testId="hero-viewer" />
        </div>
      </div>
    </section>
  );
}
