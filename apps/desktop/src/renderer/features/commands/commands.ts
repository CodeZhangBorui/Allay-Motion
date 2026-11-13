// 应用的命令：快捷键（6.7）和命令面板（6.4，Ctrl+K）共用一张表。
import { randomSeed } from '@allay/ui/editor';
import i18next from 'i18next';
import { redo, undo, useProjectStore } from '../../stores/projectStore';
import { usePreviewStore } from '../../stores/previewStore';
import { useTransportStore } from '../../stores/transportStore';
import { useUiStore } from '../../stores/uiStore';
import { newProject, openProject, saveProject } from '../project/actions';

export interface Command {
  id: string;
  /** 文案键（command.<id>） */
  shortcut?: string;
  run(): void;
  enabled?(): boolean;
}

/** Workspace 注册的布局控制（折叠左栏） */
export const layout = { toggleLeft: () => undefined as void };

export function focusTemplateSearch(): void {
  const panel = document.querySelector<HTMLElement>('[data-testid="panel-left"]');
  if (panel && panel.getBoundingClientRect().width < 1) layout.toggleLeft();
  // 搜索框平时收起：切到“模板”页并展开它
  useUiStore.setState({ leftTab: 'templates', searchOpen: true });
  requestAnimationFrame(() => requestAnimationFrame(() => document.getElementById('gallery-search')?.focus()));
}

const ready = () => usePreviewStore.getState().status.kind === 'ready';

export function togglePlay(): void {
  const s = useTransportStore.getState();
  if (!ready()) return;
  if (!s.playing && s.time >= s.duration) s.setTime(0);
  s.setPlaying(!s.playing);
}

export function stepFrames(n: number): void {
  const s = useTransportStore.getState();
  const fps = useProjectStore.getState().output.fps;
  s.setPlaying(false);
  s.setTime(Math.round((s.time + n / fps) * fps) / fps);
}

export function rerollSeed(): void {
  const { template } = useProjectStore.getState();
  const def = template?.params.find((p) => p.type === 'seed' && !template.hidden.includes(p.key));
  if (def) useProjectStore.getState().setParams({ [def.key]: randomSeed() }, i18next.language);
}

export const COMMANDS: Command[] = [
  { id: 'playPause', shortcut: 'Space', run: togglePlay, enabled: ready },
  { id: 'toStart', shortcut: 'Home', run: () => useTransportStore.getState().setTime(0) },
  { id: 'toEnd', shortcut: 'End', run: () => useTransportStore.getState().setTime(useTransportStore.getState().duration) },
  { id: 'loop', shortcut: 'L', run: () => useTransportStore.getState().setLoop(!useTransportStore.getState().loop) },
  { id: 'reroll', shortcut: 'R', run: rerollSeed, enabled: () => !!useProjectStore.getState().template?.params.some((p) => p.type === 'seed') },
  { id: 'undo', shortcut: 'Ctrl+Z', run: undo, enabled: () => useProjectStore.temporal.getState().pastStates.length > 0 },
  { id: 'redo', shortcut: 'Ctrl+Shift+Z', run: redo, enabled: () => useProjectStore.temporal.getState().futureStates.length > 0 },
  { id: 'newProject', shortcut: 'Ctrl+N', run: () => void newProject() },
  { id: 'openProject', shortcut: 'Ctrl+O', run: () => void openProject() },
  { id: 'saveProject', shortcut: 'Ctrl+S', run: () => void saveProject() },
  { id: 'saveProjectAs', shortcut: 'Ctrl+Shift+S', run: () => void saveProject(true) },
  { id: 'export', shortcut: 'Ctrl+E', run: () => useUiStore.getState().openExport(), enabled: ready },
  { id: 'palette', shortcut: 'Ctrl+K', run: () => useUiStore.getState().openDialog('palette') },
  { id: 'searchTemplates', shortcut: 'Ctrl+F', run: focusTemplateSearch },
  { id: 'toggleLeft', shortcut: 'Ctrl+B', run: () => layout.toggleLeft() },
  { id: 'settings', shortcut: 'Ctrl+,', run: () => useUiStore.getState().openDialog('settings', 'general') },
  { id: 'resources', run: () => useUiStore.getState().setResourcesOpen(true) },
  {
    id: 'toggleTheme',
    run: () => {
      const ui = useUiStore.getState();
      ui.setTheme(ui.settings.theme === 'dark' ? 'light' : 'dark');
    },
  },
  {
    id: 'guides',
    run: () => {
      const ui = useUiStore.getState();
      ui.setEditor({ guides: !ui.settings.editor.guides });
    },
  },
];

export function commandById(id: string): Command | undefined {
  return COMMANDS.find((c) => c.id === id);
}

/** 快捷键的显示文字（Ctrl+Shift+Z → Ctrl Shift Z 等） */
export function shortcutLabel(s: string): string {
  return s.replace('Space', i18next.t('shortcuts.keys.space'));
}
