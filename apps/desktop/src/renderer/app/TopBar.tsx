import { AllayHead } from '@allay/mascot';
import { Button } from '@allay/ui/components/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@allay/ui/components/dropdown-menu';
import { Tooltip, TooltipContent, TooltipTrigger } from '@allay/ui/components/tooltip';
import { ChevronDown, Redo2, Settings, Undo2 } from 'lucide-react';
import { useState } from 'react';
import { useStore } from 'zustand';
import { useTranslation } from 'react-i18next';
import type { RecentProject } from '../../shared/project';
import { newProject, openProject, openRecent, saveProject } from '../features/project/actions';
import { ResourceButton } from '../features/resources/ResourceButton';
import { usePreviewStore } from '../stores/previewStore';
import { isDirty, redo, undo, useProjectStore } from '../stores/projectStore';
import { useUiStore } from '../stores/uiStore';

// 顶栏（6.4）：40 px 的一条平色带，下缘 2 px 线。左：悦灵头像（20 px）和像素字的字标；工程名按钮，下拉里是新建、打开、保存、另存为、最近的工程。
// 右：素材按钮（资源栈弹层）；撤销、重做；主按钮“导出”（全应用最显眼的一块：青色实心凸块）。最右留出系统窗口按钮的位置。
// 空白处是窗口拖动区；所有可交互元素标 no-drag。

function ProjectMenu() {
  const { t } = useTranslation();
  const name = useProjectStore((s) => s.name);
  const dirty = useProjectStore(isDirty);
  const [recents, setRecents] = useState<RecentProject[]>([]);
  const display = name ?? t('project.untitled');
  return (
    <DropdownMenu onOpenChange={(open) => open && void window.allay.project.recents().then(setRecents)}>
      <DropdownMenuTrigger render={<Button variant="ghost" className="app-no-drag max-w-56 min-w-0" data-testid="project-menu" />}>
        <span className="truncate" data-testid="project-name">
          {display}
        </span>
        {dirty && (
          <span className="size-2 shrink-0 bg-fg-muted" data-testid="project-dirty" aria-label={t('project.unsavedMark')} role="img" />
        )}
        <ChevronDown className="size-4 text-fg-muted" />
      </DropdownMenuTrigger>
      <DropdownMenuContent className="w-60">
        <DropdownMenuItem onClick={() => void newProject()} data-testid="project-new">
          {t('project.new')}
          <DropdownMenuShortcut>Ctrl+N</DropdownMenuShortcut>
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => void openProject()} data-testid="project-open">
          {t('project.open')}
          <DropdownMenuShortcut>Ctrl+O</DropdownMenuShortcut>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={() => void saveProject()} data-testid="project-save">
          {t('project.save')}
          <DropdownMenuShortcut>Ctrl+S</DropdownMenuShortcut>
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => void saveProject(true)} data-testid="project-save-as">
          {t('project.saveAs')}
          <DropdownMenuShortcut>Ctrl+Shift+S</DropdownMenuShortcut>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
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
                    <span className="truncate text-2xs text-fg-muted">{r.folder}</span>
                  </span>
                </DropdownMenuItem>
              ))
            )}
          </DropdownMenuSubContent>
        </DropdownMenuSub>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function IconButton({ label, shortcut, ...props }: { label: string; shortcut: string } & Parameters<typeof Button>[0]) {
  return (
    <Tooltip>
      <TooltipTrigger render={<Button variant="ghost" size="icon" className="app-no-drag" aria-label={label} {...props} />} />
      <TooltipContent side="bottom">
        {label} <span className="opacity-70">{shortcut}</span>
      </TooltipContent>
    </Tooltip>
  );
}

export function TopBar() {
  const { t } = useTranslation();
  const ready = usePreviewStore((s) => s.status.kind === 'ready');
  const canUndo = useStore(useProjectStore.temporal, (s) => s.pastStates.length > 0);
  const canRedo = useStore(useProjectStore.temporal, (s) => s.futureStates.length > 0);
  return (
    <header
      data-testid="topbar"
      className="app-drag flex h-10 shrink-0 items-center gap-1.5 border-b-2 bg-surface-1 pl-2"
      style={{
        // 系统窗口按钮（title bar overlay）占用的宽度
        paddingRight: 'calc(100vw - env(titlebar-area-x, 0px) - env(titlebar-area-width, 100vw) + 8px)',
      }}
    >
      <div className="flex items-center gap-2 pr-1">
        <AllayHead size={20} className="app-no-drag" onClick={() => undefined} label={t('brand.name')} />
        <span className="font-px12 whitespace-nowrap text-foreground">{t('brand.wordmark')}</span>
      </div>
      <div className="mx-1 h-5 w-0.5 bg-border" />
      <ProjectMenu />

      <div data-testid="drag-region" className="h-full min-w-4 flex-1" />

      <ResourceButton />
      <div className="mx-1 h-5 w-0.5 bg-border" />
      <IconButton label={t('topbar.undo')} shortcut="Ctrl+Z" disabled={!canUndo} onClick={undo} data-testid="topbar-undo">
        <Undo2 />
      </IconButton>
      <IconButton label={t('topbar.redo')} shortcut="Ctrl+Shift+Z" disabled={!canRedo} onClick={redo} data-testid="topbar-redo">
        <Redo2 />
      </IconButton>
      <IconButton label={t('topbar.settings')} shortcut="Ctrl+," onClick={() => useUiStore.getState().openDialog('settings', 'general')} data-testid="topbar-settings">
        <Settings />
      </IconButton>
      <Button size="lg" className="app-no-drag mr-1 ml-2 px-4" data-testid="topbar-export" disabled={!ready} onClick={() => useUiStore.getState().openDialog('export')}>
        {t('topbar.export')}
      </Button>
    </header>
  );
}
