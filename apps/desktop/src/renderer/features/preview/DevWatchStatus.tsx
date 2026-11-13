import { ICON } from '@allay/ui/lib/icons';
import { CircleNotch, Eye } from '@phosphor-icons/react';
import { useTranslation } from 'react-i18next';
import { useDevStore } from '../../stores/devStore';

// 状态栏里不打扰的监视提示（docs/08-milestones.md MD）：当前模板是用户模板时显示“正在监视”，
// 以及上一次热重载的时间和结果。不是用户模板时什么都不显示。

function clock(at: number, language: string): string {
  return new Date(at).toLocaleTimeString(language, { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
}

export function DevWatchStatus() {
  const { t, i18n } = useTranslation();
  const watching = useDevStore((s) => s.watching);
  const phase = useDevStore((s) => s.phase);
  const last = useDevStore((s) => s.last);
  if (!watching) return null;
  const result = phase === 'reloading' ? t('dev.status.reloading') : last ? t(last.ok ? 'dev.status.lastOk' : 'dev.status.lastFailed', { time: clock(last.at, i18n.language) }) : null;
  const text = result ? `${t('dev.status.watching')} · ${result}` : t('dev.status.watching');
  return (
    <span className="flex min-w-0 items-center gap-1.5" data-testid="dev-watch-status" data-phase={phase} data-result={last ? (last.ok ? 'ok' : 'failed') : 'none'} title={t('dev.status.hint')}>
      {phase === 'reloading' ? <CircleNotch size={ICON.sm - 1} className="animate-spin" /> : <Eye size={ICON.sm - 1} className={last && !last.ok ? 'text-danger' : undefined} />}
      <span className="truncate">{text}</span>
    </span>
  );
}
