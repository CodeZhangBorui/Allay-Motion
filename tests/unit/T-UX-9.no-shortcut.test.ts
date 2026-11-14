import { afterEach, describe, expect, it } from 'vitest';
import { registerCommand, useRegistry, type AnyCommand } from '../../apps/desktop/src/renderer/app/registry';
import { bindableCommands, commandForShortcut, shortcutFor, shortcutMap } from '../../apps/desktop/src/renderer/features/commands/shortcutState';
import { useUiStore } from '../../apps/desktop/src/renderer/stores/uiStore';

// T-UX-9 一次性整页流程的命令不能有快捷键（docs/06-ui-design.md 6.14、docs/decisions.md 新手引导）：
// 不写默认键、不出现在快捷键设置页，设置文件里给它记的键也不生效。

const disposers: (() => void)[] = [];
afterEach(() => {
  while (disposers.length) disposers.pop()!();
  useUiStore.setState((s) => ({ settings: { ...s.settings, shortcuts: {} } }));
});

const cmd = (def: Partial<AnyCommand> & { id: string }): AnyCommand => ({ titleKey: 'x', effect: 'read', run: () => undefined, ...def }) as AnyCommand;

describe('T-UX-9 不能有快捷键的命令', () => {
  it('快捷键设置页不列 noShortcut 的命令，其余照旧', () => {
    const list = [cmd({ id: 'play', shortcut: 'Space' }), cmd({ id: 'flow', noShortcut: true }), cmd({ id: 'theme' }), cmd({ id: 'internal', hideInPalette: true })];
    expect(bindableCommands(list).map((c) => c.id)).toEqual(['play', 'theme']);
  });

  it('设置文件里给它记的按键不生效，也不显示', () => {
    disposers.push(registerCommand(cmd({ id: 'nsc.flow', noShortcut: true })));
    disposers.push(registerCommand(cmd({ id: 'nsc.other' })));
    useUiStore.setState((s) => ({ settings: { ...s.settings, shortcuts: { 'nsc.flow': 'Ctrl+Alt+O', 'nsc.other': 'Ctrl+Alt+P' } } }));
    expect(commandForShortcut('Ctrl+Alt+O')).toBeUndefined();
    expect(shortcutFor('nsc.flow')).toBeNull();
    expect(commandForShortcut('Ctrl+Alt+P')).toBe('nsc.other');
    expect([...shortcutMap(Object.values(useRegistry.getState().commands)).byKey.values()]).not.toContain('nsc.flow');
  });

  it('noShortcut 的命令不能带默认快捷键', () => {
    expect(() => registerCommand(cmd({ id: 'nsc.bad', noShortcut: true, shortcut: 'F6' }))).toThrow(/noShortcut/);
  });
});
