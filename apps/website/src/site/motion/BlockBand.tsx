// 分节之间的过场：用产品自己的转场语言把上一节的底色“换”成下一节的底色。
// - wipe：方块擦除——方块按中心扩散的顺序从小弹到满格；
// - dissolve：像素溶解——格子按噪声顺序一格格翻过去；
// - fall：方块坠落——方块从上方落下、自下而上堆满。
// 进度跟着滚动走（不是播一次就完），往回滚就倒放。画布很轻：每帧几百个矩形，只在视口里、滚动时才重画。
// 减少动效时停在一半，成为一条静止的阶梯状分界。
import { useEffect, useRef } from 'react';
import { clamp01, easeOutBack, easeOutCubic, hash01, onThemeChange, tokenColor } from './tokens';
import { getPrefs } from '../prefs';

export type BandVariant = 'wipe' | 'dissolve' | 'fall';

interface Props {
  variant: BandVariant;
  /** 上一节、下一节的底色（设计变量名） */
  from: string;
  to: string;
  /** 带高（CSS 像素） */
  height?: number;
  seed?: number;
}

/** 每格的出场时刻（0–1，小的先出） */
function threshold(variant: BandVariant, col: number, row: number, cols: number, rows: number, seed: number): number {
  const ry = rows > 1 ? row / (rows - 1) : 0;
  const rx = cols > 1 ? col / (cols - 1) : 0;
  const n = hash01(col, row, seed);
  if (variant === 'wipe') {
    // 下面的行先满（下一节从下往上长出来），同一行里从中间往两边
    const center = Math.abs(rx - 0.5) * 2;
    return 0.5 * (1 - ry) + 0.32 * center + 0.18 * n;
  }
  if (variant === 'fall') return 0.55 * (1 - ry) + 0.45 * n;
  return 0.35 * (1 - ry) + 0.65 * n;
}

export function BlockBand({ variant, from, to, height = 112, seed = 1 }: Props) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const g = canvas.getContext('2d');
    if (!g) return;
    let cell = 24;
    let cols = 0;
    let rows = 0;
    let width = 0;
    let dpr = 1;
    let thresholds: Float32Array = new Float32Array(0);
    let accents: Uint8Array = new Uint8Array(0);
    let visible = false;
    let raf = 0;

    const layout = () => {
      dpr = Math.min(2, window.devicePixelRatio || 1);
      width = canvas.clientWidth;
      cell = width < 640 ? 16 : 24;
      cols = Math.ceil(width / cell);
      rows = Math.ceil(height / cell);
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      thresholds = new Float32Array(cols * rows);
      accents = new Uint8Array(cols * rows);
      for (let r = 0; r < rows; r++)
        for (let c = 0; c < cols; c++) {
          thresholds[r * cols + c] = threshold(variant, c, r, cols, rows, seed);
          accents[r * cols + c] = hash01(c + 101, r + 7, seed) < 0.025 ? 1 : 0;
        }
    };

    const progress = () => {
      if (getPrefs().reducedMotion) return 0.5;
      const rect = canvas.getBoundingClientRect();
      const vh = window.innerHeight;
      // 带子从视口底部进入时为 0，走到视口约一半高处时为 1（页面最底下那条也能走完）
      return clamp01((vh - rect.top) / (vh * 0.45 + rect.height * 0.5));
    };

    const draw = () => {
      raf = 0;
      const p = progress();
      const a = tokenColor(from);
      const b = tokenColor(to);
      const accent = tokenColor('--stage-enter');
      const edge = tokenColor('--control-hi');
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      g.fillStyle = a;
      g.fillRect(0, 0, width, height);
      // 进度映射：每格在 [th·0.62, th·0.62+0.38] 这一段里完成
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          const i = r * cols + c;
          const local = clamp01((p - thresholds[i]! * 0.62) / 0.38);
          if (local <= 0) continue;
          const x = c * cell;
          const y = height - (rows - r) * cell;
          if (variant === 'dissolve') {
            g.fillStyle = local < 1 && accents[i] ? accent : b;
            if (local >= 0.5) g.fillRect(x, y, cell + 0.5, cell + 0.5);
            continue;
          }
          if (variant === 'fall') {
            const k = easeOutCubic(local);
            const dy = (1 - k) * -(y + cell);
            g.fillStyle = local < 1 && accents[i] ? accent : b;
            g.fillRect(x, y + dy, cell + 0.5, cell + 0.5);
            if (local < 1) {
              g.fillStyle = edge;
              g.fillRect(x, y + dy, cell, 1);
            }
            continue;
          }
          const s = Math.min(1, easeOutBack(local)) * cell;
          const o = (cell - s) / 2;
          g.fillStyle = local < 1 && accents[i] ? accent : b;
          g.fillRect(x + o, y + o, s + (local >= 1 ? 0.5 : 0), s + (local >= 1 ? 0.5 : 0));
        }
      }
    };

    const schedule = () => {
      if (!visible || raf) return;
      raf = requestAnimationFrame(draw);
    };

    layout();
    draw();
    const io = new IntersectionObserver((entries) => {
      visible = entries.some((e) => e.isIntersecting);
      schedule();
    });
    io.observe(canvas);
    const ro = new ResizeObserver(() => {
      layout();
      draw();
    });
    ro.observe(canvas);
    window.addEventListener('scroll', schedule, { passive: true });
    const offTheme = onThemeChange(() => draw());
    return () => {
      io.disconnect();
      ro.disconnect();
      window.removeEventListener('scroll', schedule);
      offTheme();
      if (raf) cancelAnimationFrame(raf);
    };
  }, [variant, from, to, height, seed]);

  return <canvas ref={ref} aria-hidden="true" data-band={variant} className="block w-full" style={{ height }} />;
}
