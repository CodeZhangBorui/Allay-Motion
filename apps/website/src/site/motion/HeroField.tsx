// 首屏预览四周的方块场：和预览里正在播的模板同步——模板进入时，方块从面板边缘向外一圈圈弹出；
// 停留时铺着；退出时从外向里缩回。时间直接取首屏实时预览的播放进度和各段时长（liveTimeline），
// 所以换模板、暂停、拖动，四周都跟着变。很淡（底色里掺一点前景色），越远越稀，是点缀不是背景图。
// 只在宽屏画；减少动效时不挂载。
import { useEffect, useRef } from 'react';
import { usePrefs } from '../prefs';
import { clamp01, easeOutBack, hash01, onThemeChange, tokenColor } from './tokens';

export interface LiveTick {
  /** 当前时间与总时长（秒） */
  time: number;
  duration: number;
  /** 各段结束处占总时长的比例（进入、停留、退出） */
  marks: number[];
}

const listeners = new Set<(t: LiveTick) => void>();
let last: LiveTick | null = null;

/** 首屏实时预览每帧发一次 */
export function publishLiveTick(t: LiveTick): void {
  last = t;
  for (const l of listeners) l(t);
}

function onLiveTick(fn: (t: LiveTick) => void): () => void {
  listeners.add(fn);
  if (last) fn(last);
  return () => listeners.delete(fn);
}

const CELL = 26;

export function HeroField({ className }: { className?: string }) {
  const { reducedMotion } = usePrefs();
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    const g = canvas?.getContext('2d');
    if (!canvas || !g || reducedMotion) return;
    let w = 0;
    let h = 0;
    let dpr = 1;
    let cols = 0;
    let rows = 0;
    let order = new Float32Array(0);
    let weight = new Float32Array(0);
    let accent = new Int8Array(0);
    let base = '';
    let accents: string[] = [];
    let visible = false;
    let pending: LiveTick | null = null;
    let raf = 0;

    const layout = () => {
      dpr = Math.min(2, window.devicePixelRatio || 1);
      w = canvas.clientWidth;
      h = canvas.clientHeight;
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      cols = Math.ceil(w / CELL);
      rows = Math.ceil(h / CELL);
      order = new Float32Array(cols * rows);
      weight = new Float32Array(cols * rows);
      accent = new Int8Array(cols * rows);
      // 面板大致在中间；按到面板边缘的距离排先后，越远越稀
      const px = w * 0.1;
      const py = h * 0.08;
      for (let r = 0; r < rows; r++)
        for (let c = 0; c < cols; c++) {
          const x = c * CELL + CELL / 2;
          const y = r * CELL + CELL / 2;
          const dx = Math.max(px - x, 0, x - (w - px));
          const dy = Math.max(py - y, 0, y - (h - py));
          const d = Math.hypot(dx, dy) / Math.max(px, py, 1);
          const i = r * cols + c;
          order[i] = Math.min(1, d * 0.85 + 0.15 * hash01(c, r, 61));
          // 离面板越远越可能空着
          weight[i] = hash01(c, r, 67) < 1 - Math.min(0.92, d * 0.9) ? 1 : 0;
          accent[i] = hash01(c + 1, r + 2, 71) < 0.05 ? Math.floor(hash01(c, r, 73) * 4) : -1;
        }
      colors();
    };
    const colors = () => {
      base = tokenColor('color-mix(in srgb, var(--site-bg) 90%, var(--foreground))');
      accents = ['--stage-enter', '--stage-exit', '--primary', '--cue'].map((t) => tokenColor(t));
    };

    const draw = () => {
      raf = 0;
      const t = pending;
      if (!t || !visible) return;
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      g.clearRect(0, 0, w, h);
      const f = t.duration > 0 ? clamp01(t.time / t.duration) : 0;
      const inEnd = t.marks[0] ?? 0.4;
      const holdEnd = t.marks[1] ?? 0.6;
      // 进入：0→1；停留：1；退出：1→0（按格子各自的先后）
      const kin = clamp01(f / Math.max(0.01, inEnd));
      const kout = clamp01((f - holdEnd) / Math.max(0.01, 1 - holdEnd));
      for (let i = 0; i < order.length; i++) {
        if (!weight[i]) continue;
        const o = order[i]!;
        const a = clamp01((kin - o * 0.7) / 0.3);
        const b = clamp01((kout - (1 - o) * 0.7) / 0.3);
        const s = Math.min(1, easeOutBack(a)) * (1 - b);
        if (s <= 0.02) continue;
        const sz = (CELL - 6) * s;
        const x = (i % cols) * CELL + (CELL - sz) / 2;
        const y = Math.floor(i / cols) * CELL + (CELL - sz) / 2;
        const ac = accent[i]!;
        g.globalAlpha = ac >= 0 ? 0.55 * (1 - o * 0.6) : 1 - o * 0.55;
        g.fillStyle = ac >= 0 ? accents[ac]! : base;
        g.fillRect(x, y, sz, sz);
      }
      g.globalAlpha = 1;
    };

    layout();
    const off = onLiveTick((t) => {
      pending = t;
      if (!raf) raf = requestAnimationFrame(draw);
    });
    const io = new IntersectionObserver((es) => (visible = es.some((e) => e.isIntersecting)));
    io.observe(canvas);
    const ro = new ResizeObserver(layout);
    ro.observe(canvas);
    const offTheme = onThemeChange(colors);
    return () => {
      off();
      io.disconnect();
      ro.disconnect();
      offTheme();
      if (raf) cancelAnimationFrame(raf);
    };
  }, [reducedMotion]);

  if (reducedMotion) return null;
  // 画布是替换元素，绝对定位的四边不会把它撑开：外面包一层定位的盒子，画布填满它
  return (
    <div aria-hidden="true" className={className}>
      <canvas ref={ref} className="block size-full" />
    </div>
  );
}
