import { buttonVariants } from '@allay/ui/components/button';
import { ArrowDown, GithubLogo } from '@phosphor-icons/react';
import { useTranslation } from 'react-i18next';
import { REPO_URL, SECTION } from '../links';
import { PixelReveal } from '../motion/PixelReveal';
import { LiveViewer } from './LiveViewer';

export function Hero() {
  const { t } = useTranslation();
  const name = t('brand.name');
  return (
    <section id="top" className="bg-site pt-16 pb-10 sm:pt-24">
      <div className="site-container">
        <div className="mx-auto max-w-[920px] text-center">
          <p className="site-kicker site-rise">{t('site.hero.eyebrow')}</p>
          <PixelReveal bg="--site-bg" immediate delay={120} duration={900} cell={12} className="mt-5">
            <h1 className="site-display">
              <span className="block">{t('site.hero.titleA')}</span>
              <span className="block text-fg-muted">{t('site.hero.titleB')}</span>
            </h1>
          </PixelReveal>
          <p className="site-lead site-rise mx-auto mt-6 max-w-[640px]" style={{ animationDelay: '380ms' }}>
            {t('site.hero.lead', { name })}
          </p>
          <div className="site-rise mt-8 flex flex-wrap items-center justify-center gap-3" style={{ animationDelay: '480ms' }}>
            <a href={REPO_URL} target="_blank" rel="noreferrer noopener" className={buttonVariants({ className: 'site-btn' })} data-testid="cta-github">
              <GithubLogo size={18} weight="fill" />
              {t('site.hero.primary')}
            </a>
            <a href={`#${SECTION.try}`} className={buttonVariants({ variant: 'secondary', className: 'site-btn' })} data-testid="cta-try">
              {t('site.hero.secondary')}
              <ArrowDown size={16} />
            </a>
          </div>
          <p className="site-rise mt-5 text-[12.5px] text-fg-subtle" style={{ animationDelay: '560ms' }}>
            {t('site.hero.facts')}
          </p>
        </div>

        <PixelReveal bg="--site-bg" variant="wipe" immediate delay={420} duration={1100} cell={32} className="mx-auto mt-14 max-w-[1040px]">
          <LiveViewer autoCycle testId="hero-viewer" />
        </PixelReveal>
        <p className="mt-4 text-center text-[12.5px] text-fg-subtle">{t('site.hero.viewerNote')}</p>
      </div>
    </section>
  );
}
