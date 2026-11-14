// 第一次进入视口时给元素打上 data-shown="true"，CSS 据此做出场（交错、滑入、点亮）。
// 和 PixelReveal 一样失败即显示：只有挂载时还在视口下方、而且页面确实在逐帧渲染时，才先标成 data-armed="true"（隐藏态）；
// 盖上之后起保底计时器，IntersectionObserver 没回调也会在它进入视口后显示出来。减少动效时不武装。
import { useEffect, useRef } from 'react';
import { getPrefs } from '../prefs';

export function useInView<T extends HTMLElement>(threshold = 0.25) {
  const ref = useRef<T>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const show = () => {
      el.dataset.shown = 'true';
    };
    const motionOk = document.documentElement.classList.contains('motion-ok');
    if (getPrefs().reducedMotion || !motionOk || el.getBoundingClientRect().top < window.innerHeight) {
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
      { threshold },
    );
    io.observe(el);
    // 保底：已经在视口里却一直没显示（后台标签页等），一秒内显示出来
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
