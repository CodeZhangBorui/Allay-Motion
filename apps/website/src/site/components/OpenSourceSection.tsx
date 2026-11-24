// 开源一节：GPL-3.0 源代码链接与真实自托管开发者头像。
import { buttonVariants } from '@allay/ui/components/button';
import { ArrowUpRight, GithubLogo } from '@phosphor-icons/react';
import type { CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';
import { DEVELOPERS, LICENSE_NAME, REPO_URL, SECTION } from '../links';
import { useReveal } from '../motion/interactions';

function Avatar({ src, name }: { src: string; name: string }) {
  return (
    <img
      src={src}
      alt=""
      width={64}
      height={64}
      loading="lazy"
      decoding="async"
      className="size-16 shrink-0 rounded-[18px] bg-control object-cover ring-1 ring-[color-mix(in_srgb,var(--foreground)_14%,transparent)] transition-transform duration-500 ease-(--ease-expo) group-hover:scale-105 group-hover:-rotate-3"
      data-testid="avatar"
      data-name={name}
    />
  );
}

export function OpenSourceSection() {
  const { t } = useTranslation();
  const left = useReveal<HTMLDivElement>();
  const right = useReveal<HTMLDivElement>(0.15);

  return (
    <section id={SECTION.open} aria-labelledby="open-title" className="relative border-t border-[var(--site-line)] py-20 lg:py-28">
      <div className="wrap grid gap-12 lg:grid-cols-[1.15fr_1fr] lg:gap-20">
        <div ref={left} className="reveal">
          <p className="t-mono text-fg-subtle">{t('site.open.kicker')}</p>
          <h2 id="open-title" className="t-h2 mt-3 max-w-[11em]">
            {t('site.open.title')}
          </h2>
          <p className="t-lead mt-5 max-w-[30em]">{t('site.open.lead')}</p>
          <div className="mt-8 flex flex-wrap items-center gap-5">
            <a href={REPO_URL} target="_blank" rel="noreferrer noopener" className={buttonVariants({ size: 'lg' })} data-testid="cta-repo">
              <GithubLogo size={16} weight="fill" />
              {t('site.open.repo')}
            </a>
            <span className="t-mono text-[11px] text-fg-subtle">
              {t('site.open.license')} · {LICENSE_NAME}
            </span>
          </div>
        </div>

        <div ref={right} className="reveal">
          <p className="t-mono text-primary-text">{t('site.open.credits')}</p>
          <p className="t-mono mt-5 text-[10.5px] text-fg-subtle">{t('site.open.developersLabel')}</p>
          <ul className="mt-3 divide-y divide-[var(--site-line)] border-y border-[var(--site-line)]" data-testid="team">
            {DEVELOPERS.map((d, i) => {
              const body = (
                <>
                  <Avatar src={d.avatar} name={d.name} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[clamp(20px,2vw,28px)] font-semibold tracking-[-0.03em]">{d.name}</span>
                    {d.url && <span className="t-mono mt-1 block truncate text-[10.5px] text-fg-subtle">{d.url.replace('https://', '')}</span>}
                  </span>
                  {d.url && <ArrowUpRight size={20} className="shrink-0 text-fg-faint transition-[color,transform] duration-300 group-hover:translate-x-0.5 group-hover:-translate-y-0.5 group-hover:text-primary-text" />}
                </>
              );
              return (
                <li key={d.name} style={{ '--i': i } as CSSProperties}>
                  {d.url ? (
                    <a href={d.url} target="_blank" rel="noreferrer noopener" className="group link-focus flex items-center gap-5 rounded-lg py-4">
                      {body}
                    </a>
                  ) : (
                    <div className="group flex items-center gap-5 py-4">{body}</div>
                  )}
                </li>
              );
            })}
          </ul>
          <p className="mt-4 text-[12px] text-fg-subtle">{t('site.open.claudeNote')}</p>
        </div>
      </div>
    </section>
  );
}
