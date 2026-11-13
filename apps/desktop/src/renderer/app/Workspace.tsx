import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from '@allay/ui/components/resizable';
import { useCallback, useEffect, useLayoutEffect } from 'react';
import { usePanelRef, type PanelImperativeHandle } from 'react-resizable-panels';
import { useTranslation } from 'react-i18next';
import { GalleryPanel } from '../features/gallery/GalleryPanel';
import { ParamsPanel } from '../features/params/ParamsPanel';
import { PreviewArea } from '../features/preview/PreviewArea';
import { TimelinePanel } from '../features/transport/TransportBar';
import { useUiStore, type Side } from '../stores/uiStore';
import { layout } from '../features/commands/commands';

// 主区（6.3）：一组留缝（6 px）的圆角面板，坐在底色上。
//   ┌ 左：模板库 ┬ 中：预览 ┐┌ 右：属性 ┐
//   └ 时间轴（跨左、中两列） ┘└（跨两行）┘
// 外层水平分栏是 [主列 | 右栏]，主列里上面是水平分栏 [左栏 | 预览]，下面是固定高度的时间轴。
// 两侧可拖、可折叠；宽度和折叠状态经主进程写进 settings.json。以后要停靠一个额外的面板（比如模板代码），
// 在外层或主列的分栏里再加一个 ResizablePanel 即可，不用改现有面板。

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

  // 内外两层分栏各记各的那一侧（内层先挂载，那时外层的面板还没注册）
  // 回调触发时面板尺寸可能还是中间值（键盘连按、内外层联动），等这一帧布局定下来再读
  const onLeftLayout = useCallback(() => requestAnimationFrame(() => record('left', leftRef.current)), [record, leftRef]);
  const onRightLayout = useCallback(() => requestAnimationFrame(() => record('right', rightRef.current)), [record, rightRef]);

  // Ctrl+B 折叠或展开左栏（6.4、6.7）；命令面板和“视图”菜单也用它
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
        layout.toggleLeft();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [leftRef]);

  return (
    <div className="flex min-h-0 flex-1 px-gap">
    <ResizablePanelGroup id="workspace" orientation="horizontal" className="min-h-0 flex-1" onLayoutChanged={onRightLayout}>
      <ResizablePanel id="main" minSize={560}>
        <div className="flex h-full min-w-0 flex-col gap-gap">
          <ResizablePanelGroup id="workspace-top" orientation="horizontal" className="min-h-0 flex-1" onLayoutChanged={onLeftLayout}>
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
              <div className="h-full pr-gap">
                <GalleryPanel />
              </div>
            </ResizablePanel>
            <ResizableHandle data-testid="handle-left" aria-label={t('layout.resizeHandle')} />
            <ResizablePanel id="center" minSize={320}>
              <PreviewArea />
            </ResizablePanel>
          </ResizablePanelGroup>
          <TimelinePanel />
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
        <div className="h-full pl-gap">
          <ParamsPanel />
        </div>
      </ResizablePanel>
    </ResizablePanelGroup>
    </div>
  );
}
