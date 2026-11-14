// 页脚：docs/09-compliance.md 9.5 的非官方声明（逐字，取自 brand.disclaimer），许可与字体署名。
import { AllayHead } from '@allay/mascot';
import { useTranslation } from 'react-i18next';
import { LICENSE_NAME, REPO_URL } from '../links';

export function Footer() {
  const { t } = useTranslation();
  return (
    <footer className="bg-site-alt pt-16 pb-10" data-tone="alt" data-scene="alt" data-testid="site-footer">
      <div className="site-container">
        <div className="site-card p-6 sm:p-8" data-testid="disclaimer-box">
          <p className="site-kicker">{t('site.footer.disclaimerLabel')}</p>
          <p className="mt-3 text-[14px] leading-[1.7] font-medium whitespace-pre-line" data-testid="disclaimer">
            {t('brand.disclaimer')}
          </p>
        </div>
        <div className="mt-10 grid gap-8 text-[12.5px] leading-[1.6] text-fg-subtle md:grid-cols-[1fr_2fr]">
          <div>
            <div className="flex items-center gap-2">
              <AllayHead size={20} />
              <span className="text-[13.5px] font-semibold text-foreground">{t('brand.wordmark')}</span>
            </div>
            <p className="num mt-3">{LICENSE_NAME}</p>
          </div>
          <div className="space-y-1.5">
            <p>
              {t('site.footer.license')}{' '}
              <a className="text-fg-muted underline underline-offset-4 hover:text-foreground" href={REPO_URL} target="_blank" rel="noreferrer noopener">
                {t('site.footer.source')}
              </a>
            </p>
            <p>
              {t('site.footer.fonts')}{' '}
              <a className="text-fg-muted underline underline-offset-4 hover:text-foreground" href="./licenses/ark-pixel-font-OFL.txt">
                {t('site.footer.fontLicense')}
              </a>
            </p>
            <p>{t('site.footer.noTracking')}</p>
          </div>
        </div>
      </div>
    </footer>
  );
}
