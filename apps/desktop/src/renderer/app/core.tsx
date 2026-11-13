import {
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
} from '@allay/ui/components/dropdown-menu';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { RecentProject } from '../../shared/project';
import { CORE_COMMANDS } from '../features/commands/commands';
import { PROJECT_COMMANDS } from '../features/commands/projectCommands';
import { hotReloader } from '../features/preview/hotReload';
import { DEV_COMMANDS } from '../features/templates/devCommands';
import { PresetsTab, TemplatesActions, TemplatesTab } from '../features/gallery/GalleryPanel';
import { OutputTab, PropsActions, PropsTab } from '../features/params/ParamsPanel';
import { openRecent } from '../features/project/actions';
import { installViaDialog } from '../features/templates/actions';
import { useUiStore } from '../stores/uiStore';
import { createEditorHost } from './editorHost';
import { installHostCommands } from './mainCommands';
import { discoveredModules, OptionalModuleManager } from './optionalModules';
import { registerCommand, registerMenuItem, registerPanel, type MenuItemDef } from './registry';

// 核心功能经注册表接入（和可选模块走同一组接口）：命令、左右面板的标签页、顶栏菜单。
// 主界面只从注册表读，不直接列出这些东西。

function RecentsMenu() {
  const { t } = useTranslation();
  const [recents, setRecents] = useState<RecentProject[]>([]);
  return (
    <DropdownMenuSub onOpenChange={(open) => open && void window.allay.project.recents().then(setRecents)}>
      <DropdownMenuSubTrigger data-testid="project-recents">{t('project.recents')}</DropdownMenuSubTrigger>
      <DropdownMenuSubContent className="w-72">
        {recents.length === 0 ? (
          <DropdownMenuLabel>{t('project.noRecents')}</DropdownMenuLabel>
        ) : (
          recents.map((r) => (
            <DropdownMenuItem key={r.id} onClick={() => void openRecent(r.id)} title={r.folder}>
              <span className="flex min-w-0 flex-col">
                <span className="truncate">{r.name}</span>
                <span className="truncate text-xs text-fg-subtle">{r.folder}</span>
              </span>
            </DropdownMenuItem>
          ))
        )}
      </DropdownMenuSubContent>
    </DropdownMenuSub>
  );
}

function ImportTemplateItem() {
  const { t, i18n } = useTranslation();
  return <DropdownMenuItem onClick={() => void installViaDialog(t, i18n.language)}>{t('gallery.import')}</DropdownMenuItem>;
}

function ThemeMenu() {
  const { t } = useTranslation();
  const theme = useUiStore((s) => s.settings.theme);
  return (
    <DropdownMenuSub>
      <DropdownMenuSubTrigger>{t('menu.theme')}</DropdownMenuSubTrigger>
      <DropdownMenuSubContent>
        <DropdownMenuRadioGroup value={theme} onValueChange={(v) => useUiStore.getState().setTheme(v as 'dark' | 'light')}>
          <DropdownMenuRadioItem value="dark">{t('settings.themes.dark')}</DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="light">{t('settings.themes.light')}</DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>
      </DropdownMenuSubContent>
    </DropdownMenuSub>
  );
}

function LanguageMenu() {
  const { t } = useTranslation();
  const language = useUiStore((s) => s.settings.language);
  return (
    <DropdownMenuSub>
      <DropdownMenuSubTrigger>{t('menu.language')}</DropdownMenuSubTrigger>
      <DropdownMenuSubContent>
        <DropdownMenuRadioGroup value={language} onValueChange={(v) => useUiStore.getState().update({ language: v as typeof language })}>
          <DropdownMenuRadioItem value="system">{t('settings.languages.system')}</DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="zh-CN">{t('settings.languages.zh-CN')}</DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="en">{t('settings.languages.en')}</DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>
      </DropdownMenuSubContent>
    </DropdownMenuSub>
  );
}

function BackgroundMenu() {
  const { t } = useTranslation();
  const background = useUiStore((s) => s.settings.editor.background);
  return (
    <DropdownMenuSub>
      <DropdownMenuSubTrigger>{t('menu.background')}</DropdownMenuSubTrigger>
      <DropdownMenuSubContent>
        <DropdownMenuRadioGroup value={background === 'sample' ? 'checker' : background} onValueChange={(v) => useUiStore.getState().setEditor({ background: v as 'checker' | 'solid' })}>
          <DropdownMenuRadioItem value="checker">{t('preview.backgrounds.checker')}</DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="solid">{t('preview.backgrounds.solid')}</DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>
      </DropdownMenuSubContent>
    </DropdownMenuSub>
  );
}

const MENU_ITEMS: MenuItemDef[] = [
  // 文件
  { id: 'file.new', menu: 'file', group: 0, order: 0, command: 'newProject', titleKey: 'project.new', testId: 'project-new' },
  { id: 'file.open', menu: 'file', group: 0, order: 1, command: 'openProject', titleKey: 'project.open', testId: 'project-open' },
  { id: 'file.recents', menu: 'file', group: 0, order: 2, component: RecentsMenu },
  { id: 'file.save', menu: 'file', group: 1, order: 0, command: 'saveProject', titleKey: 'project.save', testId: 'project-save' },
  { id: 'file.saveAs', menu: 'file', group: 1, order: 1, command: 'saveProjectAs', titleKey: 'project.saveAs', testId: 'project-save-as' },
  { id: 'file.importTemplate', menu: 'file', group: 2, order: 0, component: ImportTemplateItem },
  // 模板开发模式（MD）：复制内置模板来改、打开用户模板的文件夹
  { id: 'file.copyBuiltinTemplate', menu: 'file', group: 2, order: 1, command: 'copyBuiltinTemplate', testId: 'menu-copy-builtin' },
  { id: 'file.openTemplateFolder', menu: 'file', group: 2, order: 2, command: 'openTemplateFolder', testId: 'menu-open-template-folder' },
  // 编辑
  { id: 'edit.undo', menu: 'edit', group: 0, order: 0, command: 'undo', titleKey: 'topbar.undo' },
  { id: 'edit.redo', menu: 'edit', group: 0, order: 1, command: 'redo', titleKey: 'topbar.redo' },
  { id: 'edit.reroll', menu: 'edit', group: 1, order: 0, command: 'reroll' },
  // 视图
  { id: 'view.theme', menu: 'view', group: 0, order: 0, component: ThemeMenu },
  { id: 'view.language', menu: 'view', group: 0, order: 1, component: LanguageMenu },
  { id: 'view.background', menu: 'view', group: 1, order: 0, component: BackgroundMenu },
  { id: 'view.guides', menu: 'view', group: 1, order: 1, command: 'guides', titleKey: 'preview.guides' },
  { id: 'view.toggleLeft', menu: 'view', group: 1, order: 2, command: 'toggleLeft' },
  { id: 'view.palette', menu: 'view', group: 2, order: 0, command: 'palette', titleKey: 'menu.commandPalette' },
  // 帮助
  { id: 'help.settings', menu: 'help', group: 0, order: 0, command: 'settings', titleKey: 'topbar.settings' },
  { id: 'help.shortcuts', menu: 'help', group: 0, order: 1, command: 'settings', titleKey: 'settings.pages.shortcuts', input: { page: 'shortcuts' } },
  { id: 'help.about', menu: 'help', group: 0, order: 2, command: 'settings', titleKey: 'settings.pages.about', input: { page: 'about' } },
];

let registered = false;

/** 可选模块（docs/code-editing-and-mcp-plan.md 3.2）：按设置里的开关表启停；没有模块时什么都不做 */
export const optionalModules = new OptionalModuleManager(discoveredModules(), createEditorHost);

/** 启动时调用一次（main.tsx） */
export function registerCore(): void {
  if (registered) return;
  registered = true;
  for (const c of [...CORE_COMMANDS, ...DEV_COMMANDS, ...PROJECT_COMMANDS]) registerCommand(c);
  registerPanel({ id: 'templates', titleKey: 'gallery.title', region: 'left', order: 0, component: TemplatesTab, actions: TemplatesActions });
  registerPanel({ id: 'presets', titleKey: 'params.presets.title', region: 'left', order: 10, component: PresetsTab });
  registerPanel({ id: 'props', titleKey: 'params.tabs.props', region: 'right', order: 0, component: PropsTab, actions: PropsActions });
  registerPanel({ id: 'output', titleKey: 'params.tabs.output', region: 'right', order: 10, component: OutputTab });
  for (const m of MENU_ITEMS) registerMenuItem(m);
  // 模板开发模式的热重载（H9）与主进程到界面的命令通道（H11）
  hotReloader.start();
  installHostCommands();
  // 可选模块：开关表变了就启停（默认全关，关着的模块不加载代码块）
  if (optionalModules.available.length > 0) {
    void optionalModules.sync(useUiStore.getState().settings.optionalModules);
    useUiStore.subscribe((s, prev) => {
      if (s.settings.optionalModules !== prev.settings.optionalModules) void optionalModules.sync(s.settings.optionalModules);
    });
  }
}
