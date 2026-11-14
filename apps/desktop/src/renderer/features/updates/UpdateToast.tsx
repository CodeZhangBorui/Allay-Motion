import { Button } from '@allay/ui/components/button';
import { ICON } from '@allay/ui/lib/icons';
import { ArrowsClockwise, CloudArrowDown } from '@phosphor-icons/react';
import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import type { UpdateState } from '../../../shared/updates';
import { skipVersion, useUpdateStore } from './updateStore';

// 新版本的通知（Sonner，6.5 的样子）：一句话加两个按钮。发现新版本时“下载 / 跳过这个版本”，下载完时“重启并安装 / 稍后”。

export function UpdateToast({ state, onClose }: { state: UpdateState; onClose(): void }) {
  const { t } = useTranslation();
  const version = state.latest?.version ?? '';
  const downloaded = state.status === 'downloaded';
  const mac = navigator.userAgent.includes('Mac');
  return (
    <div role="status" data-testid="update-toast" data-status={state.status} className="flex w-[min(420px,calc(100vw-32px))] flex-col gap-2.5 rounded-xl bg-surface-2 px-3.5 py-3 text-sm shadow-float">
      <div className="flex flex-col gap-0.5">
        <span className="font-medium text-foreground">{t(downloaded ? 'updates.toast.downloaded' : 'updates.toast.available', { version })}</span>
        <span className="text-xs text-fg-subtle">{t(downloaded ? (mac ? 'updates.toast.downloadedHintMac' : 'updates.toast.downloadedHint') : 'updates.toast.availableHint')}</span>
      </div>
      <div className="flex justify-end gap-2">
        {downloaded ? (
          <>
            <Button variant="ghost" onClick={onClose}>
              {t('updates.later')}
            </Button>
            <Button
              data-testid="update-toast-install"
              onClick={() => {
                onClose();
                void useUpdateStore.getState().install();
              }}
            >
              <ArrowsClockwise size={ICON.sm} />
              {t(mac ? 'updates.installMac' : 'updates.install')}
            </Button>
          </>
        ) : (
          <>
            <Button
              variant="ghost"
              onClick={() => {
                skipVersion(version);
                onClose();
              }}
            >
              {t('updates.skip')}
            </Button>
            <Button
              data-testid="update-toast-download"
              onClick={() => {
                onClose();
                void useUpdateStore.getState().download();
              }}
            >
              <CloudArrowDown size={ICON.sm} />
              {t('updates.download')}
            </Button>
          </>
        )}
      </div>
    </div>
  );
}

const UPDATE_TOAST_ID = 'update';

/** 订阅主进程推来的更新状态；自动检查发现新版本、后台下载完成时弹一条带按钮的通知（App 里调用一次） */
export function useUpdateNotifications(): void {
  useEffect(() => {
    void useUpdateStore.getState().load();
    return window.allay.updates.onChanged((state) => {
      useUpdateStore.setState({ state });
      if (!state.announce || !state.latest) return;
      if (state.status !== 'available' && state.status !== 'downloaded') return;
      toast.custom((id) => <UpdateToast state={state} onClose={() => toast.dismiss(id)} />, { id: UPDATE_TOAST_ID, duration: 30_000 });
    });
  }, []);
}
