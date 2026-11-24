// 官网多语言：完全独立，只加载官网自己的文案（site.*）和品牌文案（brand.*，来自 @allay/ui/brand），
// 不导入桌面应用 apps/desktop 的语言文件。
import { brandMessages } from '@allay/ui/brand';
import i18next from 'i18next';
import { initReactI18next } from 'react-i18next';
import en from './locales/en.json';
import zhCN from './locales/zh-CN.json';
import type { SiteLanguage } from './prefs';

export const resources = {
  'zh-CN': { translation: { site: zhCN, brand: brandMessages['zh-CN'] } },
  en: { translation: { site: en, brand: brandMessages.en } },
} as const;

/** 用到但缺失的文案键（冒烟测试 T-WEB-3 检查它为空） */
export const missingKeys = new Set<string>();

export async function initSiteI18n(language: SiteLanguage): Promise<typeof i18next> {
  await i18next.use(initReactI18next).init({
    resources,
    lng: language,
    fallbackLng: false,
    interpolation: { escapeValue: false },
    returnNull: false,
    saveMissing: true,
    missingKeyHandler: (_lngs, _ns, key) => {
      missingKeys.add(key);
      console.warn(`[i18n] missing key: ${key}`);
    },
  });
  return i18next;
}
