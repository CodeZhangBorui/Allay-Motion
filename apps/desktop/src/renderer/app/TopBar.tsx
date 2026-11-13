import { AllayHead } from '@allay/mascot';
import { Button } from '@allay/ui/components/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@allay/ui/components/dropdown-menu';
import { Tooltip, TooltipContent, TooltipTrigger } from '@allay/ui/components/tooltip';
import { ICON, ICON_WEIGHT } from '@allay/ui/lib/icons';
import { ArrowUUpLeft, ArrowUUpRight, CaretDown, Export, GearSix } from '@phosphor-icons/react';
import { useState, type ReactNode } from 'react';
import { useStore } from 'zustand';
import { useTranslation } from 'react-i18next';
import type { ExportPreset } from '../../shared/export';
import type { RecentProject } from '../../shared/project';
import { COMMANDS, layout } from '../features/commands/commands';
import { newProject, openProject, openRecent, saveProject } from '../features/project/actions';
import { ResourceButton } from '../features/resources/ResourceButton';
import { installViaDialog } from '../features/templates/actions';
import { usePreviewStore } from '../stores/previewStore';
import { isDirty, redo, undo, useProjectStore } from '../stores/projectStore';
import { useUiStore } from '../stores/uiStore';

// 顶栏（6.4）：一条 44 px，直接坐在底色上（不是面板）。
// 左：悦灵头像和字标；菜单“文件 / 编辑 / 视图 / 帮助”（条目都映射到已有的命令）。
// 正中：工程名和“已修改”。右：素材状态（点开是资源栈弹层）、撤销、重做、设置、“导出”分体按钮
// （主体打开导出对话框，右侧小段列出导出格式，选中后带着这个格式打开对话框）。
// 空白处是窗口拖动区；所有可交互元素标 no-drag。最右留出系统窗口按钮的位置。

const EXPORT_PRESETS: { preset: ExportPreset; key: string }[] = [
  { preset: 'prores4444', key: 'export.presets.prores' },
  { preset: 'png-sequence', key: 'export.presets.png' },
];

function shortcutOf(id: string): string | undefined {
  return COMMANDS.find((c) => c.id === id)?.shortcut;
}

function MenuButton({ label, children, testId }: { label: string; children: ReactNode; testId?: string }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger render={<Button variant="ghost" className="app-no-drag h-7 px-2.5" data-testid={testId} />}>{label}</DropdownMenuTrigger>
      <DropdownMenuContent className="w-60">{children}</DropdownMenuContent>
    </DropdownMenu>
  );
}

function Item({ id, children, onClick, testId, disabled }: { id?: string; children: ReactNode; onClick(): void; testId?: string; disabled?: boolean }) {
  const shortcut = id ? shortcutOf(id) : undefined;
  return (
    <DropdownMenuItem onClick={onClick} data-testid={testId} disabled={disabled}>
      {children}
      {shortcut && <DropdownMenuShortcut>{shortcut}</DropdownMenuShortcut>}
    </DropdownMenuItem>
  );
}

function FileMenu() {
  const { t, i18n } = useTranslation();
  const [recents, setRecents] = useState<RecentProject[]>([]);
  return (
    <DropdownMenu onOpenChange={(open) => open && void window.allay.project.recents().then(setRecents)}>
      <DropdownMenuTrigger render={<Button variant="ghost" className="app-no-drag h-7 px-2.5" data-testid="project-menu" />}>{t('menu.file')}</DropdownMenuTrigger>
      <DropdownMenuContent className="w-60">
        <Item id="newProject" onClick={() => void newProject()} testId="project-new">
          {t('project.new')}
        </Item>
        <Item id="openProject" onClick={() => void openProject()} testId="project-open">
          {t('project.open')}
        </Item>
        <DropdownMenuSub>
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
        <DropdownMenuSeparator />
        <Item id="saveProject" onClick={() => void saveProject()} testId="project-save">
          {t('project.save')}
        </Item>
        <Item id="saveProjectAs" onClick={() => void saveProject(true)} testId="project-save-as">
          {t('project.saveAs')}
        </Item>
        <DropdownMenuSeparator />
        <Item onClick={() => void installViaDialog(t, i18n.language)}>{t('gallery.import')}</Item>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function EditMenu() {
  const { t } = useTranslation();
  const canUndo = useStore(useProjectStore.temporal, (s) => s.pastStates.length > 0);
  const canRedo = useStore(useProjectStore.temporal, (s) => s.futureStates.length > 0);
  return (
    <MenuButton label={t('menu.edit')}>
      <Item id="undo" onClick={undo} disabled={!canUndo}>
        {t('topbar.undo')}
      </Item>
      <Item id="redo" onClick={redo} disabled={!canRedo}>
        {t('topbar.redo')}
      </Item>
      <DropdownMenuSeparator />
      <Item id="reroll" onClick={() => COMMANDS.find((c) => c.id === 'reroll')?.run()}>
        {t('command.items.reroll')}
      </Item>
    </MenuButton>
  );
}

function ViewMenu() {
  const { t } = useTranslation();
  const settings = useUiStore((s) => s.settings);
  const ui = useUiStore.getState();
  return (
    <MenuButton label={t('menu.view')}>
      <DropdownMenuSub>
        <DropdownMenuSubTrigger>{t('menu.theme')}</DropdownMenuSubTrigger>
        <DropdownMenuSubContent>
          <DropdownMenuRadioGroup value={settings.theme} onValueChange={(v) => ui.setTheme(v as 'dark' | 'light')}>
            <DropdownMenuRadioItem value="dark">{t('settings.themes.dark')}</DropdownMenuRadioItem>
            <DropdownMenuRadioItem value="light">{t('settings.themes.light')}</DropdownMenuRadioItem>
          </DropdownMenuRadioGroup>
        </DropdownMenuSubContent>
      </DropdownMenuSub>
      <DropdownMenuSub>
        <DropdownMenuSubTrigger>{t('menu.language')}</DropdownMenuSubTrigger>
        <DropdownMenuSubContent>
          <DropdownMenuRadioGroup value={settings.language} onValueChange={(v) => ui.update({ language: v as typeof settings.language })}>
            <DropdownMenuRadioItem value="system">{t('settings.languages.system')}</DropdownMenuRadioItem>
            <DropdownMenuRadioItem value="zh-CN">{t('settings.languages.zh-CN')}</DropdownMenuRadioItem>
            <DropdownMenuRadioItem value="en">{t('settings.languages.en')}</DropdownMenuRadioItem>
          </DropdownMenuRadioGroup>
        </DropdownMenuSubContent>
      </DropdownMenuSub>
      <DropdownMenuSeparator />
      <DropdownMenuSub>
        <DropdownMenuSubTrigger>{t('menu.background')}</DropdownMenuSubTrigger>
        <DropdownMenuSubContent>
          <DropdownMenuRadioGroup value={settings.editor.background === 'sample' ? 'checker' : settings.editor.background} onValueChange={(v) => ui.setEditor({ background: v as 'checker' | 'solid' })}>
            <DropdownMenuRadioItem value="checker">{t('preview.backgrounds.checker')}</DropdownMenuRadioItem>
            <DropdownMenuRadioItem value="solid">{t('preview.backgrounds.solid')}</DropdownMenuRadioItem>
          </DropdownMenuRadioGroup>
        </DropdownMenuSubContent>
      </DropdownMenuSub>
      <Item onClick={() => ui.setEditor({ guides: !settings.editor.guides })}>{t('preview.guides')}</Item>
      <Item id="toggleLeft" onClick={() => layout.toggleLeft()}>
        {t('command.items.toggleLeft')}
      </Item>
      <DropdownMenuSeparator />
      <Item id="palette" onClick={() => ui.openDialog('palette')}>
        {t('menu.commandPalette')}
      </Item>
    </MenuButton>
  );
}

function HelpMenu() {
  const { t } = useTranslation();
  const open = useUiStore.getState().openDialog;
  return (
    <MenuButton label={t('menu.help')}>
      <Item id="settings" onClick={() => open('settings', 'general')}>
        {t('topbar.settings')}
      </Item>
      <Item onClick={() => open('settings', 'shortcuts')}>{t('settings.pages.shortcuts')}</Item>
      <Item onClick={() => open('settings', 'about')}>{t('settings.pages.about')}</Item>
    </MenuButton>
  );
}

function IconButton({ label, shortcut, ...props }: { label: string; shortcut: string } & Parameters<typeof Button>[0]) {
  return (
    <Tooltip>
      <TooltipTrigger render={<Button variant="ghost" size="icon" className="app-no-drag" aria-label={label} {...props} />} />
      <TooltipContent side="bottom">
        {label} <span className="num text-fg-subtle">{shortcut}</span>
      </TooltipContent>
    </Tooltip>
  );
}

/** “导出”分体按钮：全窗口唯一的实心强调色按钮 */
function ExportButton() {
  const { t } = useTranslation();
  const ready = usePreviewStore((s) => s.status.kind === 'ready');
  const open = useUiStore.getState().openExport;
  return (
    <div className="app-no-drag ml-2 flex h-[30px] overflow-hidden rounded-lg">
      <Button className="h-full gap-[7px] rounded-none pr-3.5 pl-3" data-testid="topbar-export" disabled={!ready} onClick={() => open()}>
        <Export size={ICON.sm} weight="bold" />
        {t('topbar.export')}
      </Button>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={<Button className="h-full w-7 rounded-none bg-primary-press px-0 hover:bg-primary-hover" aria-label={t('topbar.exportFormat')} disabled={!ready} data-testid="topbar-export-format" />}
        >
          <CaretDown size={ICON.xs - 1} weight="bold" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56">
          <DropdownMenuLabel>{t('topbar.exportAs')}</DropdownMenuLabel>
          {EXPORT_PRESETS.map((p) => (
            <DropdownMenuItem key={p.preset} onClick={() => open(p.preset)} data-testid={`topbar-export-${p.preset}`}>
              {t(p.key)}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

export function TopBar() {
  const { t } = useTranslation();
  const name = useProjectStore((s) => s.name);
  const dirty = useProjectStore(isDirty);
  const canUndo = useStore(useProjectStore.temporal, (s) => s.pastStates.length > 0);
  const canRedo = useStore(useProjectStore.temporal, (s) => s.futureStates.length > 0);
  return (
    <header
      data-testid="topbar"
      className="app-drag relative flex h-topbar shrink-0 items-center gap-1 bg-background pl-2"
      style={{
        // 系统窗口按钮（title bar overlay）占用的宽度
        paddingRight: 'calc(100vw - env(titlebar-area-x, 0px) - env(titlebar-area-width, 100vw) + 6px)',
      }}
    >
      {/* 正中：工程名与“已修改”（不接收指针，不挡拖动区） */}
      <div className="pointer-events-none absolute inset-x-0 top-0 flex h-topbar items-center justify-center gap-2">
        <span className="max-w-[30vw] truncate font-medium" data-testid="project-name">
          {name ?? t('project.untitled')}
        </span>
        {dirty && (
          <span className="text-fg-subtle" data-testid="project-dirty" title={t('project.unsavedMark')}>
            {t('project.modified')}
          </span>
        )}
      </div>

      <div className="relative flex items-center gap-2 pr-3">
        <AllayHead size={22} className="app-no-drag" onClick={() => undefined} label={t('brand.name')} />
        <span className="text-[13px] font-semibold whitespace-nowrap">{t('brand.wordmark')}</span>
      </div>
      <nav className="relative flex items-center" aria-label={t('menu.file')}>
        <FileMenu />
        <EditMenu />
        <ViewMenu />
        <HelpMenu />
      </nav>

      <div data-testid="drag-region" className="h-full min-w-4 flex-1" />

      <ResourceButton />
      <IconButton label={t('topbar.undo')} shortcut="Ctrl+Z" disabled={!canUndo} onClick={undo} data-testid="topbar-undo">
        <ArrowUUpLeft size={ICON.md} />
      </IconButton>
      <IconButton label={t('topbar.redo')} shortcut="Ctrl+Shift+Z" disabled={!canRedo} onClick={redo} data-testid="topbar-redo">
        <ArrowUUpRight size={ICON.md} />
      </IconButton>
      <IconButton label={t('topbar.settings')} shortcut="Ctrl+," onClick={() => useUiStore.getState().openDialog('settings', 'general')} data-testid="topbar-settings">
        <GearSix size={ICON.md} weight={ICON_WEIGHT.normal} />
      </IconButton>
      <ExportButton />
    </header>
  );
}
