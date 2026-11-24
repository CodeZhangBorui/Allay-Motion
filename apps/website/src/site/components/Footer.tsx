// 页尾：逐字显示 @allay/ui/brand 的非官方声明，附 GPL-3.0 与字体署名。
import { AllayHead } from '@allay/mascot';
import { useTranslation } from 'react-i18next';
import { LICENSE_NAME, REPO_URL } from '../links';

export function Footer() {
  const { t } = useTranslation();
  const link = 'link-focus rounded text-fg-muted underline decoration-[var(--site-line-hi)] underline-offset-4 transition-colors hover:text-foreground hover:decoration-current';

  return (
    <footer id="end" className="relative border-t border-[var(--site-line)] pt-14" data-testid="site-footer">
      <div className="wrap">
        <div className="card p-6 sm:p-8" data-testid="disclaimer-box">
          <p className="t-mono text-[10.5px] text-fg-subtle">{t('site.footer.disclaimerLabel')}</p>
          <p className="mt-3 max-w-[60em] text-[15px] leading-[1.75] font-medium whitespace-pre-line" data-testid="disclaimer">
            {t('brand.disclaimer')}
          </p>
        </div>
      </div>

      <div className="wrap mt-10 grid gap-5 border-t border-[var(--site-line)] py-8 text-[12.5px] leading-[1.7] text-fg-subtle md:grid-cols-[auto_1fr] md:items-center md:gap-10">
        <div className="flex items-center gap-2.5">
          <AllayHead size={20} />
          <span className="text-[13.5px] font-semibold text-foreground">{t('brand.wordmark')}</span>
          <span className="t-mono text-[10.5px]">· {LICENSE_NAME}</span>
        </div>
        <div className="space-y-1">
          <p>
            {t('site.footer.license')}{' '}
            <a className={link} href={REPO_URL} target="_blank" rel="noreferrer noopener">
              {t('site.footer.source')}
            </a>
          </p>
          <p>{t('site.footer.fonts')}</p>
          <p>{t('site.footer.noTracking')}</p>
        </div>
      </div>
    </footer>
  );
}
