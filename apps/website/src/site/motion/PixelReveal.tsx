// 内容第一次进入视口时，盖在上面的一层“底色像素”按顺序消失，把内容露出来：
// dissolve 是像素溶解（噪声顺序、格子一下就没），wipe 是方块擦除（方块按中心扩散的顺序缩小消失）。
// 盖层只在脚本跑起来以后才加，并且只给还没进视口的内容加；减少动效时不加，内容直接可见。
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { clamp01, easeInOutCubic, hash01, tokenColor } from './tokens';
import { getPrefs } from '../prefs';

interface Props {
  children: ReactNode;
  /** 盖层的颜色：内容所在的底色（设计变量名） */
  bg: string;
  variant?: 'dissolve' | 'wipe';
  /** 格子边长（CSS 像素） */
  cell?: number;
  duration?: number;
  delay?: number;
  /** 一挂上就播（首屏用），不等进视口 */
  immediate?: boolean;
  className?: string;
}

export function PixelReveal({ children, bg, variant = 'dissolve', cell = 10, duration = 700, delay = 0, immediate = false, className }: Props) {
  const wrap = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [cover, setCover] = useState(() => !getPrefs().reducedMotion);

  useEffect(() => {
    const el = wrap.current;
    const canvas = canvasRef.current;
    if (!cover || !el || !canvas) return;
    const g = canvas.getContext('2d');
    if (!g) {
      setCover(false);
      return;
    }
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    canvas.width = Math.ceil(w * dpr);
    canvas.height = Math.ceil(h * dpr);
    const cols = Math.ceil(w / cell);
    const rows = Math.ceil(h / cell);
    const order = new Float32Array(cols * rows);
    for (let r = 0; r < rows; r++)
      for (let c = 0; c < cols; c++) {
        const rx = cols > 1 ? c / (cols - 1) : 0;
        const ry = rows > 1 ? r / (rows - 1) : 0;
        order[r * cols + c] =
          variant === 'wipe' ? 0.7 * Math.hypot(rx - 0.5, (ry - 0.5) * 0.6) * 1.6 + 0.3 * hash01(c, r, 3) : 0.25 * rx + 0.75 * hash01(c, r, 9);
      }
    const color = tokenColor(bg);
    const paint = (p: number) => {
      // 画布的 CSS 底色在第一帧画出来之前先盖住内容（免得闪一下），之后交给画布
      canvas.style.background = 'transparent';
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      g.clearRect(0, 0, w, h);
      g.fillStyle = color;
      for (let r = 0; r < rows; r++)
        for (let c = 0; c < cols; c++) {
          const local = clamp01((p - order[r * cols + c]! * 0.7) / 0.3);
          if (variant === 'dissolve') {
            if (local < 0.5) g.fillRect(c * cell, r * cell, cell + 0.5, cell + 0.5);
          } else if (local < 1) {
            const s = (1 - easeInOutCubic(local)) * cell;
            const o = (cell - s) / 2;
            g.fillRect(c * cell + o, r * cell + o, s + 0.5, s + 0.5);
          }
        }
    };
    paint(0);

    let raf = 0;
    let start = 0;
    const run = () => {
      const step = (now: number) => {
        start ||= now + delay;
        const p = clamp01((now - start) / duration);
        if (now >= start) paint(p);
        if (p < 1) raf = requestAnimationFrame(step);
        else setCover(false);
      };
      raf = requestAnimationFrame(step);
    };

    let io: IntersectionObserver | null = null;
    if (immediate) run();
    else {
      // 已经在视口上方（直接跳到页面中段打开的）就不盖了
      if (el.getBoundingClientRect().bottom < 0) {
        setCover(false);
        return;
      }
      io = new IntersectionObserver(
        (entries) => {
          if (!entries.some((e) => e.isIntersecting)) return;
          io?.disconnect();
          run();
        },
        { threshold: 0.25 },
      );
      io.observe(el);
    }
    return () => {
      io?.disconnect();
      cancelAnimationFrame(raf);
    };
  }, [cover, bg, variant, cell, duration, delay, immediate]);

  return (
    <div ref={wrap} className={`relative ${className ?? ''}`}>
      {children}
      {cover && <canvas ref={canvasRef} aria-hidden="true" data-reveal="" className="pointer-events-none absolute inset-0 h-full w-full" style={{ background: `var(${bg})` }} />}
    </div>
  );
}
