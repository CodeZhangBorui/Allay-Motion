// 应用的核心命令表：快捷键（6.7）、命令面板（6.4，Ctrl+K）和顶栏菜单都从注册表读，这张表在启动时注册进去（app/core.tsx）。
// 命令的形状见 app/registry.ts（docs/code-editing-and-mcp-plan.md H2）：带参数的命令声明 input 的 zod schema，
// 执行一律经 dispatch（先校验参数）。
import { randomSeed } from '@allay/ui/editor';
import i18next from 'i18next';
import { z } from 'zod';
import { defineCommand, trigger, type AnyCommand } from '../../app/registry';
import { redo, undo, useProjectStore } from '../../stores/projectStore';
import { usePreviewStore } from '../../stores/previewStore';
import { useTransportStore } from '../../stores/transportStore';
import { useUiStore } from '../../stores/uiStore';
import { newProject, openProject, saveProject } from '../project/actions';

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

const SETTINGS_PAGES = ['general', 'assets', 'export', 'shortcuts', 'about'] as const;
const SettingsInput = z.strictObject({ page: z.enum(SETTINGS_PAGES) }).optional();

const key = (id: string) => `command.items.${id}`;

/** 核心命令。顺序就是命令面板里的顺序 */
export const CORE_COMMANDS: AnyCommand[] = [
  { id: 'playPause', titleKey: key('playPause'), shortcut: 'Space', effect: 'read', run: togglePlay, enabled: ready },
  { id: 'toStart', titleKey: key('toStart'), shortcut: 'Home', effect: 'read', run: () => useTransportStore.getState().setTime(0) },
  { id: 'toEnd', titleKey: key('toEnd'), shortcut: 'End', effect: 'read', run: () => useTransportStore.getState().setTime(useTransportStore.getState().duration) },
  { id: 'loop', titleKey: key('loop'), shortcut: 'L', effect: 'read', run: () => useTransportStore.getState().setLoop(!useTransportStore.getState().loop) },
  {
    id: 'reroll',
    titleKey: key('reroll'),
    shortcut: 'R',
    effect: 'write',
    undoLabelKey: key('reroll'),
    run: rerollSeed,
    enabled: () => !!useProjectStore.getState().template?.params.some((p) => p.type === 'seed'),
  },
  { id: 'undo', titleKey: key('undo'), shortcut: 'Ctrl+Z', effect: 'write', run: undo, enabled: () => useProjectStore.temporal.getState().pastStates.length > 0 },
  { id: 'redo', titleKey: key('redo'), shortcut: 'Ctrl+Shift+Z', effect: 'write', run: redo, enabled: () => useProjectStore.temporal.getState().futureStates.length > 0 },
  // 新建、打开会替换当前工程（有未保存的改动时先确认），算不可撤销
  { id: 'newProject', titleKey: key('newProject'), shortcut: 'Ctrl+N', effect: 'destructive', run: () => void newProject() },
  { id: 'openProject', titleKey: key('openProject'), shortcut: 'Ctrl+O', effect: 'destructive', run: () => void openProject() },
  { id: 'saveProject', titleKey: key('saveProject'), shortcut: 'Ctrl+S', effect: 'write', run: () => void saveProject() },
  { id: 'saveProjectAs', titleKey: key('saveProjectAs'), shortcut: 'Ctrl+Shift+S', effect: 'write', run: () => void saveProject(true) },
  { id: 'export', titleKey: key('export'), shortcut: 'Ctrl+E', effect: 'read', run: () => useUiStore.getState().openExport(), enabled: ready },
  { id: 'palette', titleKey: key('palette'), shortcut: 'Ctrl+K', effect: 'read', hideInPalette: true, run: () => useUiStore.getState().openDialog('palette') },
  { id: 'searchTemplates', titleKey: key('searchTemplates'), shortcut: 'Ctrl+F', effect: 'read', run: focusTemplateSearch },
  { id: 'toggleLeft', titleKey: key('toggleLeft'), shortcut: 'Ctrl+B', effect: 'read', run: () => layout.toggleLeft() },
  defineCommand({
    id: 'settings',
    titleKey: key('settings'),
    shortcut: 'Ctrl+,',
    effect: 'read',
    input: SettingsInput,
    run: (input) => useUiStore.getState().openDialog('settings', input?.page ?? 'general'),
  }),
  { id: 'resources', titleKey: key('resources'), effect: 'read', run: () => useUiStore.getState().setResourcesOpen(true) },
  {
    id: 'toggleTheme',
    titleKey: key('toggleTheme'),
    effect: 'write',
    run: () => {
      const ui = useUiStore.getState();
      ui.setTheme(ui.settings.theme === 'dark' ? 'light' : 'dark');
    },
  },
  {
    id: 'guides',
    titleKey: key('guides'),
    effect: 'write',
    run: () => {
      const ui = useUiStore.getState();
      ui.setEditor({ guides: !ui.settings.editor.guides });
    },
  },
];

/** 其他快捷键写法（只用于按键匹配，不显示）：Ctrl+Y 也是重做 */
export const SHORTCUT_ALIASES: Record<string, string> = { 'Ctrl+Y': 'redo' };

/** 快捷键的显示文字（Space → 空格等） */
export function shortcutLabel(s: string): string {
  return s.replace('Space', i18next.t('shortcuts.keys.space'));
}

/** 按 id 执行（界面上的按钮用；出错只记日志） */
export function runCommand(id: string, input?: unknown): void {
  trigger(id, input);
}
