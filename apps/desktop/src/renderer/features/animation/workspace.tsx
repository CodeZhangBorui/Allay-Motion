// 动画工作区（docs/animation-editor.md 第 5 节）：当前模板是自建动画时，主界面换成编辑动画的布局——
// 左栏多“图层”、右栏多“动画”（属性与关键帧）、时间轴换成图层与关键帧的时间轴（AnimTimeline）、可选的“动画代码”停靠面板。
// 全部经界面注册表挂上，退出动画（选了别的模板）就撤掉。预览区不变：画面由引擎按生成的模板代码渲染。
import { useProjectStore } from '../../stores/projectStore';
import { useUiStore } from '../../stores/uiStore';
import { registerPanel, type MenuItemDef } from '../../app/registry';
import { AnimCodePanel } from './AnimCodePanel';
import { AnimPropsPanel, AnimPropsActions } from './AnimPropsPanel';
import { LayersActions, LayersPanel } from './LayersPanel';
import { useAnimationUi } from './uiState';

export { ANIMATION_COMMANDS } from './commands';

export const ANIMATION_MENU_ITEMS: MenuItemDef[] = [
  { id: 'file.newAnimation', menu: 'file', group: 0, order: 1, command: 'animNew', testId: 'menu-anim-new' },
  { id: 'file.animConvert', menu: 'file', group: 2, order: 3, command: 'animConvertToTemplate', testId: 'menu-anim-convert' },
  { id: 'view.animCode', menu: 'view', group: 3, order: 1, command: 'animToggleCode', testId: 'menu-anim-code' },
];

export function useAnimationActive(): boolean {
  return useProjectStore((s) => !!s.template?.animation);
}

let panels: (() => void)[] = [];
let codePanel: (() => void) | null = null;

function applyPanels(active: boolean, codeOpen: boolean): void {
  if (active && panels.length === 0) {
    panels = [
      registerPanel({ id: 'animLayers', titleKey: 'anim.layers.title', region: 'left', order: -10, component: LayersPanel, actions: LayersActions, testId: 'left-tab-anim-layers' }),
      registerPanel({ id: 'animProps', titleKey: 'anim.props.title', region: 'right', order: -10, component: AnimPropsPanel, actions: AnimPropsActions, testId: 'right-tab-anim-props' }),
    ];
    useUiStore.setState({ leftTab: 'animLayers', rightTab: 'animProps' });
  } else if (!active && panels.length > 0) {
    for (const off of panels) off();
    panels = [];
  }
  const wantCode = active && codeOpen;
  if (wantCode && !codePanel) codePanel = registerPanel({ id: 'animCode', titleKey: 'anim.code.title', region: 'dock', order: 0, component: AnimCodePanel, testId: 'dock-anim-code' });
  else if (!wantCode && codePanel) {
    codePanel();
    codePanel = null;
  }
}

/** 启动时调用一次（core.tsx）：之后跟着当前模板和“动画代码”的开关变 */
export function startAnimationWorkspace(): void {
  const sync = () => applyPanels(!!useProjectStore.getState().template?.animation, useAnimationUi.getState().codeOpen);
  sync();
  useProjectStore.subscribe((s, prev) => {
    if (!!s.template?.animation !== !!prev.template?.animation) sync();
  });
  useAnimationUi.subscribe((s, prev) => {
    if (s.codeOpen !== prev.codeOpen) sync();
  });
}
