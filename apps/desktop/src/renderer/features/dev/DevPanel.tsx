// 开发模式的“开发”标签页（docs/06-ui-design.md 6.15）：只在开发模式开着时出现在左栏。
// 当前模板是什么、能做什么（复制内置模板来改、打开用户模板的文件夹、可选模块提供的工具）、热重载的诊断、新建动画。
// 这里只调命令（经注册表的 dispatch），不自己做事。
import { Button } from '@allay/ui/components/button';
import { ScrollArea } from '@allay/ui/components/misc';
import { ICON } from '@allay/ui/lib/icons';
import { Copy, FilmSlate, FolderUser } from '@phosphor-icons/react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { commandEnabled, trigger, useCommands, useRegistry } from '../../app/registry';
import { useDevStore } from '../../stores/devStore';
import { useProjectStore } from '../../stores/projectStore';
import { useTemplateStore } from '../../stores/templateStore';
import { localized } from '../../templates/catalog';
import { diagnosticPosition, diagnosticTitle } from '../preview/DevOverlay';

function Section({ title, children, testId }: { title: string; children: ReactNode; testId?: string }) {
  return (
    <section className="flex flex-col gap-2 border-t border-divider px-3.5 py-3 first:border-t-0" data-testid={testId}>
      <h3 className="text-xs font-semibold text-fg-subtle">{title}</h3>
      {children}
    </section>
  );
}

function CommandButton({ id, icon: Icon, label }: { id: string; icon: typeof Copy; label: string }) {
  const command = useRegistry((s) => s.commands[id]);
  // 可用条件依赖当前模板：订阅一下，换模板时重画
  useProjectStore((s) => s.template);
  if (!command) return null;
  return (
    <Button variant="secondary" className="justify-start" disabled={!commandEnabled(command)} onClick={() => trigger(id)} data-testid={`dev-action-${id}`}>
      <Icon size={ICON.sm} />
      {label}
    </Button>
  );
}

export function DevPanel() {
  const { t, i18n } = useTranslation();
  const template = useProjectStore((s) => s.template);
  const entry = useTemplateStore((s) => (template ? s.entries.find((e) => e.id === template.ref.id && e.version === template.ref.version) : undefined));
  const diagnostics = useDevStore((s) => s.diagnostics);
  // 可选模块注册的命令：id 带“<模块>.”前缀（核心命令的 id 不带点，H1）
  const tools = useCommands().filter((c) => c.id.includes('.') && !c.hideInPalette);
  const kind = template?.animation ? 'animation' : entry?.source === 'user' ? 'user' : entry ? 'builtin' : 'none';
  return (
    <ScrollArea className="min-h-0 flex-1" data-testid="dev-panel">
      <p className="px-3.5 pb-2 text-xs leading-snug text-fg-subtle">{t('devMode.panel.intro')}</p>
      <Section title={t('devMode.panel.current')} testId="dev-current">
        <div className="flex items-baseline gap-2">
          <span className="truncate text-sm text-foreground">{template ? localized(template.manifest.name, i18n.language) : '—'}</span>
          <span className="shrink-0 text-xs text-fg-subtle" data-testid="dev-current-kind" data-kind={kind}>
            {t(`devMode.panel.kinds.${kind}`)}
          </span>
        </div>
        <p className="text-xs leading-snug text-fg-subtle">{t(`devMode.panel.kindHints.${kind}`)}</p>
        <CommandButton id="copyBuiltinTemplate" icon={Copy} label={t('devMode.panel.copy')} />
        <CommandButton id="openTemplateFolder" icon={FolderUser} label={t('devMode.panel.openFolder')} />
        <CommandButton id="animEditTemplate" icon={FilmSlate} label={t('anim.commands.editTemplate')} />
      </Section>
      <Section title={t('devMode.panel.tools')} testId="dev-tools">
        {tools.length === 0 ? (
          <p className="text-xs leading-snug text-fg-subtle" data-testid="dev-no-tools">
            {t('devMode.panel.noTools')}
          </p>
        ) : (
          tools.map((c) => (
            <Button key={c.id} variant="secondary" className="justify-start" disabled={!commandEnabled(c)} onClick={() => trigger(c.id)} data-testid={`dev-tool-${c.id}`}>
              {t(c.titleKey)}
            </Button>
          ))
        )}
      </Section>
      <Section title={t('devMode.panel.diagnostics')} testId="dev-diagnostics">
        {diagnostics.length === 0 ? (
          <p className="text-xs text-fg-subtle">{t('devMode.panel.noDiagnostics')}</p>
        ) : (
          <ul className="flex flex-col gap-1.5">
            {diagnostics.map((d, i) => {
              const pos = diagnosticPosition(t, d);
              return (
                <li key={i} className="flex flex-col text-xs">
                  <span className="text-foreground">{diagnosticTitle(t, d)}</span>
                  {pos && <span className="num text-primary-text">{pos}</span>}
                </li>
              );
            })}
          </ul>
        )}
      </Section>
      <Section title={t('devMode.panel.animation')}>
        <p className="text-xs leading-snug text-fg-subtle">{t('devMode.panel.animationHint')}</p>
        <CommandButton id="animNew" icon={FilmSlate} label={t('anim.commands.new')} />
      </Section>
    </ScrollArea>
  );
}
