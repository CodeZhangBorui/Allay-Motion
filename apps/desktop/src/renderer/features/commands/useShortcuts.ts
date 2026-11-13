import { useEffect } from 'react';
import { commandById, stepFrames } from './commands';

// 全局快捷键（6.7）。焦点在文本输入框里时，单字母和空格快捷键不生效；
// 已经被控件处理过的按键（defaultPrevented，例如数字框和时间轴自己的方向键）不再处理。

function isTextInput(el: Element | null): boolean {
  if (!el) return false;
  if (el instanceof HTMLTextAreaElement) return true;
  if (el instanceof HTMLInputElement) return !['checkbox', 'radio', 'button', 'submit', 'range', 'color', 'file'].includes(el.type);
  return (el as HTMLElement).isContentEditable === true;
}

/** 空格会激活聚焦的按钮：这时不当成播放快捷键 */
function isActivatable(el: Element | null): boolean {
  if (!el) return false;
  return el.matches('button, a[href], [role="button"], [role="checkbox"], [role="switch"], [role="menuitem"], [role="option"], [role="tab"], [role="slider"], input, select, summary');
}

/** 弹层或对话框开着时，单键快捷键不生效（它们有自己的键盘操作） */
function inOverlay(el: Element | null): boolean {
  return !!el?.closest('[role="dialog"], [role="menu"], [role="listbox"], [data-slot="popover-content"]');
}

export function useShortcuts(): void {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.isComposing) return;
      const target = document.activeElement;
      const ctrl = e.ctrlKey || e.metaKey;
      const run = (id: string) => {
        const cmd = commandById(id);
        if (!cmd || (cmd.enabled && !cmd.enabled())) return;
        e.preventDefault();
        cmd.run();
      };
      if (ctrl && !e.altKey) {
        const k = e.code;
        if (k === 'KeyZ') return run(e.shiftKey ? 'redo' : 'undo');
        if (k === 'KeyY' && !e.shiftKey) return run('redo');
        if (k === 'KeyS') return run(e.shiftKey ? 'saveProjectAs' : 'saveProject');
        if (e.shiftKey) return;
        if (k === 'KeyN') return run('newProject');
        if (k === 'KeyO') return run('openProject');
        if (k === 'KeyE') return run('export');
        if (k === 'KeyK') return run('palette');
        if (k === 'KeyF') return run('searchTemplates');
        if (k === 'Comma') return run('settings');
        // Ctrl+B 由分栏组件处理（M0）
        return;
      }
      if (e.altKey || ctrl) return;
      if (isTextInput(target) || inOverlay(target)) return;
      switch (e.code) {
        case 'Space':
          if (isActivatable(target)) return;
          return run('playPause');
        case 'ArrowLeft':
        case 'ArrowRight':
          if (isActivatable(target) && target?.getAttribute('role') === 'slider') return;
          e.preventDefault();
          return stepFrames((e.code === 'ArrowLeft' ? -1 : 1) * (e.shiftKey ? 10 : 1));
        case 'Home':
          return run('toStart');
        case 'End':
          return run('toEnd');
        case 'KeyL':
          return run('loop');
        case 'KeyR':
          return run('reroll');
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}
