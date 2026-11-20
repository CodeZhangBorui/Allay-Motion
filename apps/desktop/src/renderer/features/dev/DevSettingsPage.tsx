// 设置里的“开发”一页（docs/06-ui-design.md 6.15）：开发模式开关和它的说明、可选模块的开关。
// 可选模块只按目录名列出（主程序不认识具体的模块）；开发模式关着时它们都不加载。
import { Button } from '@allay/ui/components/button';
import { Switch } from '@allay/ui/components/switch';
import { EnumField } from '@allay/ui/editor';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { CodeEditorKind, EditorInfo } from '../../../shared/code-window';
import { useUiStore } from '../../stores/uiStore';
import { SettingsPageHeader, SettingsRow, SettingsSection } from '../settings/layout';
import { setDevMode } from './devMode';

/** 这次构建里发现的可选模块（目录名），由 core.tsx 交进来，避免这里引用模块管理器 */
let availableModules: readonly string[] = [];
export function setAvailableModules(ids: readonly string[]): void {
  availableModules = ids;
}

/** 打开动画代码用什么（docs/animation-editor.md 6.12）：程序只由主进程的对话框选，这里只看到文件名 */
function CodeEditorChoice() {
  const { t } = useTranslation();
  const [info, setInfo] = useState<EditorInfo | null>(null);
  useEffect(() => void window.allay.editors.get().then(setInfo), []);
  if (!info) return null;
  const kinds: CodeEditorKind[] = ['builtin', 'system', 'custom'];
  return (
    <SettingsSection title={t('devMode.settings.editorTitle')} description={t('devMode.settings.editorHint')} testId="settings-code-editor">
      <SettingsRow label={t('devMode.settings.editorKind')}>
        <div className="w-72">
          <EnumField
            value={info.kind}
            label={t('devMode.settings.editorKind')}
            testId="settings-code-editor-kind"
            options={kinds.map((k) => ({ value: k, label: t(`devMode.settings.editorKinds.${k}`) }))}
            onChange={(v) => void window.allay.editors.setKind(v as CodeEditorKind).then(setInfo)}
          />
        </div>
      </SettingsRow>
      {info.kind === 'custom' && (
        <SettingsRow label={t('devMode.settings.editorProgram')} hint={info.programName ?? t('devMode.settings.editorNoProgram')}>
          <Button variant="secondary" data-testid="settings-code-editor-choose" onClick={() => void window.allay.editors.chooseProgram().then(setInfo)}>
            {t('devMode.settings.editorChoose')}
          </Button>
        </SettingsRow>
      )}
    </SettingsSection>
  );
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
      <CodeEditorChoice />
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
