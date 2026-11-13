import { useEffect } from 'react';
import { commandEnabled, getCommand, trigger, useRegistry } from '../../app/registry';
import { SHORTCUT_ALIASES, stepFrames } from './commands';

// 全局快捷键（6.7）：按注册表里各命令的 shortcut 匹配（核心命令和可选模块的命令一样）。
// 焦点在文本输入框里时，单字母和空格快捷键不生效；已经被控件处理过的按键（defaultPrevented，
// 例如数字框和时间轴自己的方向键）不再处理。逐帧的左右方向键不是命令，在这里直接处理。

function isTextInput(el: Element | null): boolean {
  if (!el) return false;
  if (el instanceof HTMLTextAreaElement) return true;
  if (el instanceof HTMLInputElement) return !['checkbox', 'radio', 'button', 'submit', 'range', 'color', 'file'].includes(el.type);
  return (el as HTMLElement).isContentEditable === true;
}

/** 空格会激活聚焦的按钮：这时不当成播放快捷键 */
function isActivatable(el: Element | null): boolean {
  if (!el) return false;
  return el.matches('button, a[href], [role="button"], [role="checkbox"], [role="switch"], [role="menuitem"], [role="option"], [role="tab"], [role="slider"], [role="radio"], input, select, summary');
}

/** 弹层或对话框开着时，单键快捷键不生效（它们有自己的键盘操作） */
function inOverlay(el: Element | null): boolean {
  return !!el?.closest('[role="dialog"], [role="menu"], [role="listbox"], [data-slot="popover-content"]');
}

const KEY_NAMES: Record<string, string> = { Comma: ',', Period: '.', Slash: '/', Space: 'Space', Home: 'Home', End: 'End', Escape: 'Esc' };

/** 按键 → 快捷键写法（'Ctrl+Shift+Z'、'Space'、'L'）；认不出的键返回 null */
export function shortcutOf(e: Pick<KeyboardEvent, 'code' | 'ctrlKey' | 'metaKey' | 'shiftKey' | 'altKey'>): string | null {
  let k: string | undefined;
  if (/^Key[A-Z]$/.test(e.code)) k = e.code.slice(3);
  else if (/^Digit\d$/.test(e.code)) k = e.code.slice(5);
  else if (/^F\d{1,2}$/.test(e.code)) k = e.code;
  else k = KEY_NAMES[e.code];
  if (!k) return null;
  return [e.ctrlKey || e.metaKey ? 'Ctrl' : '', e.altKey ? 'Alt' : '', e.shiftKey ? 'Shift' : '', k].filter(Boolean).join('+');
}

/** 某个快捷键对应的命令 id */
export function commandForShortcut(shortcut: string): string | undefined {
  const alias = SHORTCUT_ALIASES[shortcut];
  if (alias) return alias;
  return Object.values(useRegistry.getState().commands).find((c) => c.shortcut === shortcut)?.id;
}

export function useShortcuts(): void {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.isComposing) return;
      const target = document.activeElement;
      const ctrl = e.ctrlKey || e.metaKey;
      if (!ctrl && !e.altKey) {
        // 单键：文本框里、弹层里不生效
        if (isTextInput(target) || inOverlay(target)) return;
        if (e.code === 'ArrowLeft' || e.code === 'ArrowRight') {
          if (isActivatable(target) && target?.getAttribute('role') === 'slider') return;
          e.preventDefault();
          return stepFrames((e.code === 'ArrowLeft' ? -1 : 1) * (e.shiftKey ? 10 : 1));
        }
        if (e.code === 'Space' && isActivatable(target)) return;
      }
      const shortcut = shortcutOf(e);
      if (!shortcut) return;
      const id = commandForShortcut(shortcut);
      const cmd = id ? getCommand(id) : undefined;
      if (!cmd || !commandEnabled(cmd)) return;
      e.preventDefault();
      trigger(cmd.id);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}
