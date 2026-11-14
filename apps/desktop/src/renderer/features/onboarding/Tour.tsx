import { Button } from '@allay/ui/components/button';
import { ICON } from '@allay/ui/lib/icons';
import { cn } from '@allay/ui/lib/utils';
import { ArrowLeft, ArrowRight } from '@phosphor-icons/react';
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { useUiStore } from '../../stores/uiStore';
import { Companion, SpeechBubble } from './Companion';

// 新手引导（docs/06-ui-design.md 6.14）：首次启动引导之后，吉祥物带用户认一遍主界面。
// 整个主界面压暗，只在要讲的区域开一个圆角的“聚光”口（外面一圈 scrim 用 box-shadow 画），吉祥物和它的气泡停在旁边讲解。
// 底部“上一步 / 下一步”，随时“跳过引导”；← → 翻页，Esc 跳过。看完或跳过都记进设置（ui.tourCompleted），帮助菜单里可以再看。
// 主界面在引导开着时 inert（App.tsx），快捷键不穿透（useShortcuts）；聚光口只是看的，不能点进去。
// 区域只用界面上已有的 data-testid 找（不给别的组件加专门的锚点）；找不到或看不见（例如左栏折起来了）就把气泡放在正中。
// 自己写，不用引导库（AGENTS.md：不引 GSAP、Theatre.js）。

interface TourStep {
  id: string;
  /**
   * 要圈出来的区域：每一组元素取并集开一个口，可以有几个口（第一个是主区域，气泡停在它旁边）；
   * 没有就是正中的一段话
   */
  targets?: () => (Element | null | undefined)[][];
  /** 进到这一步之前把界面摆成要讲的样子（切到对应的标签页） */
  prepare?(): void;
  clip?: 'hover' | 'dance' | 'fly';
}

const q = (sel: string) => document.querySelector(sel);

export const TOUR_STEPS: readonly TourStep[] = [
  { id: 'welcome', clip: 'dance' },
  { id: 'templates', targets: () => [[q('[data-testid="gallery"]')]], prepare: () => useUiStore.setState({ leftTab: 'templates' }) },
  {
    id: 'templateVsPreset',
    // 圈住“模板 | 预设”两个标签和属性面板右上角的预设下拉：模板在左边选，预设在两处都能用
    targets: () => [[q('[data-testid="left-tab-templates"]'), q('[data-testid="left-tab-presets"]')], [q('[data-testid="preset-menu"]')]],
    prepare: () => useUiStore.setState({ leftTab: 'templates', rightTab: 'props' }),
  },
  { id: 'preview', targets: () => [[q('[data-testid="preview-frame"]')?.closest('section') ?? q('[data-testid="preview-frame"]')]] },
  { id: 'params', targets: () => [[q('[data-testid="params-panel"]')]], prepare: () => useUiStore.setState({ rightTab: 'props' }) },
  { id: 'timeline', targets: () => [[q('[data-testid="timeline-panel"]')]] },
  { id: 'resources', targets: () => [[q('[data-testid="resources-button"]')]] },
  { id: 'export', targets: () => [[q('[data-testid="topbar-export"]'), q('[data-testid="topbar-export-format"]')]] },
  // 帮助菜单在顶栏菜单的最后一个
  { id: 'help', targets: () => [[q('[data-testid="topbar"] nav > :last-child')]], clip: 'dance' },
];

interface Rect {
  left: number;
  top: number;
  width: number;
  height: number;
}

const PAD = 6;
const BUBBLE_W = 380;
const MASCOT = 72;
const GAP = 16;

/** 几个元素的并集，四周留 PAD；都看不见（宽高为 0）时返回 null */
function unionRect(els: (Element | null | undefined)[]): Rect | null {
  let l = Infinity;
  let t = Infinity;
  let r = -Infinity;
  let b = -Infinity;
  for (const el of els) {
    if (!el) continue;
    const box = el.getBoundingClientRect();
    if (box.width < 2 || box.height < 2) continue;
    l = Math.min(l, box.left);
    t = Math.min(t, box.top);
    r = Math.max(r, box.right);
    b = Math.max(b, box.bottom);
  }
  if (!Number.isFinite(l)) return null;
  return { left: l - PAD, top: t - PAD, width: r - l + PAD * 2, height: b - t + PAD * 2 };
}

/** 气泡（连同吉祥物）放在聚光口旁边空间最大的一侧，并且不出窗口 */
function placeBubble(rect: Rect | null, size: { w: number; h: number }, vw: number, vh: number): { left: number; top: number; side: 'left' | 'right' | 'top' | 'bottom' | 'center' } {
  const clampX = (x: number) => Math.min(Math.max(GAP, x), vw - size.w - GAP);
  const clampY = (y: number) => Math.min(Math.max(GAP, y), vh - size.h - GAP);
  if (!rect) return { left: (vw - size.w) / 2, top: (vh - size.h) / 2, side: 'center' };
  const room = { right: vw - (rect.left + rect.width), left: rect.left, bottom: vh - (rect.top + rect.height), top: rect.top };
  if (room.right >= size.w + GAP * 2) return { left: rect.left + rect.width + GAP, top: clampY(rect.top + rect.height / 2 - size.h / 2), side: 'right' };
  if (room.left >= size.w + GAP * 2) return { left: rect.left - GAP - size.w, top: clampY(rect.top + rect.height / 2 - size.h / 2), side: 'left' };
  if (room.bottom >= size.h + GAP * 2) return { left: clampX(rect.left + rect.width / 2 - size.w / 2), top: rect.top + rect.height + GAP, side: 'bottom' };
  if (room.top >= size.h + GAP * 2) return { left: clampX(rect.left + rect.width / 2 - size.w / 2), top: rect.top - GAP - size.h, side: 'top' };
  // 区域太大（比如整个预览）：放在区域里面靠下的位置
  return { left: clampX(rect.left + rect.width / 2 - size.w / 2), top: clampY(rect.top + rect.height - size.h - GAP * 2), side: 'center' };
}

export function Tour() {
  const { t } = useTranslation();
  const [index, setIndex] = useState(0);
  const [rects, setRects] = useState<Rect[]>([]);
  const [viewport, setViewport] = useState({ w: window.innerWidth, h: window.innerHeight });
  const [bubbleSize, setBubbleSize] = useState({ w: BUBBLE_W + MASCOT + 8, h: 220 });
  const bubbleRef = useRef<HTMLDivElement>(null);
  const nextRef = useRef<HTMLButtonElement>(null);
  const step = TOUR_STEPS[index]!;
  const last = index === TOUR_STEPS.length - 1;

  const measure = useCallback(() => {
    setViewport({ w: window.innerWidth, h: window.innerHeight });
    setRects((step.targets?.() ?? []).map(unionRect).filter((r): r is Rect => r !== null));
    const b = bubbleRef.current;
    if (b) setBubbleSize((s) => (Math.abs(s.w - b.offsetWidth) > 1 || Math.abs(s.h - b.offsetHeight) > 1 ? { w: b.offsetWidth, h: b.offsetHeight } : s));
  }, [step]);

  // 换步：先把界面摆好（切标签页），等它画出来再量
  useLayoutEffect(() => {
    step.prepare?.();
    measure();
    const raf = requestAnimationFrame(measure);
    return () => cancelAnimationFrame(raf);
  }, [step, measure]);

  // 窗口或区域大小变了（拖分栏、最大化）：重新量
  useEffect(() => {
    const ro = new ResizeObserver(() => measure());
    ro.observe(document.body);
    for (const el of step.targets?.().flat() ?? []) if (el) ro.observe(el);
    if (bubbleRef.current) ro.observe(bubbleRef.current);
    window.addEventListener('resize', measure);
    return () => {
      ro.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, [step, measure]);

  // 焦点放在“下一步”上：回车继续，Tab 能到其他按钮
  useEffect(() => {
    nextRef.current?.focus();
  }, [index]);

  const finish = () => useUiStore.getState().finishTour();
  const next = () => (last ? finish() : setIndex((i) => i + 1));
  const back = () => setIndex((i) => Math.max(0, i - 1));
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      finish();
    } else if (e.key === 'ArrowRight') {
      e.preventDefault();
      next();
    } else if (e.key === 'ArrowLeft') {
      e.preventDefault();
      back();
    }
  };

  const place = placeBubble(rects[0] ?? null, bubbleSize, viewport.w, viewport.h);
  // 吉祥物在气泡靠聚光口的那一侧（面朝区域）；在左边时气泡的尖角朝左
  const mascotFirst = place.side !== 'left';
  const title = t(`tour.steps.${step.id}.title`);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="tour-title"
      aria-describedby="tour-body"
      data-testid="tour"
      data-step={step.id}
      className="fixed inset-0 z-[60]"
      onKeyDown={onKeyDown}
    >
      {/*
        压暗层：整窗一块 scrim，用遮罩在每个区域开一个圆角口，口的边上画一圈强调色。没有区域时整窗压暗。
        点击由外层的整窗 div 拦住，口里的东西也点不到（主界面此时 inert）
      */}
      <svg aria-hidden="true" className="absolute inset-0 size-full">
        <defs>
          <mask id="tour-mask">
            <rect width="100%" height="100%" fill="white" />
            {rects.map((r, i) => (
              <rect key={i} className="tour-hole" x={r.left} y={r.top} width={r.width} height={r.height} rx={12} fill="black" />
            ))}
          </mask>
        </defs>
        <rect width="100%" height="100%" style={{ fill: 'var(--tour-scrim)' }} mask="url(#tour-mask)" />
        {rects.map((r, i) => (
          <rect key={i} data-testid="tour-spotlight" className="tour-hole" x={r.left} y={r.top} width={r.width} height={r.height} rx={12} fill="none" strokeWidth={2} style={{ stroke: 'var(--primary)' }} />
        ))}
      </svg>

      <div
        ref={bubbleRef}
        className={cn('tour-bubble absolute flex items-end gap-2', !mascotFirst && 'flex-row-reverse')}
        style={{ left: place.left, top: place.top }}
        data-side={place.side}
      >
        <Companion clip={step.clip ?? 'hover'} size={MASCOT} facing={mascotFirst ? 'left' : 'right'} className="shrink-0" />
        <SpeechBubble key={step.id} tail={mascotFirst ? 'left' : 'right'} className="flex flex-col gap-2 p-5 shadow-dialog" testId="tour-card">
          <div className="flex items-baseline justify-between gap-3" style={{ width: BUBBLE_W - 40 }}>
            <h2 id="tour-title" className="text-base font-semibold" data-testid="tour-title">
              {title}
            </h2>
            <span className="num shrink-0 text-xs text-fg-subtle" data-testid="tour-counter">
              {index + 1} / {TOUR_STEPS.length}
            </span>
          </div>
          <div id="tour-body" className="flex flex-col gap-2 text-sm leading-relaxed text-fg-muted" style={{ width: BUBBLE_W - 40 }} data-testid="tour-body">
            {t(`tour.steps.${step.id}.body`, { mascot: t('brand.mascot') })
              .split('\n')
              .map((p, i) => (
                <p key={i}>{p}</p>
              ))}
          </div>
          {/* 进度点 */}
          <div className="flex items-center gap-1 pt-1" aria-hidden="true">
            {TOUR_STEPS.map((s, i) => (
              <span key={s.id} className={cn('h-1.5 rounded-full transition-[width,background-color] duration-(--dur-2)', i === index ? 'w-4 bg-primary' : i < index ? 'w-1.5 bg-primary-soft' : 'w-1.5 bg-control-hi')} />
            ))}
          </div>
          <div className="flex items-center gap-1.5 pt-1">
            <Button variant="ghost" size="sm" className="-ml-2" data-testid="tour-skip" onClick={finish}>
              {t('tour.skip')}
            </Button>
            <div className="flex-1" />
            <Button variant="ghost" size="sm" disabled={index === 0} data-testid="tour-back" onClick={back}>
              <ArrowLeft size={ICON.sm} />
              {t('tour.back')}
            </Button>
            <Button ref={nextRef} size="sm" data-testid={last ? 'tour-finish' : 'tour-next'} onClick={next}>
              {last ? t('tour.finish') : t('tour.next')}
              {!last && <ArrowRight size={ICON.sm} />}
            </Button>
          </div>
        </SpeechBubble>
      </div>
    </div>
  );
}
