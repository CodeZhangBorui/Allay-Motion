import { Allay } from '@allay/mascot';
import { buttonVariants } from '@allay/ui/components/button';
import { ArrowSquareOut, GithubLogo } from '@phosphor-icons/react';
import { useTranslation } from 'react-i18next';
import { DEVELOPERS, LICENSE_NAME, REPO_URL, SECTION } from '../links';
import { Section, SectionHead } from './Section';

/** 真实头像（GitHub 头像，下载后自托管；三张都是 256×256，显示 40 px，高分屏也清楚） */
function Avatar({ src, name }: { src: string; name: string }) {
  return <img src={src} alt="" width={40} height={40} loading="lazy" decoding="async" className="size-10 shrink-0 rounded-full bg-control object-cover ring-1 ring-[color-mix(in_srgb,var(--foreground)_12%,transparent)]" data-testid="avatar" data-name={name} />;
}

export function OpenSourceSection() {
  const { t } = useTranslation();
  return (
    <Section id={SECTION.open} label={`05  ${t('site.open.kicker')}`}>
      <div className="grid items-start gap-12 lg:grid-cols-[1.1fr_1fr]">
        <div>
          <SectionHead kicker={t('site.open.kicker')} title={t('site.open.title')} lead={t('site.open.lead')} />
          <div className="mt-8 flex flex-wrap items-center gap-3">
            <a href={REPO_URL} target="_blank" rel="noreferrer noopener" className={buttonVariants({ className: 'site-btn' })} data-testid="cta-repo">
              <GithubLogo size={18} weight="fill" />
              {t('site.open.repo')}
            </a>
            <span className="num text-[13px] text-fg-subtle">
              {t('site.open.license')} · {LICENSE_NAME}
            </span>
          </div>
        </div>

        <div className="site-card relative p-6 sm:p-7">
          {/* 悦灵只在这里出现一只（全页面同一时刻最多一只全身像，docs/07-allay-mascot.md 7.2），安静地悬停 */}
          <div className="pointer-events-none absolute -top-12 right-6" aria-hidden="true">
            <Allay clip="hover" size={64} facing="left" priority="empty" />
          </div>
          <p className="site-kicker">{t('site.open.team')}</p>
          <ul className="mt-4 divide-y divide-site-line" data-testid="team">
            {DEVELOPERS.map((d) => (
              <li key={d.name} className="flex items-center gap-3 py-3">
                <Avatar src={d.avatar} name={d.name} />
                <span className="text-[14.5px] font-medium">{d.name}</span>
                {d.url && (
                  <a href={d.url} target="_blank" rel="noreferrer noopener" className="ml-auto inline-flex items-center gap-1 rounded-md text-[12.5px] text-fg-muted hover:text-foreground">
                    {d.url.replace('https://', '')}
                    <ArrowSquareOut size={13} />
                  </a>
                )}
              </li>
            ))}
          </ul>
        </div>
      </div>
    </Section>
  );
}
