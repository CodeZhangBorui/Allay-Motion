import i18next from 'i18next';
import { effectiveShortcut, resolveShortcuts, type ShortcutOverrides } from '../../../shared/shortcuts';
import { getCommand, useRegistry, type AnyCommand } from '../../app/registry';
import { useUiStore } from '../../stores/uiStore';

// 生效的快捷键（6.11）：命令定义里的默认值，加上设置里的自定义（ui.shortcuts）。菜单、命令面板、工具提示、
// 快捷键设置页和全局按键处理都经这里取，不直接读命令的 shortcut 字段。

/** 其他快捷键写法（只用于按键匹配，不显示）：Ctrl+Y 也是重做。用户把 Ctrl+Y 绑给别的命令时以用户的为准 */
export const SHORTCUT_ALIASES: Record<string, string> = { 'Ctrl+Y': 'redo' };

function overrides(): ShortcutOverrides {
  return useUiStore.getState().settings.shortcuts;
}

/** 一条命令现在的快捷键；没有时为 null */
export function shortcutFor(id: string): string | null {
  const cmd = getCommand(id);
  return cmd ? effectiveShortcut(cmd, overrides()) : null;
}

/** 同上，界面里用（自定义或注册表变了会重渲染） */
export function useShortcutFor(id: string): string | null {
  const cmd = useRegistry((s) => s.commands[id]);
  const o = useUiStore((s) => s.settings.shortcuts);
  return cmd ? effectiveShortcut(cmd, o) : null;
}

/** 生效的快捷键表（按注册顺序解决重复） */
export function shortcutMap(commands: readonly AnyCommand[] = Object.values(useRegistry.getState().commands), o: ShortcutOverrides = overrides()) {
  return resolveShortcuts(commands, o);
}

/** 某个按键对应的命令 id */
export function commandForShortcut(shortcut: string): string | undefined {
  const id = shortcutMap().byKey.get(shortcut);
  return id ?? SHORTCUT_ALIASES[shortcut];
}

/** 快捷键的显示文字：Space → 空格、方向键 → 箭头，其余照写 */
export function shortcutLabel(s: string): string {
  const parts = s.split('+');
  const key = parts.pop() ?? '';
  const names: Record<string, string> = {
    Space: i18next.t('shortcuts.keys.space'),
    Left: '←',
    Right: '→',
    Up: '↑',
    Down: '↓',
    Esc: 'Esc',
    PageUp: 'PgUp',
    PageDown: 'PgDn',
  };
  return [...parts, names[key] ?? key].join('+');
}
