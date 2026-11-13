import { Allay } from '@allay/mascot';
import { Button } from '@allay/ui/components/button';
import { Dialog, DialogContent, DialogTitle } from '@allay/ui/components/dialog';
import { Kbd } from '@allay/ui/components/misc';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@allay/ui/components/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@allay/ui/components/tabs';
import { useEffect, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import type { FfmpegInfo } from '../../../shared/export';
import type { CacheUsage } from '../../../shared/resources';
import { notify } from '../../stores/noticeStore';
import { useUiStore } from '../../stores/uiStore';
import { useCommands } from '../../app/registry';
import { shortcutLabel } from '../commands/commands';
import { ResourceStackPanel } from '../resources/ResourceStackPanel';
import { OutputSettingsForm } from './OutputSettingsForm';

// 设置对话框（6.4）：通用（语言、主题、减少动效）、素材（资源栈、缓存占用与清除）、导出（默认输出设置、FFmpeg 版本、
// 重新检测编码器）、快捷键、关于（版本、第三方许可、非官方声明）。

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex min-h-10 items-center justify-between gap-4 border-b border-divider py-1 last:border-b-0">
      <span className="text-sm">{label}</span>
      {children}
    </div>
  );
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

function General() {
  const { t } = useTranslation();
  const settings = useUiStore((s) => s.settings);
  const ui = useUiStore.getState();
  return (
    <div className="flex flex-col">
      <Row label={t('settings.language')}>
        <Select value={settings.language} onValueChange={(v) => ui.update({ language: v as typeof settings.language })}>
          <SelectTrigger className="w-44" aria-label={t('settings.language')} data-testid="settings-language">
            <SelectValue>{(v: unknown) => t(`settings.languages.${String(v)}`)}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            {(['system', 'zh-CN', 'en'] as const).map((l) => (
              <SelectItem key={l} value={l}>
                {t(`settings.languages.${l}`)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Row>
      <Row label={t('settings.theme')}>
        <Select value={settings.theme} onValueChange={(v) => ui.setTheme(v as typeof settings.theme)}>
          <SelectTrigger className="w-44" aria-label={t('settings.theme')} data-testid="settings-theme">
            <SelectValue>{(v: unknown) => t(`settings.themes.${String(v)}`)}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            {(['dark', 'light'] as const).map((l) => (
              <SelectItem key={l} value={l}>
                {t(`settings.themes.${l}`)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Row>
      <Row label={t('settings.reducedMotion')}>
        <Select value={settings.reducedMotion} onValueChange={(v) => ui.update({ reducedMotion: v as typeof settings.reducedMotion })}>
          <SelectTrigger className="w-44" aria-label={t('settings.reducedMotion')} data-testid="settings-reduced-motion">
            <SelectValue>{(v: unknown) => t(`settings.reducedMotions.${String(v)}`)}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            {(['system', 'on', 'off'] as const).map((l) => (
              <SelectItem key={l} value={l}>
                {t(`settings.reducedMotions.${l}`)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Row>
    </div>
  );
}

function Assets() {
  const { t } = useTranslation();
  const [usage, setUsage] = useState<CacheUsage | null>(null);
  const refresh = () => void window.allay.cache.usage().then(setUsage);
  useEffect(refresh, []);
  return (
    <div className="flex flex-col gap-4">
      <ResourceStackPanel />
      <div className="flex items-center justify-between gap-4 border-t border-divider pt-3">
        <div className="flex flex-col">
          <span className="text-sm">{t('settings.cache')}</span>
          <span className="num text-xs text-fg-subtle" data-testid="cache-usage">
            {usage ? t('settings.cacheUsage', { files: usage.files, size: formatBytes(usage.bytes) }) : '…'}
          </span>
        </div>
        <Button
          variant="secondary"
          onClick={() =>
            void window.allay.cache.clear().then(() => {
              refresh();
              notify('info', t('settings.cacheCleared'));
            })
          }
        >
          {t('settings.clearCache')}
        </Button>
      </div>
    </div>
  );
}

function ExportPage() {
  const { t } = useTranslation();
  const [info, setInfo] = useState<FfmpegInfo | null>(null);
  useEffect(() => void window.allay.export.ffmpegInfo().then(setInfo), []);
  return (
    <div className="flex flex-col gap-4">
      <section className="flex flex-col gap-2">
        <h3 className="text-xs font-semibold text-fg-subtle">{t('settings.defaultOutput')}</h3>
        <OutputSettingsForm />
      </section>
      <section className="flex flex-col border-t border-divider pt-3">
        <Row label={t('settings.ffmpeg')}>
          <span className="num text-xs text-fg-subtle" data-testid="ffmpeg-version">
            {info ? (info.available ? (info.version ?? t('settings.ffmpegUnknown')) : t('export.errors.ffmpegMissing')) : '…'}
          </span>
        </Row>
        <Row label={t('settings.encoders')}>
          <Button variant="secondary" disabled title={t('settings.encodersLater')}>
            {t('settings.redetect')}
          </Button>
        </Row>
      </section>
    </div>
  );
}

function Shortcuts() {
  const { t } = useTranslation();
  // 注册表里所有带快捷键的命令（可选模块的也会列出来）
  const commands = useCommands();
  return (
    <table className="w-full text-sm" data-testid="shortcut-table">
      <tbody>
        {commands.filter((c) => c.shortcut).map((c) => (
          <tr key={c.id} className="border-b border-divider last:border-b-0">
            <td className="py-1.5">{t(c.titleKey)}</td>
            <td className="py-1.5 text-right">
              <Kbd>{shortcutLabel(c.shortcut!)}</Kbd>
            </td>
          </tr>
        ))}
        <tr className="border-b border-divider last:border-b-0">
          <td className="py-1.5">{t('shortcuts.frameStep')}</td>
          <td className="py-1.5 text-right">
            <Kbd>←</Kbd> <Kbd>→</Kbd> <span className="text-xs text-fg-subtle">{t('shortcuts.shiftTen')}</span>
          </td>
        </tr>
      </tbody>
    </table>
  );
}

function About() {
  const { t } = useTranslation();
  const [version, setVersion] = useState('');
  useEffect(() => void window.allay.app.info().then((i) => setVersion(i.version)), []);
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-3">
        <Allay clip="hover" size={56} priority="dialog" />
        <div className="flex flex-col">
          <span className="text-lg font-semibold">{t('brand.name')}</span>
          <span className="num text-xs text-fg-subtle" data-testid="about-version">
            {t('settings.version', { version })}
          </span>
        </div>
      </div>
      <p className="text-xs whitespace-pre-line text-fg-muted" data-testid="about-disclaimer">
        {t('brand.disclaimer')}
      </p>
      <section className="flex flex-col gap-1.5 border-t border-divider pt-3">
        <h3 className="text-xs font-semibold text-fg-subtle">{t('settings.thirdParty')}</h3>
        <ul className="flex flex-col gap-1 text-xs text-fg-muted">
          <li>{t('settings.licenses.ffmpeg')}</li>
          <li>{t('settings.licenses.ark')}</li>
          <li>{t('settings.licenses.plex')}</li>
          <li>{t('settings.licenses.noto')}</li>
          <li>{t('settings.licenses.phosphor')}</li>
          <li>{t('settings.licenses.npm')}</li>
        </ul>
      </section>
    </div>
  );
}

export function SettingsDialog() {
  const { t } = useTranslation();
  const page = useUiStore((s) => s.settingsPage);
  const close = () => useUiStore.getState().openDialog(null);
  return (
    <Dialog open onOpenChange={(open) => !open && close()}>
      <DialogContent closeLabel={t('common.close')} className="h-[520px] w-[720px] gap-3" data-testid="settings-dialog">
        <DialogTitle>{t('settings.title')}</DialogTitle>
        <Tabs value={page} onValueChange={(v) => useUiStore.setState({ settingsPage: v as typeof page })} orientation="vertical" className="flex min-h-0 flex-1 gap-4">
          <TabsList className="h-auto w-40 shrink-0 flex-col items-stretch gap-0.5 self-start">
            {(['general', 'assets', 'export', 'shortcuts', 'about'] as const).map((p) => (
              <TabsTrigger key={p} value={p} className="h-8 flex-none justify-start px-2.5" data-testid={`settings-tab-${p}`}>
                {t(`settings.pages.${p}`)}
              </TabsTrigger>
            ))}
          </TabsList>
          <div className="min-h-0 min-w-0 flex-1 overflow-y-auto pr-2 pl-1">
            <TabsContent value="general">
              <General />
            </TabsContent>
            <TabsContent value="assets">
              <Assets />
            </TabsContent>
            <TabsContent value="export">
              <ExportPage />
            </TabsContent>
            <TabsContent value="shortcuts">
              <Shortcuts />
            </TabsContent>
            <TabsContent value="about">
              <About />
            </TabsContent>
          </div>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
