// 进视口时的轻量化显现：失败即显示，决不因 rAF 不跑或观察器未回调而长期隐藏标题或内容。
import { useEffect, useRef } from 'react';
import { usePrefs } from '../prefs';

export function useReveal<T extends HTMLElement>(threshold = 0.15) {
  const ref = useRef<T>(null);
  const { reducedMotion } = usePrefs();

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const show = () => {
      el.dataset.shown = 'true';
    };
    const motionOk = document.documentElement.classList.contains('motion-ok');
    if (reducedMotion || !motionOk || el.getBoundingClientRect().top < window.innerHeight * 0.92) {
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
      { threshold, rootMargin: '0px 0px -6% 0px' },
    );
    io.observe(el);
    // 保底定时器：避免极端情况下观察器未回调导致元素停留在不可见态
    const fallback = window.setTimeout(show, 2500);
    return () => {
      io.disconnect();
      window.clearTimeout(fallback);
    };
  }, [threshold, reducedMotion]);

  return ref;
}
