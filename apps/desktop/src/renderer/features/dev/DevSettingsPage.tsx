// 设置里的“开发”一页（docs/06-ui-design.md 6.15）：开发模式开关和它的说明、可选模块的开关。
// 可选模块只按目录名列出（主程序不认识具体的模块）；开发模式关着时它们都不加载。
import { Switch } from '@allay/ui/components/switch';
import { useTranslation } from 'react-i18next';
import { useUiStore } from '../../stores/uiStore';
import { SettingsPageHeader, SettingsRow, SettingsSection } from '../settings/layout';
import { setDevMode } from './devMode';

/** 这次构建里发现的可选模块（目录名），由 core.tsx 交进来，避免这里引用模块管理器 */
let availableModules: readonly string[] = [];
export function setAvailableModules(ids: readonly string[]): void {
  availableModules = ids;
}

export function DevSettingsPage() {
  const { t } = useTranslation();
  const on = useUiStore((s) => s.settings.devMode);
  const switches = useUiStore((s) => s.settings.optionalModules);
  return (
    <div className="flex flex-col">
      <SettingsPageHeader title={t('devMode.settings.title')} description={t('devMode.settings.description')} />
      <SettingsSection>
        <SettingsRow label={t('devMode.menu')} hint={t('devMode.settings.switchHint')} htmlFor="settings-dev-mode">
          <Switch id="settings-dev-mode" checked={on} onCheckedChange={(v) => setDevMode(v)} data-testid="settings-dev-mode" />
        </SettingsRow>
      </SettingsSection>
      <SettingsSection title={t('devMode.settings.whereTitle')}>
        <ul className="flex max-w-[60ch] list-disc flex-col gap-1 pl-4 text-xs leading-snug text-fg-muted">
          <li>{t('devMode.settings.where1')}</li>
          <li>{t('devMode.settings.where2')}</li>
          <li>{t('devMode.settings.where3')}</li>
          <li>{t('devMode.settings.where4')}</li>
        </ul>
      </SettingsSection>
      <SettingsSection title={t('devMode.settings.modulesTitle')} description={t('devMode.settings.modulesHint')} testId="settings-optional-modules">
        {availableModules.length === 0 ? (
          <p className="py-2 text-xs text-fg-subtle">{t('devMode.settings.noModules')}</p>
        ) : (
          availableModules.map((id) => (
            <SettingsRow key={id} label={<span className="num">{id}</span>} hint={t('devMode.settings.moduleHint')}>
              <Switch
                checked={switches[id] !== false}
                disabled={!on}
                aria-label={id}
                data-testid={`settings-module-${id}`}
                onCheckedChange={(v) => useUiStore.getState().update({ optionalModules: { ...switches, [id]: v } })}
              />
            </SettingsRow>
          ))
        )}
      </SettingsSection>
    </div>
  );
}
