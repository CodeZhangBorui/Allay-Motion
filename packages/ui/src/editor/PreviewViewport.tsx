import { cn } from 'cn';
import { forwardRef, type ReactNode, type Ref } from 'react';

// PreviewViewport（6.5）：预览面板（--viewer 底色）。左上是标题（“预览”和模板名），右上是规格读数；
// 画面居中；预览工具是悬浮在画面下方居中的一条（真正浮起的东西，有阴影）。叠在上面的还有加载编排、错误卡片、引导。
// 画布由引擎宿主创建并放进 stageRef 指向的容器（一个 <canvas> 只能 transferControlToOffscreen 一次）。

export type PreviewBackground = 'checker' | 'sample' | 'solid';

/** 画面四周留的空（px）：上面让出标题行，下面让出悬浮工具条。预览区按它算画布尺寸 */
export const PREVIEW_INSET = { top: 44, right: 30, bottom: 60, left: 30 } as const;

export interface PreviewViewportProps {
  background: PreviewBackground;
  solidColor: string;
  guides: boolean;
  /** 画布的 CSS 尺寸 */
  width: number;
  height: number;
  stageRef: Ref<HTMLDivElement>;
  stageLabel: string;
  /** 左上的标题 */
  title?: ReactNode;
  /** 右上的读数 */
  info?: ReactNode;
  /** 画面下方居中的悬浮工具条 */
  toolbar?: ReactNode;
  /** 叠在视口上的东西（加载编排、错误卡片、引导） */
  children?: ReactNode;
  label: string;
  scrollable?: boolean;
}

/** 安全框参考线：动作安全 93%、字幕安全 80%，加中心十字 */
function Guides() {
  return (
    <div className="pointer-events-none absolute inset-0 text-white mix-blend-difference" aria-hidden="true" data-testid="preview-guides">
      <div className="absolute inset-[3.5%] rounded-[1px] border border-current opacity-40" />
      <div className="absolute inset-[10%] rounded-[1px] border border-dashed border-current opacity-30" />
      <div className="absolute top-1/2 left-1/2 h-4 w-px -translate-1/2 bg-current opacity-40" />
      <div className="absolute top-1/2 left-1/2 h-px w-4 -translate-1/2 bg-current opacity-40" />
    </div>
  );
}

export const PreviewViewport = forwardRef(function PreviewViewport(
  { background, solidColor, guides, width, height, stageRef, stageLabel, title, info, toolbar, children, label, scrollable }: PreviewViewportProps,
  ref: Ref<HTMLElement>,
) {
  return (
    <section ref={ref} aria-label={label} className="relative flex size-full min-h-0 min-w-0 flex-col overflow-hidden rounded-xl bg-viewer">
      {title && <div className="absolute top-3 left-3.5 z-20 flex min-w-0 items-baseline gap-2.5">{title}</div>}
      {info && <div className="absolute top-3 right-3.5 z-20 text-xs text-fg-subtle">{info}</div>}
      <div
        className={cn('flex min-h-0 flex-1', scrollable ? 'overflow-auto' : 'items-center justify-center overflow-hidden')}
        style={{ padding: `${PREVIEW_INSET.top}px ${PREVIEW_INSET.right}px ${PREVIEW_INSET.bottom}px ${PREVIEW_INSET.left}px` }}
      >
        <div className={cn('relative shrink-0 overflow-hidden rounded-[2px]', scrollable && 'm-auto')} style={{ width, height }} data-testid="preview-frame" data-background={background}>
          <div className={cn('absolute inset-0', background === 'checker' && 'preview-checker')} style={background === 'solid' ? { background: solidColor } : undefined} aria-hidden="true" />
          <div ref={stageRef} data-testid="preview-stage" className="absolute inset-0" role="img" aria-label={stageLabel} />
          {guides && <Guides />}
        </div>
      </div>
      {toolbar && <div className="absolute bottom-3.5 left-1/2 z-20 -translate-x-1/2">{toolbar}</div>}
      {children}
    </section>
  );
});
