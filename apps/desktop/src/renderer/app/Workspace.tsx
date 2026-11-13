import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from '@allay/ui/components/resizable';
import { useCallback, useEffect, useLayoutEffect } from 'react';
import { usePanelRef, type PanelImperativeHandle } from 'react-resizable-panels';
import { useTranslation } from 'react-i18next';
import { GalleryPanel } from '../features/gallery/GalleryPanel';
import { ParamsPanel } from '../features/params/ParamsPanel';
import { PreviewArea } from '../features/preview/PreviewArea';
import { TransportBar } from '../features/transport/TransportBar';
import { useUiStore, type Side } from '../stores/uiStore';
import { layout } from '../features/commands/commands';

// 三栏加播放条（6.3）：左 280（240–360）、中间自适应、右 320（280–420）。
// 两侧可拖、可折叠；宽度和折叠状态经主进程写进 settings.json。

const LIMITS = {
  left: { min: 240, max: 360 },
  right: { min: 280, max: 420 },
} as const;

function clamp(side: Side, size: number): number {
  return Math.min(LIMITS[side].max, Math.max(LIMITS[side].min, Math.round(size)));
}

export function Workspace() {
  const { t } = useTranslation();
  const leftRef = usePanelRef();
  const rightRef = usePanelRef();
  const setPanel = useUiStore((s) => s.setPanel);
  // 只在挂载时读一次：之后分栏组件自己是状态的主人
  const initial = useUiStore.getState().settings.layout;

  // 恢复折叠状态（宽度由 defaultSize 恢复，折叠后再展开回到这个宽度）
  useLayoutEffect(() => {
    if (initial.left.collapsed) leftRef.current?.collapse();
    if (initial.right.collapsed) rightRef.current?.collapse();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 只在挂载时执行
  }, []);

  const record = useCallback(
    (side: Side, panel: PanelImperativeHandle | null) => {
      if (!panel) return;
      const collapsed = panel.isCollapsed();
      const prevSize = useUiStore.getState().settings.layout[side].size;
      // 折叠时保留折叠前的宽度
      const size = collapsed ? prevSize : clamp(side, panel.getSize().inPixels);
      setPanel(side, { size, collapsed });
    },
    [setPanel],
  );

  const onLayoutChanged = useCallback(() => {
    record('left', leftRef.current);
    record('right', rightRef.current);
  }, [record, leftRef, rightRef]);

  // Ctrl+B 折叠或展开左栏（6.4、6.7）；命令面板也用它
  useEffect(() => {
    layout.toggleLeft = () => {
      const panel = leftRef.current;
      if (!panel) return;
      if (panel.isCollapsed()) panel.expand();
      else panel.collapse();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey && !e.shiftKey && !e.altKey && !e.metaKey && e.code === 'KeyB') {
        e.preventDefault();
        const panel = leftRef.current;
        if (!panel) return;
        if (panel.isCollapsed()) panel.expand();
        else panel.collapse();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [leftRef]);

  return (
    <ResizablePanelGroup id="workspace" orientation="horizontal" className="min-h-0 flex-1" onLayoutChanged={onLayoutChanged}>
      <ResizablePanel
        id="left"
        data-testid="panel-left"
        panelRef={leftRef}
        collapsible
        collapsedSize={0}
        defaultSize={clamp('left', initial.left.size)}
        minSize={LIMITS.left.min}
        maxSize={LIMITS.left.max}
        groupResizeBehavior="preserve-pixel-size"
      >
        <GalleryPanel />
      </ResizablePanel>
      <ResizableHandle data-testid="handle-left" aria-label={t('layout.resizeHandle')} />
      <ResizablePanel id="center" minSize={320}>
        <div className="flex h-full min-w-0 flex-col">
          <PreviewArea />
          <TransportBar />
        </div>
      </ResizablePanel>
      <ResizableHandle data-testid="handle-right" aria-label={t('layout.resizeHandle')} />
      <ResizablePanel
        id="right"
        data-testid="panel-right"
        panelRef={rightRef}
        collapsible
        collapsedSize={0}
        defaultSize={clamp('right', initial.right.size)}
        minSize={LIMITS.right.min}
        maxSize={LIMITS.right.max}
        groupResizeBehavior="preserve-pixel-size"
      >
        <ParamsPanel />
      </ResizablePanel>
    </ResizablePanelGroup>
  );
}
