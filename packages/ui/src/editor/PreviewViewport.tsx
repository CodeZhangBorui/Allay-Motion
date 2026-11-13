import { cn } from 'cn';
import { forwardRef, type ReactNode, type Ref } from 'react';

// PreviewViewport（6.5）：承载引擎画布、背景模式、参考线、错误卡片。四周是中性灰 --viewport。
// 画布由引擎宿主创建并放进 stageRef 指向的容器（一个 <canvas> 只能 transferControlToOffscreen 一次）。

export type PreviewBackground = 'checker' | 'sample' | 'solid';

export interface PreviewViewportProps {
  background: PreviewBackground;
  solidColor: string;
  guides: boolean;
  /** 画布的 CSS 尺寸 */
  width: number;
  height: number;
  stageRef: Ref<HTMLDivElement>;
  stageLabel: string;
  /** 右上角的工具（背景模式、参考线、缩放） */
  toolbar?: ReactNode;
  /** 叠在视口上的东西（加载编排、错误卡片、引导） */
  children?: ReactNode;
  label: string;
  scrollable?: boolean;
}

/** 安全框参考线：动作安全 93%、字幕安全 80%，加中心十字 */
function Guides() {
  return (
    <div className="pointer-events-none absolute inset-0" aria-hidden="true" data-testid="preview-guides">
      <div className="absolute inset-[3.5%] border-2 border-dashed border-white/45 mix-blend-difference" />
      <div className="absolute inset-[10%] border-2 border-dashed border-white/30 mix-blend-difference" />
      <div className="absolute top-1/2 left-1/2 h-4 w-0.5 -translate-1/2 bg-white/45 mix-blend-difference" />
      <div className="absolute top-1/2 left-1/2 h-0.5 w-4 -translate-1/2 bg-white/45 mix-blend-difference" />
    </div>
  );
}

export const PreviewViewport = forwardRef(function PreviewViewport(
  { background, solidColor, guides, width, height, stageRef, stageLabel, toolbar, children, label, scrollable }: PreviewViewportProps,
  ref: Ref<HTMLElement>,
) {
  return (
    <section ref={ref} aria-label={label} className={cn('relative flex min-h-0 flex-1 bg-viewport', scrollable ? 'overflow-auto' : 'items-center justify-center overflow-hidden')}>
      <div className={cn('relative shrink-0 blk blk-edge-container', scrollable && 'm-auto')} style={{ width, height }} data-testid="preview-frame" data-background={background}>
        <div
          className={cn('absolute inset-0', background === 'checker' && 'preview-checker')}
          style={background === 'solid' ? { background: solidColor } : undefined}
          aria-hidden="true"
        />
        <div ref={stageRef} data-testid="preview-stage" className="absolute inset-0" role="img" aria-label={stageLabel} />
        {guides && <Guides />}
      </div>
      {toolbar && <div className="absolute top-3 right-3 z-20 flex items-center gap-2">{toolbar}</div>}
      {children}
    </section>
  );
});
