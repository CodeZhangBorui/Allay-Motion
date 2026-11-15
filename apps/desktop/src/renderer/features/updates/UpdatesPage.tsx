import { Button } from '@allay/ui/components/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@allay/ui/components/select';
import { ICON } from '@allay/ui/lib/icons';
import { ArrowsClockwise, CloudArrowDown, X } from '@phosphor-icons/react';
import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { INSTALL_TEMP_SPACE_MB, UPDATE_MODES, UPDATE_SOURCE_PREFS, type UpdateMode, type UpdateSourcePref, type UpdateState } from '../../../shared/updates';
import { useUiStore } from '../../stores/uiStore';
import { formatBytes } from '../resources/DownloadProgress';
import { CONTROL_W, SettingsPageHeader, SettingsRow, SettingsSection } from '../settings/layout';
import { skipVersion, useUpdateStore } from './updateStore';

// 设置对话框的“更新”一类（docs/decisions.md“自动更新”）：当前版本和检查结果、自动更新的方式、更新源。

const mac = () => navigator.userAgent.includes('Mac');

function statusText(t: TFunction, s: UpdateState, locale: string): string {
  const version = s.latest?.version ?? '';
  const source = s.latest ? t(`updates.sources.${s.latest.source}`) : '';
  // 安装失败时状态留在“已下载”，显示原因
  if (s.error && s.status === 'downloaded') return t(`updates.errors.${s.error}`, { size: INSTALL_TEMP_SPACE_MB });
  switch (s.status) {
    case 'idle':
      return t('updates.status.idle');
    case 'checking':
      return t('updates.status.checking');
    case 'up-to-date':
      return s.checkedAt ? t('updates.status.upToDateAt', { time: new Date(s.checkedAt).toLocaleString(locale) }) : t('updates.status.upToDate');
    case 'available':
      return t('updates.status.available', { version, size: formatBytes(s.latest?.asset.size ?? 0), source });
    case 'downloading':
      return s.progress && s.progress.total > 0
        ? t('updates.status.downloadingProgress', { version, received: formatBytes(s.progress.received), total: formatBytes(s.progress.total) })
        : t('updates.status.downloading', { version });
    case 'downloaded':
      return t(mac() ? 'updates.status.downloadedMac' : 'updates.status.downloaded', { version });
    case 'error':
      return t(`updates.errors.${s.error ?? 'network'}`);
    case 'unsupported':
      return t('updates.status.unsupported');
  }
}

function MainAction({ s }: { s: UpdateState }) {
  const { t } = useTranslation();
  const store = useUpdateStore.getState();
  switch (s.status) {
    case 'available':
      return (
        <Button data-testid="updates-download" onClick={() => void store.download()}>
          <CloudArrowDown size={ICON.sm} />
          {t('updates.download')}
        </Button>
      );
    case 'downloading':
      return (
        <Button variant="secondary" data-testid="updates-cancel" onClick={() => void store.cancel()}>
          <X size={ICON.sm} />
          {t('common.cancel')}
        </Button>
      );
    case 'downloaded':
      return (
        <Button data-testid="updates-install" onClick={() => void store.install()}>
          <ArrowsClockwise size={ICON.sm} />
          {t(mac() ? 'updates.installMac' : 'updates.install')}
        </Button>
      );
    case 'unsupported':
      return null;
    default:
      return (
        <Button variant="secondary" disabled={s.status === 'checking'} data-testid="updates-check" onClick={() => void store.check()}>
          <ArrowsClockwise size={ICON.sm} />
          {t('updates.check')}
        </Button>
      );
  }
}

export function UpdatesPage() {
  const { t, i18n } = useTranslation();
  const prefs = useUiStore((s) => s.settings.updates);
  const state = useUpdateStore((s) => s.state);
  useEffect(() => void useUpdateStore.getState().load(), []);
  const setPrefs = (patch: Partial<typeof prefs>) => useUiStore.getState().update({ updates: { ...prefs, ...patch } });
  const progress = state?.status === 'downloading' && state.progress && state.progress.total > 0 ? Math.min(1, state.progress.received / state.progress.total) : null;
  return (
    <div className="flex flex-col" data-testid="settings-updates">
      <SettingsPageHeader title={t('settings.pages.updates')} description={t('settings.descriptions.updates')} />
      <SettingsSection>
        <SettingsRow
          label={t('updates.current', { version: state?.currentVersion ?? '' })}
          hint={
            <span className="num" data-testid="updates-status" data-status={state?.status}>
              {state ? statusText(t, state, i18n.language) : '…'}
            </span>
          }
        >
          {state && <MainAction s={state} />}
        </SettingsRow>
        {progress !== null && (
          <div className="mb-2 h-1 w-full overflow-hidden rounded-full bg-well" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(progress * 100)} data-testid="updates-progress">
            <div className="h-full rounded-full bg-primary transition-[width] duration-(--dur-2)" style={{ width: `${progress * 100}%` }} />
          </div>
        )}
      </SettingsSection>
      <SettingsSection title={t('updates.settingsTitle')}>
        <SettingsRow label={t('updates.mode')} hint={t(`updates.modeHints.${prefs.mode}`)}>
          <Select value={prefs.mode} onValueChange={(v) => setPrefs({ mode: v as UpdateMode })}>
            <SelectTrigger className={CONTROL_W} aria-label={t('updates.mode')} data-testid="updates-mode">
              <SelectValue>{(v: unknown) => t(`updates.modes.${String(v)}`)}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              {UPDATE_MODES.map((m) => (
                <SelectItem key={m} value={m}>
                  {t(`updates.modes.${m}`)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </SettingsRow>
        <SettingsRow
          label={t('updates.source')}
          hint={prefs.source === 'auto' && state ? t('updates.sourceAutoHint', { source: t(`updates.sources.${state.preferredSource}`) }) : t('updates.sourceHint')}
        >
          <Select value={prefs.source} onValueChange={(v) => setPrefs({ source: v as UpdateSourcePref })}>
            <SelectTrigger className={CONTROL_W} aria-label={t('updates.source')} data-testid="updates-source">
              <SelectValue>{(v: unknown) => t(`updates.sources.${String(v)}`)}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              {UPDATE_SOURCE_PREFS.map((s) => (
                <SelectItem key={s} value={s}>
                  {t(`updates.sources.${s}`)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </SettingsRow>
        {prefs.skipVersion && (
          <SettingsRow label={t('updates.skipped', { version: prefs.skipVersion })} hint={t('updates.skippedHint')}>
            <Button variant="secondary" data-testid="updates-unskip" onClick={() => skipVersion(null)}>
              {t('updates.unskip')}
            </Button>
          </SettingsRow>
        )}
      </SettingsSection>
    </div>
  );
}
