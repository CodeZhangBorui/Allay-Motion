// 动画工作区（docs/animation-editor.md 第 5 节）：当前模板是自建动画时，主界面换成编辑动画的布局——
// 左栏多“图层”、右栏多“动画”（属性与关键帧）、时间轴换成图层与关键帧的时间轴（AnimTimeline）、可选的“动画代码”停靠面板。
// 全部经界面注册表挂上，退出动画（选了别的模板）就撤掉。预览区不变：画面由引擎按生成的模板代码渲染。
import { useProjectStore } from '../../stores/projectStore';
import { useWorkspaceMode } from '../../app/workspaceMode';
import { useUiStore } from '../../stores/uiStore';
import { registerPanel, type MenuItemDef } from '../../app/registry';
import { AnimCodePanel } from './AnimCodePanel';
import { AnimPropsPanel, AnimPropsActions } from './AnimPropsPanel';
import { LayersActions, LayersPanel } from './LayersPanel';
import { useAnimationUi } from './uiState';
import { startCodeWindowBridge } from './codeWindow';

import { ANIMATION_COMMANDS as BASE_COMMANDS } from './commands';
import { LAYER_COMMANDS } from './commands-layers';
import { ANIMATION_R3_COMMANDS } from './commands-r3';
import { TIMELINE_COMMANDS } from './commands-timeline';

export const ANIMATION_COMMANDS = [...BASE_COMMANDS, ...ANIMATION_R3_COMMANDS, ...LAYER_COMMANDS, ...TIMELINE_COMMANDS];

export const ANIMATION_MENU_ITEMS: MenuItemDef[] = [
  { id: 'file.newAnimation', menu: 'file', group: 0, order: 1, command: 'animNew', testId: 'menu-anim-new' },
  { id: 'file.animConvert', menu: 'file', group: 2, order: 3, command: 'animConvertToTemplate', testId: 'menu-anim-convert' },
  { id: 'view.animCodeWindow', menu: 'view', group: 3, order: 1, command: 'animOpenCodeWindow', testId: 'menu-anim-code-window' },
  { id: 'view.animExternal', menu: 'view', group: 3, order: 2, command: 'animOpenExternal', testId: 'menu-anim-external' },
  { id: 'view.animCode', menu: 'view', group: 3, order: 3, command: 'animToggleCode', testId: 'menu-anim-code' },
];

export function useAnimationActive(): boolean {
  return useProjectStore((s) => !!s.template?.animation);
}

let codePanel: (() => void) | null = null;
let registered = false;

/** 图层、检查器只在动画模式下出现（registry 的 modes）；进入时随界面变形一起淡入，退出时淡出 */
function registerPanels(): void {
  if (registered) return;
  registered = true;
  registerPanel({ id: 'animLayers', titleKey: 'anim.layers.title', region: 'left', order: -10, component: LayersPanel, actions: LayersActions, testId: 'left-tab-anim-layers', modes: ['animation'] });
  registerPanel({ id: 'animProps', titleKey: 'anim.props.title', region: 'right', order: -10, component: AnimPropsPanel, actions: AnimPropsActions, testId: 'right-tab-anim-props', modes: ['animation'] });
}

function applyCodePanel(active: boolean, codeOpen: boolean): void {
  const wantCode = active && codeOpen;
  if (wantCode && !codePanel) codePanel = registerPanel({ id: 'animCode', titleKey: 'anim.code.title', region: 'dock', order: 0, component: AnimCodePanel, testId: 'dock-anim-code' });
  else if (!wantCode && codePanel) {
    codePanel();
    codePanel = null;
  }
}

/** 启动时调用一次（core.tsx）：之后跟着工作区模式和“动画代码”面板的开关变 */
export function startAnimationWorkspace(): void {
  startCodeWindowBridge();
  registerPanels();
  const sync = () => applyCodePanel(useWorkspaceMode.getState().shown === 'animation', useAnimationUi.getState().codeOpen);
  sync();
  // 界面换到动画模式的那一刻（淡出结束、淡入开始前）切到图层和检查器
  useWorkspaceMode.subscribe((s, prev) => {
    if (s.shown === prev.shown) return;
    if (s.shown === 'animation') useUiStore.setState({ leftTab: 'animLayers', rightTab: 'animProps' });
    else useUiStore.setState({ leftTab: 'templates', rightTab: 'props' });
    sync();
  });
  useAnimationUi.subscribe((s, prev) => {
    if (s.codeOpen !== prev.codeOpen) sync();
  });
}
