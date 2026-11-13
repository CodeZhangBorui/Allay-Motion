import { Button } from '@allay/ui/components/button';
import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useResourceStore } from '../../stores/resourceStore';
import { setVanilla } from './actions';

// 首次发现本机游戏时询问一次（03-assets.md 3.4、06-ui-design.md 6.6）。
// 第二个按钮原文是“先用内置素材”；v1 没有内置素材，改为“暂不使用”（decisions.md M2b）。

export function DiscoveryDialog() {
  const { t } = useTranslation();
  const local = useResourceStore((s) => s.state?.vanilla.local ?? null);
  const acceptRef = useRef<HTMLButtonElement>(null);
  useEffect(() => acceptRef.current?.focus(), []);

  const answer = (consent: boolean) => {
    useResourceStore.getState().setDiscoveryHandled();
    void setVanilla(consent ? { consent: true, enabled: true } : { consent: false });
  };
  if (!local) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" data-testid="vanilla-discovery">
      <div role="dialog" aria-modal="true" aria-labelledby="discovery-title" className="flex w-[440px] flex-col gap-3 rounded-lg border bg-surface-2 p-5 shadow-[var(--shadow-dialog)]">
        <h2 id="discovery-title" className="text-base font-semibold">
          {t('resources.discovery.title')}
        </h2>
        <p className="text-sm">{t('resources.discovery.body', { version: local.versionId })}</p>
        <p className="text-sm text-fg-muted">{t('resources.discovery.local', { name: t('brand.name') })}</p>
        <div className="mt-1 flex justify-end gap-2">
          <Button variant="secondary" size="lg" data-testid="discovery-decline" onClick={() => answer(false)}>
            {t('resources.discovery.decline')}
          </Button>
          <Button ref={acceptRef} size="lg" data-testid="discovery-accept" onClick={() => answer(true)}>
            {t('resources.discovery.accept')}
          </Button>
        </div>
        <p className="text-xs text-fg-muted">{t('resources.discovery.later')}</p>
      </div>
    </div>
  );
}

/** 还没问过、探测到了本机游戏、这次启动还没处理过 */
export function useShowDiscovery(): boolean {
  return useResourceStore((s) => {
    const st = s.state;
    return !!st && !st.detecting && st.vanilla.consent === null && st.vanilla.local !== null && !s.discoveryHandled;
  });
}
