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
import { SceneWall } from './motion/SceneWall';
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
        <TemplatesSection />
        <FeaturesSection />
        <WorkflowSection />
        <OpenSourceSection />
      </main>
      <Footer />
      {/* 分节之间整幅的过场：方块墙随滚动铺满再散开（方块擦除、像素溶解、方块坠落轮换） */}
      <SceneWall />
    </IconContext.Provider>
  );
}
