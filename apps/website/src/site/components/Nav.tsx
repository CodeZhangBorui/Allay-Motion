import { AllayHead } from '@allay/mascot';
import { Button, buttonVariants } from '@allay/ui/components/button';
import { GithubLogo, Moon, Sun } from '@phosphor-icons/react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { REPO_URL, SECTION } from '../links';
import { setLanguage, setTheme, usePrefs } from '../prefs';

export function Nav() {
  const { t } = useTranslation();
  const prefs = usePrefs();
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  const links: [string, string][] = [
    [SECTION.try, t('site.nav.try')],
    [SECTION.templates, t('site.nav.templates')],
    [SECTION.features, t('site.nav.features')],
    [SECTION.workflow, t('site.nav.workflow')],
    [SECTION.open, t('site.nav.openSource')],
  ];
  const nextLang = prefs.language === 'zh-CN' ? 'en' : 'zh-CN';

  return (
    <header
      data-testid="site-nav"
      className="sticky top-0 z-40 bg-site transition-[box-shadow] duration-(--dur-2)"
      style={{ boxShadow: scrolled ? '0 1px 0 var(--site-line)' : undefined }}
    >
      <div className="site-container flex h-14 items-center gap-3">
        <a href="#top" className="flex items-center gap-2 rounded-md" aria-label={t('site.nav.home')}>
          <AllayHead size={22} label={t('brand.name')} />
          <span className="text-[14.5px] font-semibold tracking-[-0.01em]">{t('brand.wordmark')}</span>
        </a>
        <nav aria-label={t('site.nav.label')} className="ml-6 hidden items-center gap-1 md:flex">
          {links.map(([id, label]) => (
            <a key={id} href={`#${id}`} className="rounded-md px-2.5 py-1.5 text-[13.5px] text-fg-muted transition-colors duration-(--dur-1) hover:bg-control hover:text-foreground">
              {label}
            </a>
          ))}
        </nav>
        <div className="ml-auto flex items-center gap-1">
          <Button
            variant="ghost"
            className="h-8 px-2.5 text-[13px]"
            data-testid="toggle-language"
            aria-label={t('site.nav.switchLanguage')}
            title={t('site.nav.switchLanguage')}
            lang={nextLang}
            onClick={() => setLanguage(nextLang)}
          >
            {nextLang === 'en' ? 'EN' : '中文'}
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="size-8"
            data-testid="toggle-theme"
            aria-label={prefs.theme === 'dark' ? t('site.nav.toLight') : t('site.nav.toDark')}
            title={prefs.theme === 'dark' ? t('site.nav.toLight') : t('site.nav.toDark')}
            onClick={() => setTheme(prefs.theme === 'dark' ? 'light' : 'dark')}
          >
            {prefs.theme === 'dark' ? <Sun size={17} /> : <Moon size={17} />}
          </Button>
          <a href={REPO_URL} target="_blank" rel="noreferrer noopener" className={buttonVariants({ variant: 'secondary', className: 'ml-1 h-8 gap-1.5 px-3 text-[13px]' })}>
            <GithubLogo size={16} weight="fill" />
            <span className="hidden sm:inline">{t('site.nav.github')}</span>
          </a>
        </div>
      </div>
    </header>
  );
}
