import { Button } from '@allay/ui/components/button';
import { useTranslation } from 'react-i18next';
import { useResourceStore } from '../../stores/resourceStore';
import { chooseGameDir, downloadVanilla, setVanilla } from './actions';

// 原版素材的三个来源入口（03-assets.md 3.4、decisions.md M2b）：本机已装的游戏、从 Mojang 官方服务器下载、手动选游戏目录。
// 下载只在用户点按钮后发生，说明文字讲清会联网到哪里。资源栈弹层和引导状态共用这一块。

export function VanillaSourceActions() {
  const { t } = useTranslation();
  const state = useResourceStore((s) => s.state);
  if (!state) return null;
  const { vanilla, download } = state;

  if (download.status === 'running') {
    const pct = download.total ? Math.min(100, Math.floor((download.received / download.total) * 100)) : null;
    return (
      <div className="flex flex-col gap-2" data-testid="download-running">
        <p className="text-sm">
          {t('resources.download.running')} <span className="text-fg-muted">{t(`resources.download.phase.${download.phase}`)}</span>
        </p>
        <div
          role="progressbar"
          aria-label={t('resources.download.progress')}
          aria-valuemin={0}
          aria-valuemax={100}
          {...(pct !== null ? { 'aria-valuenow': pct } : {})}
          data-testid="download-progress"
          className="h-1.5 w-full overflow-hidden rounded-full bg-control-hi"
        >
          <div className="h-full rounded-full bg-primary" style={{ width: pct === null ? '15%' : `${pct}%` }} />
        </div>
        <Button variant="secondary" className="self-start" data-testid="download-cancel" onClick={() => void window.allay.resources.cancelDownload()}>
          {t('resources.download.cancel')}
        </Button>
      </div>
    );
  }

  const failed = download.status === 'failed' ? download.error : null;
  return (
    <div className="flex flex-col gap-2">
      {failed && (
        <p role="alert" data-testid="download-error" data-error={failed} className="text-sm text-danger">
          {t(`resources.download.errors.${failed}`)}
        </p>
      )}
      {vanilla.local && vanilla.consent !== true && (
        <Button variant="secondary" className="self-start" data-testid="vanilla-use-local" onClick={() => void setVanilla({ consent: true, enabled: true })}>
          {t('resources.useLocal', { version: vanilla.local.versionId })}
        </Button>
      )}
      <Button variant="secondary" className="h-auto min-h-7 self-start whitespace-normal py-1 text-left" data-testid="vanilla-download" onClick={downloadVanilla}>
        {failed ? t('resources.download.retry') : t('resources.download.button')}
      </Button>
      <p className="text-xs leading-relaxed text-fg-muted" data-testid="download-note">
        {t('resources.download.note')}
      </p>
      <Button variant="ghost" className="self-start" data-testid="vanilla-choose-dir" onClick={() => void chooseGameDir(t)}>
        {t('resources.findGame')}
      </Button>
    </div>
  );
}
