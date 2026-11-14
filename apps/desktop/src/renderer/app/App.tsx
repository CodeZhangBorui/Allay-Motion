import { Allay, AllayDelivery, type AllayDeliveryProps } from '@allay/mascot';
import { ICON_DEFAULTS } from '@allay/ui/lib/icons';
import { FileZip, IconContext, Package } from '@phosphor-icons/react';
import { Toaster } from '@allay/ui/components/sonner';
import { TooltipProvider } from '@allay/ui/components/tooltip';
import { useEffect, useState } from 'react';
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
import { ErrorBoundary } from './ErrorBoundary';
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

const DROP_ALLAY = 88;

const closeDialog = () => useUiStore.getState().openDialog(null);

type Delivery = Pick<AllayDeliveryProps, 'kind' | 'from' | 'to' | 'target' | 'carry'> & { id: number };

/**
 * 放下之后（7.6 D 后半段）：有效的包由悦灵送到归宿（资源包→顶栏的素材按钮，模板包→“我的”标签），无效的 sad 0.6 秒。
 * 只按文件名判断送去哪里（.allaytpl 是模板包，.zip 和文件夹是资源包，其余无效）；真正的安装和通知仍由 useDropPacks 做。
 */
function useDropDelivery(): [Delivery | null, () => void] {
  const [delivery, setDelivery] = useState<Delivery | null>(null);
  useEffect(() => {
    let id = 0;
    const onDrop = (e: DragEvent) => {
      const files = [...(e.dataTransfer?.files ?? [])];
      if (files.length === 0) return;
      const name = (f: File) => f.name.toLowerCase();
      const template = files.some((f) => name(f).endsWith('.allaytpl'));
      const pack = files.some((f) => name(f).endsWith('.zip') || !name(f).includes('.'));
      // 拖放提示里悦灵的中心：整窗居中的一列（悦灵、间距 12、一行字约 28）
      const from = { x: window.innerWidth / 2, y: window.innerHeight / 2 - 20 };
      if (!template && !pack) {
        setDelivery({ id: ++id, kind: 'reject', from });
        return;
      }
      const target = document.querySelector<HTMLElement>(template ? '[data-testid="gallery-tab-mine"]' : '[data-testid="resources-button"]');
      const r = target?.getBoundingClientRect();
      setDelivery({
        id: ++id,
        kind: 'deliver',
        from,
        to: r ? { x: r.left + r.width / 2, y: r.top + r.height / 2 } : null,
        target,
        carry: template ? <Package size={18} weight="fill" className="text-foreground" /> : <FileZip size={18} weight="fill" className="text-foreground" />,
      });
    };
    window.addEventListener('drop', onDrop);
    return () => window.removeEventListener('drop', onDrop);
  }, []);
  return [delivery, () => setDelivery(null)];
}

/** 文件拖进窗口（7.6 D）：界面压暗，可放区域出现虚线框，悦灵在中央 hover，下面一行字“放这里” */
function DropOverlay() {
  const { t } = useTranslation();
  return (
    <div data-testid="drop-overlay" className="pointer-events-none fixed inset-0 z-50 flex items-center justify-center bg-scrim p-3">
      <div className="flex size-full flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed border-primary">
        <Allay clip="hover" size={DROP_ALLAY} priority="drop" />
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
  const [delivery, endDelivery] = useDropDelivery();

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
          <ErrorBoundary scope="topbar">
            <TopBar />
          </ErrorBoundary>
          <ErrorBoundary scope="workspace">
            <Workspace />
          </ErrorBoundary>
          <ErrorBoundary scope="statusbar">
            <StatusBar />
          </ErrorBoundary>
          {dialog && (
            <ErrorBoundary scope={`dialog.${dialog}`} variant="overlay" onClose={closeDialog} resetKey={dialog}>
              {dialog === 'export' && <ExportDialog onClose={closeDialog} />}
              {dialog === 'settings' && <SettingsDialog />}
              {dialog === 'palette' && <CommandPalette />}
              {dialog === 'savePreset' && <SavePresetDialog onSaved={() => useUiStore.getState().bumpPresets()} />}
              {dialog === 'saveTemplate' && <SaveTemplateDialog />}
            </ErrorBoundary>
          )}
          {showDiscovery && dialog !== 'export' && (
            <ErrorBoundary scope="dialog.discovery" variant="overlay">
              <DiscoveryDialog />
            </ErrorBoundary>
          )}
          <ErrorBoundary scope="dialog.confirm" variant="overlay">
            <ConfirmHost />
          </ErrorBoundary>
          <Toaster />
          {dragging && <DropOverlay />}
          {delivery && !dragging && <AllayDelivery key={delivery.id} {...delivery} size={DROP_ALLAY} onDone={endDelivery} />}
        </div>
      </EditorServicesProvider>
    </TooltipProvider>
    </IconContext.Provider>
  );
}
