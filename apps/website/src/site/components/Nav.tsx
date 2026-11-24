// 导航栏：粘滞顶栏，IntersectionObserver 跟踪当前所在段落，滚动时在底部更新细进度条（无常驻 rAF 空转）。
import { AllayHead } from '@allay/mascot';
import { Button, buttonVariants } from '@allay/ui/components/button';
import { GithubLogo, Moon, Sun } from '@phosphor-icons/react';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { REPO_URL, SECTION } from '../links';
import { setLanguage, setTheme, usePrefs } from '../prefs';

const NAV_ITEMS = [
  { id: SECTION.workflow, key: 'workflow' },
  { id: SECTION.templates, key: 'templates' },
  { id: SECTION.features, key: 'features' },
  { id: SECTION.open, key: 'openSource' },
] as const;

export function Nav() {
  const { t } = useTranslation();
  const prefs = usePrefs();
  const [active, setActive] = useState<string>(SECTION.top);
  const progressRef = useRef<HTMLDivElement>(null);

  // 用 IntersectionObserver 跟踪当前所在段落，不在帧循环里轮询布局
  useEffect(() => {
    const ids = [SECTION.top, ...NAV_ITEMS.map((item) => item.id)];
    const els = ids.map((id) => document.getElementById(id)).filter((el): el is HTMLElement => el !== null);
    if (els.length === 0) return;

    const visible = new Map<string, number>();
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) visible.set(e.target.id, e.intersectionRatio);
          else visible.delete(e.target.id);
        }
        if (visible.size === 0) return;
        let bestId: string = ids[0]!;
        let bestRatio = -1;
        for (const [id, ratio] of visible) {
          if (ratio > bestRatio) {
            bestRatio = ratio;
            bestId = id;
          }
        }
        setActive(bestId);
      },
      { rootMargin: '-20% 0px -55% 0px', threshold: [0, 0.1, 0.25, 0.5, 0.75, 1] },
    );
    for (const el of els) io.observe(el);
    return () => io.disconnect();
  }, []);

  // 仅在 scroll / resize 时合并一帧更新底部进度条，停下来即零 CPU 消耗
  useEffect(() => {
    let raf = 0;
    const paint = () => {
      raf = 0;
      const bar = progressRef.current;
      if (!bar) return;
      const max = Math.max(1, document.documentElement.scrollHeight - window.innerHeight);
      const p = Math.min(1, Math.max(0, window.scrollY / max));
      bar.style.transform = `scaleX(${p.toFixed(4)})`;
    };
    const schedule = () => {
      if (raf === 0) raf = requestAnimationFrame(paint);
    };
    paint();
    window.addEventListener('scroll', schedule, { passive: true });
    window.addEventListener('resize', schedule, { passive: true });
    return () => {
      if (raf !== 0) cancelAnimationFrame(raf);
      window.removeEventListener('scroll', schedule);
      window.removeEventListener('resize', schedule);
    };
  }, []);

  const nextLang = prefs.language === 'zh-CN' ? 'en' : 'zh-CN';

  return (
    <header data-testid="site-nav" className="nav-bar fixed inset-x-0 top-0 z-50">
      <div className="wrap flex h-[var(--nav-h)] items-center gap-3 sm:gap-5">
        <a href={`#${SECTION.top}`} className="link-focus flex shrink-0 items-center gap-2.5 rounded-md" aria-label={t('site.nav.home')}>
          <AllayHead size={24} label={t('brand.name')} />
          <span className="text-[15px] font-semibold tracking-[-0.02em]">{t('brand.wordmark')}</span>
        </a>

        <nav aria-label={t('site.nav.label')} className="hidden min-w-0 flex-1 items-center gap-1 md:flex">
          {NAV_ITEMS.map((item) => {
            const isCurrent = active === item.id;
            return (
              <a
                key={item.id}
                href={`#${item.id}`}
                data-current={isCurrent}
                aria-current={isCurrent ? 'location' : undefined}
                className="nav-link link-focus rounded-md px-2.5 py-1.5 text-[13.5px] font-medium whitespace-nowrap"
              >
                {t(`site.nav.${item.key}`)}
              </a>
            );
          })}
        </nav>

        <div className="ml-auto flex shrink-0 items-center gap-1">
          <Button
            variant="ghost"
            size="lg"
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
            data-testid="toggle-theme"
            aria-label={prefs.theme === 'dark' ? t('site.nav.toLight') : t('site.nav.toDark')}
            title={prefs.theme === 'dark' ? t('site.nav.toLight') : t('site.nav.toDark')}
            onClick={() => setTheme(prefs.theme === 'dark' ? 'light' : 'dark')}
          >
            {prefs.theme === 'dark' ? <Sun size={16} /> : <Moon size={16} />}
          </Button>
          <a href={REPO_URL} target="_blank" rel="noreferrer noopener" className={buttonVariants({ variant: 'secondary', size: 'lg', className: 'ml-1' })}>
            <GithubLogo size={15} weight="fill" />
            <span className="hidden sm:inline">{t('site.nav.github')}</span>
          </a>
        </div>
      </div>

      {/* 窄屏导航条：不挤占首行，横向溢出仅限条内 */}
      <nav aria-label={t('site.nav.label')} className="site-scroll-x flex items-center gap-1 overflow-x-auto border-t border-[var(--site-line)] px-[var(--gutter)] py-1 md:hidden">
        {NAV_ITEMS.map((item) => {
          const isCurrent = active === item.id;
          return (
            <a
              key={item.id}
              href={`#${item.id}`}
              data-current={isCurrent}
              aria-current={isCurrent ? 'location' : undefined}
              className="nav-link link-focus shrink-0 rounded-md px-2.5 py-1 text-[12.5px] font-medium whitespace-nowrap"
            >
              {t(`site.nav.${item.key}`)}
            </a>
          );
        })}
      </nav>

      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-[2px]" aria-hidden="true">
        <div ref={progressRef} className="h-full origin-left bg-primary" style={{ transform: 'scaleX(0)' }} />
      </div>
    </header>
  );
}
