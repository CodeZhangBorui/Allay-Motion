// 指针相关的小交互：卡片上跟随指针的光（.spot）、磁吸按钮、光标附近的一团品牌蓝。
// 都只在有鼠标的设备上生效；减少动效时磁吸和光都不做（卡片的光是静态的悬停反馈，保留）。
import { useEffect, useRef, type ReactNode } from 'react';
import { getPrefs, usePrefs } from '../prefs';
import { onFrame, spring } from './frame';

let spotInstalled = false;
/** 全局一次：指针在哪张 .spot 卡片上，就把相对位置写进它的 --mx / --my（事件委托，不给每张卡片挂监听） */
export function installSpotlight(): void {
  if (spotInstalled) return;
  spotInstalled = true;
  let hot: HTMLElement | null = null;
  window.addEventListener(
    'pointermove',
    (e) => {
      if (e.pointerType === 'touch') return;
      const el = (e.target as Element | null)?.closest?.<HTMLElement>('.spot') ?? null;
      if (hot && hot !== el) hot.dataset.hot = 'false';
      hot = el;
      if (!el) return;
      const r = el.getBoundingClientRect();
      el.style.setProperty('--mx', `${(e.clientX - r.left).toFixed(0)}px`);
      el.style.setProperty('--my', `${(e.clientY - r.top).toFixed(0)}px`);
      el.dataset.hot = 'true';
    },
    { passive: true },
  );
  document.documentElement.addEventListener('pointerleave', () => {
    if (hot) hot.dataset.hot = 'false';
    hot = null;
  });
}

/**
 * 磁吸：指针靠近时元素朝指针挪一点（外层 strength，里面的文字再多挪一点，有层次），离开时弹回。
 * 位移用临界阻尼弹簧，只写 transform。
 */
export function useMagnetic<T extends HTMLElement>(strength = 0.28) {
  const ref = useRef<T>(null);
  const { reducedMotion } = usePrefs();
  useEffect(() => {
    const el = ref.current;
    if (!el || reducedMotion || !window.matchMedia('(hover: hover) and (pointer: fine)').matches) return;
    const label = el.querySelector<HTMLElement>('.btn-label');
    let tx = 0;
    let ty = 0;
    let x = 0;
    let y = 0;
    let vx = 0;
    let vy = 0;
    let rect: DOMRect | null = null;
    let off: (() => void) | null = null;
    const RADIUS = 80;
    const onMove = (e: PointerEvent) => {
      if (e.pointerType === 'touch') return;
      rect ??= el.getBoundingClientRect();
      const cx = rect.left + rect.width / 2;
      const cy = rect.top + rect.height / 2;
      const dx = e.clientX - cx;
      const dy = e.clientY - cy;
      const inside = Math.abs(dx) < rect.width / 2 + RADIUS && Math.abs(dy) < rect.height / 2 + RADIUS;
      tx = inside ? dx * strength : 0;
      ty = inside ? dy * strength : 0;
      start();
    };
    const onScroll = () => {
      rect = null;
      tx = 0;
      ty = 0;
      start();
    };
    const start = () => {
      off ??= onFrame((s) => {
        [x, vx] = spring(x, vx, tx, 16, s.dt);
        [y, vy] = spring(y, vy, ty, 16, s.dt);
        el.style.transform = `translate3d(${x.toFixed(2)}px, ${y.toFixed(2)}px, 0)`;
        if (label) label.style.transform = `translate3d(${(x * 0.35).toFixed(2)}px, ${(y * 0.35).toFixed(2)}px, 0)`;
        if (tx === 0 && ty === 0 && Math.abs(x) < 0.05 && Math.abs(y) < 0.05 && Math.abs(vx) < 0.05 && Math.abs(vy) < 0.05) {
          el.style.transform = '';
          if (label) label.style.transform = '';
          off?.();
          off = null;
        }
      });
    };
    window.addEventListener('pointermove', onMove, { passive: true });
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
      off?.();
      el.style.transform = '';
      if (label) label.style.transform = '';
    };
  }, [strength, reducedMotion]);
  return ref;
}

/** 磁吸的链接按钮 */
export function MagneticLink({ href, className, children, external, testId }: { href: string; className: string; children: ReactNode; external?: boolean; testId?: string }) {
  const ref = useMagnetic<HTMLAnchorElement>();
  return (
    <a ref={ref} href={href} className={className} data-testid={testId} {...(external ? { target: '_blank', rel: 'noreferrer noopener' } : {})}>
      <span className="btn-label">{children}</span>
    </a>
  );
}

/** 光标附近的光：一大团很淡的品牌蓝，弹簧跟随指针（只在有鼠标时） */
export function CursorLight() {
  const ref = useRef<HTMLDivElement>(null);
  const { reducedMotion } = usePrefs();
  useEffect(() => {
    const el = ref.current;
    if (!el || reducedMotion || !window.matchMedia('(hover: hover) and (pointer: fine)').matches) return;
    let x = window.innerWidth / 2;
    let y = window.innerHeight / 3;
    let vx = 0;
    let vy = 0;
    return onFrame((s) => {
      if (!s.pointer) {
        el.dataset.on = 'false';
        return;
      }
      el.dataset.on = 'true';
      [x, vx] = spring(x, vx, s.pointer.x, 7, s.dt);
      [y, vy] = spring(y, vy, s.pointer.y, 7, s.dt);
      el.style.transform = `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0)`;
    });
  }, [reducedMotion]);
  return <div ref={ref} className="cursor-light" aria-hidden="true" />;
}

/**
 * 进视口时的编排：给元素打 data-armed / data-shown（CSS .reveal、.reveal-lines 据此做出场）。
 * 失败即显示：挂载时已经在视口里、页面没有在逐帧渲染（后台标签页）、减少动效时，直接是终态；
 * 武装之后有保底计时器，IntersectionObserver 不回调也会在进视口后一秒内显示。
 */
export function useReveal<T extends HTMLElement>(threshold = 0.2) {
  const ref = useRef<T>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const show = () => {
      el.dataset.shown = 'true';
    };
    const motionOk = document.documentElement.classList.contains('motion-ok');
    if (getPrefs().reducedMotion || !motionOk || el.getBoundingClientRect().top < window.innerHeight * 0.92) {
      show();
      return;
    }
    el.dataset.armed = 'true';
    el.dataset.shown = 'false';
    const io = new IntersectionObserver(
      (es) => {
        if (!es.some((e) => e.isIntersecting)) return;
        io.disconnect();
        show();
      },
      { threshold, rootMargin: '0px 0px -8% 0px' },
    );
    io.observe(el);
    const timer = window.setInterval(() => {
      const r = el.getBoundingClientRect();
      if (r.top < window.innerHeight && r.bottom > 0) {
        window.clearInterval(timer);
        window.setTimeout(show, 900);
      }
    }, 1000);
    return () => {
      io.disconnect();
      window.clearInterval(timer);
    };
  }, [threshold]);
  return ref;
}
