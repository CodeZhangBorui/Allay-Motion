// 内容第一次进入视口时，盖在上面的一层“底色方块”按顺序消失，把内容露出来：
// dissolve 是像素溶解（噪声顺序、格子一下就没），wipe 是方块擦除（方块按中心扩散的顺序带一点过冲地缩小消失）。
//
// 一定“失败即显示”（fail-open）：
// - 盖层只在脚本跑起来以后、而且只在内容快进视口时才盖上（rootMargin 提前一点，免得先闪一下内容）；
// - 盖上的同时起一个计时器：动画因为任何原因没有走完（后台标签页里 requestAnimationFrame 不跑、IntersectionObserver 不回调），
//   到点就直接撤掉盖层。计时器在后台标签页里也会跑（只是被放慢到每秒一次）；
// - 减少动效时根本不盖。
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
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

/** 盖上之后最多等这么久（毫秒，不含 delay 和 duration），还没揭开就直接撤掉 */
const SAFETY_MS = 450;

export function PixelReveal({ children, bg, variant = 'dissolve', cell = 10, duration = 700, delay = 0, immediate = false, className }: Props) {
  const wrap = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  // idle：还没盖（内容可见）；covered：盖着，等进视口或正在揭；done：揭完了
  const [phase, setPhase] = useState<'idle' | 'covered' | 'done'>(() => (getPrefs().reducedMotion ? 'done' : immediate ? 'covered' : 'idle'));

  // 远离视口的内容不盖；快进视口时再盖上（提前 25% 视口高）
  useEffect(() => {
    const el = wrap.current;
    if (phase !== 'idle' || !el) return;
    const io = new IntersectionObserver(
      (entries) => {
        const e = entries[0];
        if (!e?.isIntersecting) return;
        io.disconnect();
        // 已经整个在视口里了（比如刷新时停在页面中段），就不再演，免得内容先出现再被盖住
        setPhase(e.boundingClientRect.top < window.innerHeight ? 'done' : 'covered');
      },
      { rootMargin: '0px 0px 25% 0px' },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [phase]);

  // 盖上：在浏览器画这一帧之前同步画好，不会先闪一下内容
  const geometry = useRef<{ w: number; h: number; cols: number; rows: number; dpr: number; order: Float32Array } | null>(null);
  useLayoutEffect(() => {
    const el = wrap.current;
    const canvas = canvasRef.current;
    if (phase !== 'covered' || !el || !canvas || geometry.current) return;
    const g = canvas.getContext('2d');
    if (!g) {
      setPhase('done');
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
          variant === 'wipe' ? Math.min(1, 0.7 * Math.hypot(rx - 0.5, (ry - 0.5) * 0.6) * 1.6 + 0.3 * hash01(c, r, 3)) : 0.25 * rx + 0.75 * hash01(c, r, 9);
      }
    geometry.current = { w, h, cols, rows, dpr, order };
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.fillStyle = tokenColor(bg);
    g.fillRect(0, 0, w, h);
  }, [phase, bg, cell, variant]);

  // 揭开：进视口（或首屏一挂上）就播；同时起保底计时器
  useEffect(() => {
    const el = wrap.current;
    const canvas = canvasRef.current;
    if (phase !== 'covered' || !el || !canvas) return;
    let raf = 0;
    let safety = 0;
    let io: IntersectionObserver | null = null;
    const finish = () => setPhase('done');
    const play = () => {
      const geo = geometry.current;
      const g = canvas.getContext('2d');
      if (!geo || !g) return finish();
      safety = window.setTimeout(finish, delay + duration + SAFETY_MS);
      const color = tokenColor(bg);
      let start = 0;
      const step = (now: number) => {
        start ||= now + delay;
        const p = clamp01((now - start) / duration);
        if (now >= start) {
          g.setTransform(geo.dpr, 0, 0, geo.dpr, 0, 0);
          g.clearRect(0, 0, geo.w, geo.h);
          g.fillStyle = color;
          for (let r = 0; r < geo.rows; r++)
            for (let c = 0; c < geo.cols; c++) {
              const local = clamp01((p - geo.order[r * geo.cols + c]! * 0.7) / 0.3);
              if (variant === 'dissolve') {
                if (local < 0.5) g.fillRect(c * cell, r * cell, cell + 0.5, cell + 0.5);
              } else if (local < 1) {
                const s = (1 - easeInOutCubic(local)) * cell;
                const o = (cell - s) / 2;
                g.fillRect(c * cell + o, r * cell + o, s + 0.5, s + 0.5);
              }
            }
        }
        if (p < 1) raf = requestAnimationFrame(step);
        else finish();
      };
      raf = requestAnimationFrame(step);
    };
    if (immediate) play();
    else {
      io = new IntersectionObserver(
        (entries) => {
          if (!entries.some((e) => e.isIntersecting)) return;
          io?.disconnect();
          play();
        },
        { threshold: 0.2 },
      );
      io.observe(el);
      // 盖着却一直等不到回调（后台标签页等）：只要它其实已经在视口里，就撤掉盖层
      safety = window.setInterval(() => {
        const r = el.getBoundingClientRect();
        if (r.top < window.innerHeight && r.bottom > 0) {
          window.clearInterval(safety);
          safety = window.setTimeout(finish, 1200);
        }
      }, 1000);
    }
    return () => {
      io?.disconnect();
      cancelAnimationFrame(raf);
      window.clearTimeout(safety);
      window.clearInterval(safety);
    };
  }, [phase, bg, variant, cell, duration, delay, immediate]);

  const covering = phase === 'covered';
  return (
    <div ref={wrap} className={`${className?.includes('absolute') ? '' : 'relative '}${className ?? ''}`}>
      {children}
      {covering && <canvas ref={canvasRef} aria-hidden="true" data-reveal="" className="pointer-events-none absolute inset-0 h-full w-full" />}
    </div>
  );
}
