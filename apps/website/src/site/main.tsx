import { declareMascotAssetsMissing } from '@allay/mascot';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { I18nextProvider } from 'react-i18next';
import './site.css';
import { initSiteI18n, missingKeys } from './i18n';
import { initPrefs } from './prefs';
import { Site } from './Site';

// 悦灵的烘焙图集是原版贴图的派生图像，不随官网分发：组件用 CSS 占位实现（docs/decisions.md 官网）
declareMascotAssetsMissing();

async function bootstrap(): Promise<void> {
  const prefs = initPrefs();
  const i18n = await initSiteI18n(prefs.language);
  // 冒烟测试读它
  (window as unknown as { __siteMissingKeys: Set<string> }).__siteMissingKeys = missingKeys;
  const root = document.getElementById('root');
  if (!root) throw new Error('missing #root');
  createRoot(root).render(
    <StrictMode>
      <I18nextProvider i18n={i18n}>
        <Site />
      </I18nextProvider>
    </StrictMode>,
  );
}

void bootstrap();
