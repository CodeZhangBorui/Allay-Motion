// 可选模块：应用内的模板代码编辑器（docs/code-editing-and-mcp-plan.md 第 3 节、P1）。
// 只经 @allay/host-api 接入（eslint 的依赖方向规则 T-DEV-4 强制），主程序不引用这里；删掉整个目录、刷新 lockfile，
// 主程序照常工作（pnpm check:removable）。随开发模式启用（设置里可以单独关掉）。
//
// 提供两样东西：
// 1. “模板代码”停靠面板：当前模板的 template.js，命令 code-editor.open / code-editor.close（开发页的“工具”、命令面板里有）；
// 2. 代码视图（ui.registerCodeView）：主程序里需要编辑代码的地方（动画的“动画代码”面板）用这里的 CodeMirror。
import type { Disposable, EditorHost, HostLocale } from '@allay/host-api';
import { createEditor } from './editor';
import { MESSAGES } from './messages';
import { mountTemplatePanel } from './template-panel';

export const MODULE_ID = 'code-editor';

export function activate(host: EditorHost): Disposable {
  const owned: Disposable[] = [];
  for (const locale of Object.keys(MESSAGES) as HostLocale[]) owned.push(host.ui.registerMessages(locale, MESSAGES[locale]));
  owned.push(host.ui.registerCodeView((container, options) => createEditor(container as HTMLElement, options)));

  let panel: Disposable | null = null;
  const close = () => {
    panel?.dispose();
    panel = null;
  };
  const open = () => {
    if (panel) return;
    panel = host.ui.registerPanel({
      id: `${MODULE_ID}.panel`,
      titleKey: `${MODULE_ID}.panel.title`,
      location: 'bottom',
      mount: (container) => mountTemplatePanel(container as HTMLElement, host, close),
    });
  };
  owned.push(
    host.ui.registerCommand({ id: `${MODULE_ID}.open`, titleKey: `${MODULE_ID}.commands.open`, effect: 'read', run: open }),
    host.ui.registerCommand({ id: `${MODULE_ID}.close`, titleKey: `${MODULE_ID}.commands.close`, effect: 'read', run: close }),
  );
  return {
    dispose() {
      close();
      for (const d of owned.reverse()) d.dispose();
    },
  };
}

export default { id: MODULE_ID, activate };
