// 整幅的分节过场：页面上一块固定在视口上的画布。每当两节的分界线从视口下方走到上方，
// 一面方块墙随滚动铺满整个视口（用下一节的底色，带一点斜面明暗；少量方块是真实的 Minecraft 方块贴图，
// 官网没有提取原版贴图时用阶段色），分界线走到视口正中时完全铺满并浮出下一节的名字，再散开露出下一节。
//
// - 三种转场轮换，和模板同一套语言：方块擦除（中心扩散地弹出、带过冲）、像素溶解（噪声顺序翻格）、方块坠落（自下而上落下堆满，再往下掉走）。
// - 完全由滚动位置决定（纯函数），跟手、可逆：往回滚就倒放。
// - 只在有分界线经过视口中段时才画；滚动时每帧最多画一次，循环里不读布局（分界线位置只在尺寸变化时量）。
// - 减少动效时整个不挂载，页面是普通的分节。
import { useEffect, useRef } from 'react';
import { mcTexture } from '../../host/mc-pack';
import { usePrefs } from '../prefs';
import { clamp01, easeOutBack, easeOutCubic, hash01, onThemeChange, tokenColor } from './tokens';

type Variant = 'wipe' | 'dissolve' | 'fall';
const VARIANTS: Variant[] = ['wipe', 'dissolve', 'fall'];

/** 墙里点缀用的原版方块（官网专用的原版贴图里有的话） */
const ACCENT_TEXTURES = ['diamond_block', 'emerald_block', 'gold_block', 'lapis_block', 'amethyst_block', 'redstone_block', 'oak_planks', 'bricks', 'glowstone', 'stone'];

interface Boundary {
  /** 分界线在文档里的 y */
  y: number;
  /** 下一节的底色（设计变量名） */
  tone: string;
  label: string;
  index: number;
  variant: Variant;
  /** 过场在 d 走到这里时结束：一般是 D_END；页面底部附近的分界线滚不到那么高，就提前到能滚到的位置 */
  dEnd: number;
}

/** 分界线在视口里的位置 d（1 = 视口底，0 = 视口顶）→ 过场进度 q（0–1）；只在中间 76% 里走 */
const D_START = 0.88;
const D_END = 0.12;

export function SceneWall() {
  const { reducedMotion } = usePrefs();
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    const g = canvas?.getContext('2d');
    if (!canvas || !g || reducedMotion) return;
    let boundaries: Boundary[] = [];
    let w = 0;
    let h = 0;
    let dpr = 1;
    let cell = 56;
    let cols = 0;
    let rows = 0;
    // 每个格子的先后（0–1）：进场一套、散场一套，按变体算
    const orders = new Map<Variant, { tin: Float32Array; tout: Float32Array; accent: Int8Array }>();
    const textures: (ImageBitmap | null)[] = [];
    let colors: Record<string, { base: string; hi: string; lo: string }> = {};
    let fg = '';
  let accentText = '';
  let fontNum = 'monospace';
    let accentFallback: string[] = [];
    let fontFamily = 'sans-serif';
    let raf = 0;
    let cleared = true;

    const measure = () => {
      dpr = Math.min(2, window.devicePixelRatio || 1);
      // 视口的可用宽度（不含滚动条）；固定定位的画布是替换元素，不会自己撑满，尺寸要写在样式上
      w = document.documentElement.clientWidth;
      h = window.innerHeight;
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
      cell = w >= 1024 ? 56 : w >= 640 ? 44 : 34;
      cols = Math.ceil(w / cell);
      rows = Math.ceil(h / cell);
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      const sections = [...document.querySelectorAll<HTMLElement>('[data-scene]')];
      const maxScroll = Math.max(0, document.documentElement.scrollHeight - h);
      boundaries = sections
        .slice(1)
        .map((el, i) => {
          const y = el.getBoundingClientRect().top + window.scrollY;
          return {
            y,
            tone: el.dataset.scene === 'alt' ? '--site-alt' : '--site-bg',
            label: el.dataset.sceneLabel ?? '',
            index: i + 1,
            variant: VARIANTS[i % VARIANTS.length]!,
            // 滚到底时这条分界线在视口里的位置：过场必须在那之前走完，不然墙会停在页底盖着内容
            dEnd: Math.max(D_END, (y - maxScroll) / h + 0.02),
          };
        })
        // 剩下的滚动距离太短（不到 0.25 屏）就不做这一条
        .filter((b) => b.dEnd < D_START - 0.25);
      orders.clear();
      for (const v of VARIANTS) {
        const n = cols * rows;
        const tin = new Float32Array(n);
        const tout = new Float32Array(n);
        const accent = new Int8Array(n);
        for (let r = 0; r < rows; r++)
          for (let c = 0; c < cols; c++) {
            const i = r * cols + c;
            const rx = cols > 1 ? c / (cols - 1) : 0;
            const ry = rows > 1 ? r / (rows - 1) : 0;
            const n1 = hash01(c, r, 11);
            const n2 = hash01(c, r, 29);
            if (v === 'wipe') {
              const center = Math.min(1, Math.hypot(rx - 0.5, (ry - 0.5) * (h / w)) * 1.9);
              tin[i] = 0.75 * center + 0.25 * n1;
              tout[i] = 0.75 * center + 0.25 * n2;
            } else if (v === 'dissolve') {
              tin[i] = 0.3 * (1 - ry) + 0.7 * n1;
              tout[i] = 0.3 * (1 - ry) + 0.7 * n2;
            } else {
              // 坠落：下面的行先落下堆起；散场时上面的行先掉
              tin[i] = 0.62 * (1 - ry) + 0.38 * n1;
              tout[i] = 0.62 * ry + 0.38 * n2;
            }
            accent[i] = hash01(c + 3, r + 5, 41) < 0.045 ? Math.floor(hash01(c, r, 53) * 64) : -1;
          }
        orders.set(v, { tin, tout, accent });
      }
      readColors();
      schedule();
    };

    const readColors = () => {
      colors = {};
      for (const tone of ['--site-bg', '--site-alt']) {
        colors[tone] = {
          base: tokenColor(tone),
          hi: tokenColor(`color-mix(in srgb, var(${tone}) 90%, var(--foreground))`),
          lo: tokenColor(`color-mix(in srgb, var(${tone}) 88%, black)`),
        };
      }
      fg = tokenColor('--foreground');
      accentText = tokenColor('--primary-text');
      accentFallback = ['--stage-enter', '--stage-exit', '--primary', '--cue'].map((t) => tokenColor(t));
      fontFamily = getComputedStyle(document.body).fontFamily;
      fontNum = getComputedStyle(document.documentElement).getPropertyValue('--font-num') || 'monospace';
    };

    const active = (): { b: Boundary; q: number } | null => {
      const y = window.scrollY;
      let best: { b: Boundary; q: number; dist: number } | null = null;
      for (const b of boundaries) {
        const d = (b.y - y) / h;
        if (d > D_START || d < b.dEnd) continue;
        const q = (D_START - d) / (D_START - b.dEnd);
        const dist = Math.abs(q - 0.5);
        if (!best || dist < best.dist) best = { b, q, dist };
      }
      return best ? { b: best.b, q: best.q } : null;
    };

    const draw = () => {
      raf = 0;
      const a = active();
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      if (!a) {
        if (!cleared) g.clearRect(0, 0, w, h);
        cleared = true;
        return;
      }
      cleared = false;
      g.clearRect(0, 0, w, h);
      const { b, q } = a;
      const o = orders.get(b.variant);
      const col = colors[b.tone];
      if (!o || !col) return;
      g.imageSmoothingEnabled = false;
      const bevel = Math.max(2, Math.round(cell / 14));
      // 名字浮出的那一块不放贴图方块，字压在纯色上才看得清
      const lw = Math.min(w * 0.6, 520);
      const inLabel = (x: number, y: number) => b.label !== '' && Math.abs(x + cell / 2 - w / 2) < lw / 2 + cell && Math.abs(y + cell / 2 - h / 2) < cell * 1.6;
      for (let r = 0; r < rows; r++)
        for (let c = 0; c < cols; c++) {
          const i = r * cols + c;
          // 进场在 q∈[0,0.46]，完全铺满到 0.54，散场在 [0.54,1]；每格的动作占 0.1
          const kin = clamp01((q - o.tin[i]! * 0.36) / 0.1);
          const kout = clamp01((q - 0.54 - o.tout[i]! * 0.36) / 0.1);
          if (kin <= 0 || kout >= 1) continue;
          let x = c * cell;
          let y = r * cell;
          let s = cell;
          if (b.variant === 'wipe') {
            s = cell * Math.min(1, easeOutBack(kin)) * (1 - easeOutCubic(kout));
            x += (cell - s) / 2;
            y += (cell - s) / 2;
          } else if (b.variant === 'dissolve') {
            if (kin < 0.5 || kout >= 0.5) continue;
          } else {
            y -= (1 - easeOutCubic(kin)) * (r + 2) * cell;
            y += kout * kout * (rows - r + 2) * cell;
          }
          if (s < 1) continue;
          const acc = inLabel(c * cell, r * cell) ? -1 : o.accent[i]!;
          const tex = acc >= 0 ? textures[acc % Math.max(1, textures.length)] : undefined;
          if (tex) {
            g.drawImage(tex, x, y, s + 0.5, s + 0.5);
          } else {
            g.fillStyle = acc >= 0 ? accentFallback[acc % accentFallback.length]! : col.base;
            g.fillRect(x, y, s + 0.5, s + 0.5);
          }
          if (s > bevel * 3) {
            // 斜面：左上亮一线、右下暗一线，看得出是一块块方块
            g.fillStyle = col.hi;
            g.fillRect(x, y, s, bevel);
            g.fillRect(x, y, bevel, s);
            g.fillStyle = col.lo;
            g.fillRect(x, y + s - bevel, s, bevel);
            g.fillRect(x + s - bevel, y, bevel, s);
          }
        }
      // 铺满时浮出下一节的名字
      const t = clamp01(1 - Math.abs(q - 0.5) / 0.14);
      if (t > 0 && b.label) {
        // “02  模板”：编号用等宽小字、强调色，名字用大号半粗
        const [num, ...rest] = b.label.split(/\s+/);
        const rise = (1 - easeOutCubic(t)) * 16;
        g.globalAlpha = easeOutCubic(t);
        g.textAlign = 'center';
        g.textBaseline = 'middle';
        g.fillStyle = accentText;
        g.font = `500 ${Math.round(Math.min(15, w / 60))}px ${fontNum}`;
        g.fillText(num ?? '', w / 2, h / 2 - Math.min(40, w / 22) + rise);
        g.fillStyle = fg;
        g.font = `600 ${Math.round(Math.min(52, w / 13))}px ${fontFamily}`;
        g.fillText(rest.join(' '), w / 2, h / 2 + 8 + rise);
        g.globalAlpha = 1;
      }
    };

    const schedule = () => {
      if (!raf) raf = requestAnimationFrame(draw);
    };

    // 原版方块贴图（有的话）解码成位图，点缀在墙里
    void Promise.all(ACCENT_TEXTURES.map((id) => mcTexture(`minecraft:block/${id}`))).then(async (list) => {
      for (const t of list) if (t) textures.push(await createImageBitmap(new Blob([t.png as Uint8Array<ArrayBuffer>], { type: 'image/png' })).catch(() => null));
      for (let i = textures.length - 1; i >= 0; i--) if (!textures[i]) textures.splice(i, 1);
      schedule();
    });

    measure();
    window.addEventListener('scroll', schedule, { passive: true });
    window.addEventListener('resize', measure);
    // 内容高度会变（字体换上、封面出来、窄屏仿真器展开），分界线要重量
    const ro = new ResizeObserver(() => measure());
    ro.observe(document.body);
    const offTheme = onThemeChange(() => {
      readColors();
      schedule();
    });
    return () => {
      window.removeEventListener('scroll', schedule);
      window.removeEventListener('resize', measure);
      ro.disconnect();
      offTheme();
      if (raf) cancelAnimationFrame(raf);
      for (const t of textures) t?.close();
    };
  }, [reducedMotion]);

  if (reducedMotion) return null;
  return <canvas ref={ref} aria-hidden="true" data-testid="scene-wall" className="pointer-events-none fixed top-0 left-0 z-30" />;
}
