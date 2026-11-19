// 开发模式（docs/06-ui-design.md 6.15；docs/decisions.md“2026-11 反馈：开发模式、代码编辑与动画编辑器”）。
// 一个固定的位置：“视图”菜单里的“开发模式”开关（命令 toggleDevMode，命令面板里也有），设置里有一页“开发”说明它。
// 打开后：左栏多一个“开发”标签页（DevPanel）、状态栏左侧有“开发模式”指示，可选模块（内嵌代码编辑器等）随它启用。
// 关着时界面和以前完全一样。
import { DropdownMenuCheckboxItem } from '@allay/ui/components/dropdown-menu';
import { ICON } from '@allay/ui/lib/icons';
import { Code } from '@phosphor-icons/react';
import { useTranslation } from 'react-i18next';
import { defineCommand, registerPanel, type AnyCommand, type MenuItemComponentProps } from '../../app/registry';
import { useUiStore } from '../../stores/uiStore';
import { DevPanel } from './DevPanel';

export function devModeOn(): boolean {
  return useUiStore.getState().settings.devMode;
}

export function setDevMode(on: boolean): void {
  useUiStore.getState().update({ devMode: on });
}

/**
 * 可选模块实际生效的开关表：开发模式关着时全关；开着时，发现了的模块除非在设置里单独关掉（false），都启用。
 * 主程序仍然不认识任何具体的模块，只看目录名。
 */
export function effectiveModuleSwitches(available: readonly string[], devMode: boolean, switches: Readonly<Record<string, boolean>>): Record<string, boolean> {
  if (!devMode) return {};
  return Object.fromEntries(available.map((id) => [id, switches[id] !== false]));
}

export const DEV_MODE_COMMANDS: AnyCommand[] = [
  defineCommand({
    id: 'toggleDevMode',
    titleKey: 'devMode.commands.toggle',
    category: 'view',
    icon: Code,
    effect: 'read',
    run: () => setDevMode(!devModeOn()),
  }),
];

/** “视图”菜单里的开关（带勾） */
export function DevModeMenuItem(_props: MenuItemComponentProps) {
  const { t } = useTranslation();
  const on = useUiStore((s) => s.settings.devMode);
  return (
    <DropdownMenuCheckboxItem checked={on} onCheckedChange={(v) => setDevMode(v)} data-testid="menu-dev-mode">
      {t('devMode.menu')}
    </DropdownMenuCheckboxItem>
  );
}

/** 状态栏左侧的指示：开发模式开着时显示，点一下打开左栏的“开发”标签页 */
export function DevModeIndicator() {
  const { t } = useTranslation();
  const on = useUiStore((s) => s.settings.devMode);
  if (!on) return null;
  return (
    <button
      type="button"
      className="flex items-center gap-1.5 text-primary-text hover:text-foreground"
      data-testid="status-dev-mode"
      title={t('devMode.indicatorHint')}
      onClick={() => useUiStore.setState({ leftTab: 'dev' })}
    >
      <Code size={ICON.sm - 1} weight="bold" />
      {t('devMode.indicator')}
    </button>
  );
}

let unregisterPanel: (() => void) | null = null;

/** 开发模式开着时把“开发”标签页挂到左栏（启动时调用一次，之后跟着设置变） */
export function startDevMode(): void {
  const apply = (on: boolean) => {
    if (on && !unregisterPanel) {
      unregisterPanel = registerPanel({ id: 'dev', titleKey: 'devMode.panel.title', region: 'left', order: 50, component: DevPanel, testId: 'left-tab-dev' });
    } else if (!on && unregisterPanel) {
      unregisterPanel();
      unregisterPanel = null;
    }
  };
  apply(devModeOn());
  useUiStore.subscribe((s, prev) => {
    if (s.settings.devMode === prev.settings.devMode) return;
    apply(s.settings.devMode);
    // 刚打开时切到“开发”页，让人看到它在哪
    if (s.settings.devMode) useUiStore.setState({ leftTab: 'dev' });
  });
}
