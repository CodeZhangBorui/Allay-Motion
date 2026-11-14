import { buttonVariants } from '@allay/ui/components/button';
import { ArrowDown, GithubLogo } from '@phosphor-icons/react';
import { useTranslation } from 'react-i18next';
import { REPO_URL, SECTION } from '../links';
import { HeroField } from '../motion/HeroField';
import { PixelReveal } from '../motion/PixelReveal';
import { LiveViewer } from './LiveViewer';

export function Hero() {
  const { t } = useTranslation();
  const name = t('brand.name');
  return (
    <section id="top" data-scene="base" className="bg-site pt-16 pb-24 sm:pt-24">
      <div className="site-container">
        <div className="mx-auto max-w-[920px] text-center">
          <p className="site-kicker site-rise">{t('site.hero.eyebrow')}</p>
          {/* 标题由一次方块擦除揭出来（带一点阶段色），和产品的转场同一种语言 */}
          <PixelReveal bg="--site-bg" variant="wipe" accent immediate delay={60} duration={820} cell={14} className="mt-5">
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

        <div className="relative mx-auto mt-14 max-w-[1040px]">
          {/* 预览四周的方块场：跟着预览里正在播的模板一起进入、停留、退出 */}
          <HeroField className="pointer-events-none absolute -inset-x-[132px] -inset-y-[64px] hidden lg:block" />
          <PixelReveal bg="--site-bg" variant="wipe" accent immediate delay={380} duration={1000} cell={32} className="relative">
            <LiveViewer autoCycle publish testId="hero-viewer" />
          </PixelReveal>
        </div>
        <p className="mt-4 text-center text-[12.5px] text-fg-subtle">{t('site.hero.viewerNote')}</p>
      </div>
    </section>
  );
}
