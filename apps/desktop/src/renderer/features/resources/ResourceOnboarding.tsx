import { Button } from '@allay/ui/components/button';
import { useTranslation } from 'react-i18next';
import { useResourceStore } from '../../stores/resourceStore';
import { addPack } from './actions';
import { VanillaSourceActions } from './VanillaSourceActions';

// 没有任何素材层（原版层、资源包都没有）时，预览区上方的引导状态（decisions.md M2b）。
// 不是错误：模板照常装载，缺的贴图显示为占位。

export function ResourceOnboarding() {
  const { t } = useTranslation();
  return (
    <div
      role="region"
      aria-labelledby="onboarding-title"
      data-testid="resources-onboarding"
      className="absolute top-12 left-1/2 z-10 flex w-[min(520px,calc(100%-48px))] -translate-x-1/2 flex-col gap-3 rounded-xl bg-surface-2 p-4 shadow-float"
    >
      <h2 id="onboarding-title" className="text-base font-semibold">
        {t('resources.onboarding.title')}
      </h2>
      <p className="text-sm text-fg-muted">{t('resources.onboarding.body', { name: t('brand.name') })}</p>
      <VanillaSourceActions />
      <div className="flex flex-col gap-2 border-t border-divider pt-3">
        <Button variant="secondary" className="self-start" data-testid="onboarding-add-pack" onClick={() => void addPack(t, 'zip')}>
          {t('resources.addPack')}
        </Button>
        <p className="text-xs text-fg-muted">{t('resources.dropHint')}</p>
      </div>
    </div>
  );
}

/** 有状态、探测完了、确实没有素材，且不在下载中弹询问对话框时显示 */
export function useShowOnboarding(): boolean {
  return useResourceStore((s) => {
    const st = s.state;
    if (!st || st.detecting || st.hasAssets) return false;
    const asking = st.vanilla.consent === null && st.vanilla.local !== null && !s.discoveryHandled;
    return !asking;
  });
}
