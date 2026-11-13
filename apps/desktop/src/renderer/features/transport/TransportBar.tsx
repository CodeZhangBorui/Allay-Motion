import { Button } from '@allay/ui/components/button';
import { Play, Repeat, SkipBack } from 'lucide-react';
import { useTranslation } from 'react-i18next';

// 播放条（6.4）：48 px。M0 只有外形，M1 接上播放与拖动。
export function TransportBar() {
  const { t } = useTranslation();
  return (
    <div role="toolbar" aria-label={t('transport.region')} className="flex h-12 shrink-0 items-center gap-1 border-t bg-surface-1 px-3">
      <Button variant="ghost" size="icon" aria-label={t('transport.toStart')} disabled>
        <SkipBack />
      </Button>
      <Button variant="ghost" size="icon" aria-label={t('transport.play')} disabled>
        <Play />
      </Button>
      <Button variant="ghost" size="icon" aria-label={t('transport.loop')} disabled>
        <Repeat />
      </Button>
      <span className="tabular-nums ml-2 text-sm">00:00.00</span>
      <span className="tabular-nums ml-2 text-xs text-fg-muted">F0/0</span>
      <div className="mx-3 h-2 flex-1 rounded-full bg-surface-3" aria-hidden="true" />
      <span className="tabular-nums rounded-md border px-2 py-0.5 text-xs text-fg-muted">1920×1080 · 60fps</span>
    </div>
  );
}
