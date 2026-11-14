import { ICON_DEFAULTS } from '@allay/ui/lib/icons';
import { IconContext } from '@phosphor-icons/react';
import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { FeaturesSection } from './components/FeaturesSection';
import { Footer } from './components/Footer';
import { Hero } from './components/Hero';
import { Nav } from './components/Nav';
import { OpenSourceSection } from './components/OpenSourceSection';
import { SimulatorSection } from './components/SimulatorSection';
import { TemplatesSection } from './components/TemplatesSection';
import { WorkflowSection } from './components/WorkflowSection';
import { BlockBand } from './motion/BlockBand';
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
  return (
    <IconContext.Provider value={ICON_DEFAULTS}>
      <Nav />
      <main>
        <Hero />
        <SimulatorSection />
        {/* 分节之间的过场：方块擦除、像素溶解、方块坠落，和模板同一套转场语言 */}
        <BlockBand variant="wipe" from="--site-bg" to="--site-alt" seed={1} />
        <TemplatesSection />
        <BlockBand variant="dissolve" from="--site-alt" to="--site-bg" seed={2} />
        <FeaturesSection />
        <BlockBand variant="fall" from="--site-bg" to="--site-alt" seed={3} />
        <WorkflowSection />
        <BlockBand variant="wipe" from="--site-alt" to="--site-bg" seed={4} />
        <OpenSourceSection />
        <BlockBand variant="dissolve" from="--site-bg" to="--site-alt" seed={5} height={80} />
      </main>
      <Footer />
    </IconContext.Provider>
  );
}
