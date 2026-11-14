import { Allay, type AllayProps } from '@allay/mascot';
import { cn } from '@allay/ui/lib/utils';
import type { ReactNode } from 'react';

// 首次启动引导和新手引导里陪着用户的吉祥物（docs/06-ui-design.md 6.10、6.14；docs/decisions.md 新手引导）：
// 一只全身形象加一个说话的气泡。形象只经 packages/mascot 的公开组件画（<Allay>），全应用同一时刻只有一只
// （dialog 优先级；下载进度的编排用 export 优先级，会盖过它，这时这里只留空位）。
// 所有图层 pointer-events: none，不挡点击；漂浮和换句时的弹出在“减少动效”下都没有（app.css）。

export type BubbleTail = 'left' | 'right' | 'top' | 'bottom';

/** 说话的气泡：浮起的次级面（surface-2 + 浮起阴影），一侧带一个小尖角。text 变了会轻轻弹出一下 */
export function SpeechBubble({ children, tail = 'bottom', className, testId }: { children: ReactNode; tail?: BubbleTail; className?: string; testId?: string }) {
  return (
    <div className={cn('companion-bubble relative rounded-xl bg-surface-2 px-4 py-3 text-sm leading-relaxed text-foreground shadow-float', className)} data-testid={testId} data-tail={tail}>
      {children}
      <span aria-hidden="true" className="companion-bubble-tail absolute size-3 rotate-45 bg-surface-2" />
    </div>
  );
}

/** 气泡下面一只悬浮的吉祥物；float 为真时上下轻轻漂浮（只改 transform，减少动效时静止） */
export function Companion({ clip = 'hover', size, facing = 'right', carry, float = true, className }: Pick<AllayProps, 'clip' | 'facing' | 'carry'> & { size: number; float?: boolean; className?: string }) {
  return (
    <span className={cn('pointer-events-none inline-flex', float && 'companion-float', className)} data-testid="companion">
      <Allay clip={clip} size={size} facing={facing} carry={carry} priority="dialog" />
    </span>
  );
}

/**
 * 引导左侧插画区的背景：几块平涂的像素方块在慢慢漂（只用悦灵的三档青色和中性灰，不用渐变、不发光），
 * 中间一块自绘的等距小方块当作吉祥物脚下的“岛”。纯装饰，读屏跳过。
 */
export function CompanionScenery() {
  const bits: [number, number, number, string, number][] = [
    // left%, top%, size px, color var, delay s
    [12, 18, 10, 'var(--allay-light)', 0],
    [78, 14, 8, 'var(--allay)', 1.2],
    [86, 46, 12, 'var(--allay-deep)', 2.1],
    [8, 58, 8, 'var(--allay)', 0.6],
    [22, 82, 6, 'var(--allay-light)', 1.8],
    [70, 78, 10, 'var(--allay-light)', 0.3],
    [48, 10, 6, 'var(--allay-deep)', 2.6],
  ];
  return (
    <div aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden">
      {bits.map(([x, y, s, c, d], i) => (
        <span key={i} className="companion-bit absolute rounded-[2px]" style={{ left: `${x}%`, top: `${y}%`, width: s, height: s, background: c, opacity: 0.45, animationDelay: `${d}s` }} />
      ))}
    </div>
  );
}

/** 吉祥物脚下的等距小方块（三个面平涂：顶面亮、左面主色、右面暗） */
export function CompanionIsland({ width = 132 }: { width?: number }) {
  const h = width * 0.62;
  return (
    <svg aria-hidden="true" width={width} height={h} viewBox="0 0 100 62" className="pointer-events-none block">
      <polygon points="50,0 100,16 50,32 0,16" fill="var(--allay-light)" opacity="0.9" />
      <polygon points="0,16 50,32 50,62 0,46" fill="var(--allay)" opacity="0.85" />
      <polygon points="100,16 50,32 50,62 100,46" fill="var(--allay-deep)" opacity="0.9" />
    </svg>
  );
}
