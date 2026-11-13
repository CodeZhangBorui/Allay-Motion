import { Allay } from '@allay/mascot';
import { ICON_DEFAULTS } from '@allay/ui/lib/icons';
import { IconContext } from '@phosphor-icons/react';
import { Toaster } from '@allay/ui/components/sonner';
import { TooltipProvider } from '@allay/ui/components/tooltip';
import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { CommandPalette } from '../features/commands/CommandPalette';
import { useShortcuts } from '../features/commands/useShortcuts';
import { ExportDialog } from '../features/export/ExportDialog';
import { SavePresetDialog, SaveTemplateDialog } from '../features/params/dialogs';
import { EditorServicesProvider } from '../features/params/editorServices';
import { ConfirmHost } from '../features/project/confirm';
import { DiscoveryDialog, useShowDiscovery } from '../features/resources/DiscoveryDialog';
import { useDropPacks } from '../features/resources/useDropPacks';
import { SettingsDialog } from '../features/settings/SettingsDialog';
import { resolveLanguage, systemLocale } from '../i18n';
import { isDirty, useProjectStore } from '../stores/projectStore';
import { useUiStore } from '../stores/uiStore';
import { StatusBar } from './StatusBar';
import { TopBar } from './TopBar';
import { useThemeSync } from './useThemeSync';
import { Workspace } from './Workspace';

/** 窗口标题：工程名（有未保存的改动时前面加 •）和产品名 */
function useWindowTitle() {
  const { t, i18n } = useTranslation();
  const name = useProjectStore((s) => s.name);
  const dirty = useProjectStore(isDirty);
  useEffect(() => {
    document.title = `${dirty ? '• ' : ''}${name ?? t('project.untitled')} — ${t('brand.name')}`;
  }, [name, dirty, t, i18n.language]);
}

/** 文件拖进窗口（7.6 D）：界面压暗，可放区域出现虚线框，悦灵在中央 hover，下面一行字“放这里” */
function DropOverlay() {
  const { t } = useTranslation();
  return (
    <div data-testid="drop-overlay" className="pointer-events-none fixed inset-0 z-50 flex items-center justify-center bg-scrim p-3">
      <div className="flex size-full flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed border-primary">
        <Allay clip="hover" size={88} />
        <span className="text-lg font-semibold text-foreground">{t('resources.dropOverlay')}</span>
      </div>
    </div>
  );
}

export function App() {
  const settings = useUiStore((s) => s.settings);
  const dialog = useUiStore((s) => s.dialog);
  const { i18n } = useTranslation();
  useThemeSync(settings);
  useShortcuts();
  useWindowTitle();
  const showDiscovery = useShowDiscovery();
  const dragging = useDropPacks();

  // 语言设置变化时切换（“跟随系统”按系统首选语言解析）
  useEffect(() => {
    const lng = resolveLanguage(settings.language, systemLocale());
    if (i18n.language !== lng) {
      void i18n.changeLanguage(lng).then(() => {
        document.documentElement.lang = lng;
      });
    }
  }, [settings.language, i18n]);

  return (
    <IconContext.Provider value={ICON_DEFAULTS}>
    <TooltipProvider delay={400}>
      <EditorServicesProvider>
        <div className="flex h-full flex-col bg-background">
          <TopBar />
          <Workspace />
          <StatusBar />
          {dialog === 'export' && <ExportDialog onClose={() => useUiStore.getState().openDialog(null)} />}
          {dialog === 'settings' && <SettingsDialog />}
          {dialog === 'palette' && <CommandPalette />}
          {dialog === 'savePreset' && <SavePresetDialog onSaved={() => useUiStore.getState().bumpPresets()} />}
          {dialog === 'saveTemplate' && <SaveTemplateDialog />}
          {showDiscovery && dialog !== 'export' && <DiscoveryDialog />}
          <ConfirmHost />
          <Toaster />
          {dragging && <DropOverlay />}
        </div>
      </EditorServicesProvider>
    </TooltipProvider>
    </IconContext.Provider>
  );
}
