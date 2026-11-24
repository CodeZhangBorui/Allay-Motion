import { ICON_DEFAULTS } from '@allay/ui/lib/icons';
import { IconContext } from '@phosphor-icons/react';
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FeaturesSection } from './components/FeaturesSection';
import { Footer } from './components/Footer';
import { HeroSection } from './components/HeroSection';
import { Nav } from './components/Nav';
import { OpenSourceSection } from './components/OpenSourceSection';
import { TemplatesSection } from './components/TemplatesSection';
import { WorkflowSection } from './components/WorkflowSection';
import { SECTION } from './links';
import { usePrefs } from './prefs';

/** 标题和描述跟着语言走 */
function useDocumentMeta() {
  const { t, i18n } = useTranslation();
  const { language } = usePrefs();
  useEffect(() => {
    if (i18n.language !== language) void i18n.changeLanguage(language);
  }, [i18n, language]);
  useEffect(() => {
    const name = t('brand.name');
    document.title = t('site.meta.title', { name });
    document.querySelector('meta[name="description"]')?.setAttribute('content', t('site.meta.description'));
  }, [t, i18n.language]);
}

export function Site() {
  useDocumentMeta();
  const { reducedMotion } = usePrefs();
  const [heroRequest, setHeroRequest] = useState<{ id: string; seq: number } | null>(null);

  const previewInHero = useCallback(
    (id: string) => {
      setHeroRequest((prev) => ({ id, seq: (prev?.seq ?? 0) + 1 }));
      const top = document.getElementById(SECTION.top);
      top?.scrollIntoView({ behavior: reducedMotion ? 'auto' : 'smooth', block: 'start' });
    },
    [reducedMotion],
  );

  return (
    <IconContext.Provider value={ICON_DEFAULTS}>
      <Nav />
      <main className="relative overflow-x-clip">
        <HeroSection requestPick={heroRequest} />
        <WorkflowSection />
        <TemplatesSection onPreview={previewInHero} />
        <FeaturesSection />
        <OpenSourceSection />
      </main>
      <Footer />
    </IconContext.Provider>
  );
}
