import { brandMessages } from '@allay/ui/brand';
import i18next from 'i18next';
import { initReactI18next } from 'react-i18next';
import type { LanguagePref } from '../../shared/settings';
import en from './locales/en.json';
import zhCN from './locales/zh-CN.json';

// i18next 骨架（6.9）：zh-CN 和 en 两套文案；brand.* 由 packages/ui/src/brand 统一提供。

export const SUPPORTED_LANGUAGES = ['zh-CN', 'en'] as const;
export type Language = (typeof SUPPORTED_LANGUAGES)[number];

export const resources = {
  'zh-CN': { translation: { ...zhCN, brand: brandMessages['zh-CN'] } },
  en: { translation: { ...en, brand: brandMessages.en } },
} as const;

/** “跟随系统”时：系统首选语言是中文就用中文，否则英文 */
export function resolveLanguage(pref: LanguagePref, systemLocale: string): Language {
  if (pref !== 'system') return pref;
  return systemLocale.toLowerCase().startsWith('zh') ? 'zh-CN' : 'en';
}

export async function initI18n(language: Language): Promise<typeof i18next> {
  await i18next.use(initReactI18next).init({
    resources,
    lng: language,
    fallbackLng: false,
    interpolation: { escapeValue: false },
    returnNull: false,
  });
  return i18next;
}
