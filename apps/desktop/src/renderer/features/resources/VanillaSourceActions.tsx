import { Button } from '@allay/ui/components/button';
import { ICON } from '@allay/ui/lib/icons';
import { CloudArrowDown, FolderOpen, GameController } from '@phosphor-icons/react';
import { useTranslation } from 'react-i18next';
import { useResourceStore } from '../../stores/resourceStore';
import { chooseGameDir, downloadVanilla, setVanilla } from './actions';
import { DownloadProgress } from './DownloadProgress';

// 原版素材的三个来源入口（03-assets.md 3.4、decisions.md M2b）：本机已装的游戏、从 Mojang 官方服务器下载、手动选游戏目录。
// 下载只在用户点按钮后发生，说明文字讲清会联网到哪里。资源栈弹层、引导状态和设置的“素材”页共用这一块；
// 下载开始后换成分阶段的进度（DownloadProgress，6.12），失败或取消时进度留着，指明停在哪一步。

export function VanillaSourceActions() {
  const { t } = useTranslation();
  const state = useResourceStore((s) => s.state);
  if (!state) return null;
  const { vanilla, download } = state;

  if (download.status === 'running') return <DownloadProgress state={download} />;

  const stopped = download.status === 'failed' || download.status === 'canceled' ? download : null;
  return (
    <div className="flex flex-col gap-3">
      {stopped && <DownloadProgress state={stopped} />}
      {vanilla.local && vanilla.consent !== true && (
        <Button variant="secondary" className="self-start" data-testid="vanilla-use-local" onClick={() => void setVanilla({ consent: true, enabled: true })}>
          <GameController size={ICON.sm} />
          {t('resources.useLocal', { version: vanilla.local.gameVersion ?? vanilla.local.versionId })}
        </Button>
      )}
      {!stopped && (
        <Button variant="secondary" className="h-auto min-h-7 self-start whitespace-normal py-1 text-left" data-testid="vanilla-download" onClick={downloadVanilla}>
          <CloudArrowDown size={ICON.sm} />
          {t('resources.download.button')}
        </Button>
      )}
      <p className="text-xs leading-relaxed text-fg-muted" data-testid="download-note">
        {t('resources.download.note')}
      </p>
      <Button variant="ghost" className="self-start" data-testid="vanilla-choose-dir" onClick={() => void chooseGameDir(t)}>
        <FolderOpen size={ICON.sm} />
        {t('resources.findGame')}
      </Button>
    </div>
  );
}
