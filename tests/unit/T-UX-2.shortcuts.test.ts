import { describe, expect, it } from 'vitest';
import {
  bindShortcut,
  conflictFor,
  effectiveShortcut,
  isShortcut,
  reservedReason,
  resetShortcut,
  resolveShortcuts,
  setOverride,
  shortcutFromEvent,
} from '../../apps/desktop/src/shared/shortcuts';

// T-UX-2 快捷键：写法、按键换算、保留键、冲突与恢复默认（docs/06-ui-design.md 6.11）

const key = (code: string, mods: Partial<{ ctrl: boolean; alt: boolean; shift: boolean; meta: boolean }> = {}) => ({
  code,
  ctrlKey: !!mods.ctrl,
  altKey: !!mods.alt,
  shiftKey: !!mods.shift,
  metaKey: !!mods.meta,
});

const COMMANDS = [
  { id: 'playPause', shortcut: 'Space' },
  { id: 'loop', shortcut: 'L' },
  { id: 'reroll', shortcut: 'R' },
  { id: 'undo', shortcut: 'Ctrl+Z' },
  { id: 'settings', shortcut: 'Ctrl+,' },
  { id: 'guides' },
];

describe('T-UX-2 快捷键', () => {
  it('写法：修饰键按 Ctrl、Alt、Shift 的顺序，最后一个键名', () => {
    for (const s of ['L', 'Space', 'Ctrl+Z', 'Ctrl+Shift+Z', 'Ctrl+Alt+Shift+F12', 'Ctrl+,', 'Alt+[', 'F5', 'Shift+Home']) expect(isShortcut(s), s).toBe(true);
    for (const s of ['', 'l', 'Shift+Ctrl+Z', 'Ctrl+Ctrl+Z', 'Ctrl+', 'Win+L', 'Ctrl+F25', 'Ctrl+Plus', 'Meta+K', 'Ctrl+Shift']) expect(isShortcut(s), s).toBe(false);
  });

  it('按键换算按物理键位；Cmd 当 Ctrl；单独的修饰键不算', () => {
    expect(shortcutFromEvent(key('KeyZ', { ctrl: true, shift: true }))).toBe('Ctrl+Shift+Z');
    expect(shortcutFromEvent(key('KeyK', { meta: true }))).toBe('Ctrl+K');
    expect(shortcutFromEvent(key('Comma', { ctrl: true }))).toBe('Ctrl+,');
    expect(shortcutFromEvent(key('Digit3', { alt: true }))).toBe('Alt+3');
    expect(shortcutFromEvent(key('Numpad7'))).toBe('7');
    expect(shortcutFromEvent(key('ArrowLeft', { shift: true }))).toBe('Shift+Left');
    expect(shortcutFromEvent(key('Escape'))).toBe('Esc');
    expect(shortcutFromEvent(key('ControlLeft', { ctrl: true }))).toBeNull();
    expect(shortcutFromEvent(key('ShiftRight', { shift: true }))).toBeNull();
    expect(shortcutFromEvent(key('IntlRo'))).toBeNull();
    // 换算出的写法总是合规的
    for (const code of ['KeyA', 'Digit0', 'F1', 'F24', 'Slash', 'Backquote', 'PageDown', 'Insert'])
      expect(isShortcut(shortcutFromEvent(key(code, { ctrl: true, alt: true, shift: true }))!), code).toBe(true);
  });

  it('保留键：系统级的、文本输入必需的、逐帧和列表导航的', () => {
    expect(reservedReason('Alt+F4')).toBe('system');
    expect(reservedReason('Alt+Tab')).toBe('system');
    expect(reservedReason('Ctrl+C')).toBe('text');
    expect(reservedReason('Ctrl+V')).toBe('text');
    expect(reservedReason('Ctrl+A')).toBe('text');
    expect(reservedReason('Backspace')).toBe('text');
    expect(reservedReason('Esc')).toBe('text');
    expect(reservedReason('Tab')).toBe('text');
    expect(reservedReason('Left')).toBe('navigation');
    expect(reservedReason('Shift+Right')).toBe('navigation');
    // 默认快捷键都不是保留键
    for (const s of ['Space', 'Home', 'End', 'L', 'R', 'Ctrl+Z', 'Ctrl+Shift+Z', 'Ctrl+N', 'Ctrl+O', 'Ctrl+S', 'Ctrl+Shift+S', 'Ctrl+E', 'Ctrl+K', 'Ctrl+F', 'Ctrl+B', 'Ctrl+,'])
      expect(reservedReason(s), s).toBeNull();
    // 绑定保留键被拒绝，设置不变
    const r = bindShortcut(COMMANDS, {}, 'loop', 'Ctrl+V', false);
    expect(r).toEqual({ ok: false, reserved: 'text' });
  });

  it('生效的快捷键：自定义优先，null 表示清除；等于默认值时不留自定义', () => {
    expect(effectiveShortcut(COMMANDS[1]!, {})).toBe('L');
    expect(effectiveShortcut(COMMANDS[1]!, { loop: 'Ctrl+L' })).toBe('Ctrl+L');
    expect(effectiveShortcut(COMMANDS[1]!, { loop: null })).toBeNull();
    expect(effectiveShortcut(COMMANDS[5]!, {})).toBeNull();
    expect(setOverride(COMMANDS, { loop: 'Ctrl+L' }, 'loop', 'L')).toEqual({});
    expect(setOverride(COMMANDS, {}, 'guides', 'G')).toEqual({ guides: 'G' });
  });

  it('冲突：指出和哪条命令冲突；选“替换”时那条命令被清除；不替换时什么都不改', () => {
    expect(conflictFor(COMMANDS, {}, 'guides', 'L')).toBe('loop');
    expect(conflictFor(COMMANDS, {}, 'loop', 'L')).toBeNull();
    const ask = bindShortcut(COMMANDS, {}, 'guides', 'L', false);
    expect(ask).toEqual({ ok: false, conflict: 'loop' });
    const replaced = bindShortcut(COMMANDS, {}, 'guides', 'L', true);
    expect(replaced).toEqual({ ok: true, overrides: { guides: 'L', loop: null } });
    if (!replaced.ok) throw new Error('unreachable');
    const { byKey, conflicts } = resolveShortcuts(COMMANDS, replaced.overrides);
    expect(byKey.get('L')).toBe('guides');
    expect(conflicts.size).toBe(0);
    // 没有冲突：直接绑上
    expect(bindShortcut(COMMANDS, {}, 'guides', 'G', false)).toEqual({ ok: true, overrides: { guides: 'G' } });
  });

  it('恢复默认：默认键已被别的命令占用时，那条命令被清除', () => {
    // loop 改成了 Ctrl+L，guides 拿走了 L
    const o = { loop: 'Ctrl+L', guides: 'L' };
    const r = resetShortcut(COMMANDS, o, 'loop');
    // guides 本来没有默认快捷键：清除它就是去掉那条自定义
    expect(r).toEqual({ overrides: {}, cleared: 'guides' });
    expect(resetShortcut(COMMANDS, { loop: null }, 'loop')).toEqual({ overrides: {}, cleared: null });
  });

  it('手改的设置文件里有重复：按命令先后取第一条，两条都标出来', () => {
    const { byKey, conflicts } = resolveShortcuts(COMMANDS, { reroll: 'L' });
    expect(byKey.get('L')).toBe('loop');
    expect([...conflicts].sort()).toEqual(['loop', 'reroll']);
  });
});
