import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { I18nextProvider } from 'react-i18next';
import './app.css';
import { App } from './app/App';
import { applyThemeToDocument } from './app/useThemeSync';
import { initI18n, resolveLanguage } from './i18n';
import { installTestHooks } from './test-hooks';
import { useResourceStore } from './stores/resourceStore';
import { useUiStore } from './stores/uiStore';

async function bootstrap(): Promise<void> {
  const [settings, info, resources] = await Promise.all([window.allay.settings.get(), window.allay.app.info(), window.allay.resources.layers()]);
  useUiStore.getState().replace(settings);
  // 先拿到资源栈（和它的 stamp）再装载模板，免得用空栈白装一次
  useResourceStore.getState().replace(resources);
  window.allay.resources.onChanged((next) => useResourceStore.getState().replace(next));
  if (info.testHooks) installTestHooks();
  applyThemeToDocument(settings);

  const language = resolveLanguage(settings.language, info.systemLocale);
  const i18n = await initI18n(language);
  document.documentElement.lang = language;
  document.title = i18n.t('brand.name');

  // 设置可能在别处被改（以后的设置对话框、测试），以主进程推来的为准
  window.allay.settings.onChanged((next) => useUiStore.getState().replace(next));

  const container = document.getElementById('root');
  if (!container) throw new Error('missing #root');
  createRoot(container).render(
    <StrictMode>
      <I18nextProvider i18n={i18n}>
        <App />
      </I18nextProvider>
    </StrictMode>,
  );
}

void bootstrap();
