// 全页共用的 3D 方块世界：一块固定在所有内容后面的全视口画布、一个 WebGL 上下文、挂在共享帧循环上（motion/world/world-scene.ts）。
// - 走到哪一节（视口中线落在哪一节里）由滚动决定，相机自己用弹簧飞到那一节的机位；不在视口里的东西不画；
// - 页尾字标：按 DOM 里那段字的字体栅格化成点阵交给世界，每帧把那段字在视口里的位置告诉世界，方块对齐它拼出来；
//   拼好以后 DOM 里的字只是变透明（仍然可选中、可被读屏读到），世界没起来就照常显示；
// - 点空白处（不是文字、按钮、链接、卡片）的方块会被敲碎；指针下有能敲的方块时光标变成手形；
// - 悦灵：装好图集后由世界来画（allay3d），带路的逻辑仍在 AllayGuide；
// - 减少动效：只在首屏后面画一帧静止的画面（随页面滚走，不跟着整页）；没有 WebGL 时什么也不画（文字照常）。
import { whenMascotAssetsSettled } from '@allay/mascot';
import { useEffect, useRef, useState } from 'react';
import { usePrefs } from '../../prefs';
import { onFrame, onFrameRead, onGeometryChange, track, type Geometry } from '../frame';
import { allay3d } from './bridge';
import type { World as WorldScene, WordmarkGrid } from './world-scene';

/** 机位对应的各节（顺序就是世界里从上到下的顺序） */
const STATION_IDS = ['top', 'workflow', 'cut', 'try', 'templates', 'features', 'open-source', 'end'];

/** 正文：方块不能落在它们后面（卡片、面板本身是不透明的，挡得住，不用算） */
const TEXT = 'main h1, main h2, main h3, main p, main li, main [role=tablist], footer p:not([data-voxel-wordmark])';

/** 正文在文档里的位置（文档坐标，每 4 个数一个框），尺寸变化、字体载入后重算；每帧减去滚动位置就是视口坐标 */
function collectTextRects(): Float32Array {
  const out: number[] = [];
  const sy = window.scrollY;
  for (const el of document.querySelectorAll<HTMLElement>(TEXT)) {
    if (el.closest('.card, .monitor, [aria-hidden="true"]')) continue;
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) continue;
    out.push(r.left - 12, r.top + sy - 8, r.right + 12, r.bottom + sy + 8);
  }
  return new Float32Array(out);
}

/** 不能当“空白处”的东西：点它们时不敲方块 */
const INTERACTIVE = 'a,button,input,textarea,select,label,summary,iframe,[role=button],[role=tab],[role=slider],[contenteditable],.card,.monitor,p,h1,h2,h3,h4,li,pre,code,img';

/** 字标的点阵，外加把它对齐到 DOM 里那段字所需的度量（都以字号为单位） */
interface WordmarkRaster extends WordmarkGrid {
  /** 字体的上、下伸部（决定行框里基线的位置） */
  fontAscent: number;
  fontDescent: number;
  /** 墨迹的顶边在基线以上多少、左边离文字起点多少 */
  inkTop: number;
  inkLeft: number;
  /** 一格多大 */
  cell: number;
}

function rasterizeWordmark(el: HTMLElement): WordmarkRaster | null {
  const text = el.textContent?.trim();
  if (!text) return null;
  const cs = getComputedStyle(el);
  const px = 18;
  const canvas = document.createElement('canvas');
  const g = canvas.getContext('2d', { willReadFrequently: true });
  if (!g) return null;
  const font = `${cs.fontWeight} ${px}px ${cs.fontFamily}`;
  g.font = font;
  const w = Math.ceil(g.measureText(text).width) + 4;
  canvas.width = w;
  canvas.height = px + 6;
  g.font = font;
  g.letterSpacing = cs.letterSpacing === 'normal' ? '0px' : `${(parseFloat(cs.letterSpacing) / parseFloat(cs.fontSize)) * px}px`;
  g.textBaseline = 'alphabetic';
  g.fillStyle = '#000';
  g.fillText(text, 1, px);
  const m = g.measureText(text);
  const data = g.getImageData(0, 0, canvas.width, canvas.height).data;
  const cells: [number, number][] = [];
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (let y = 0; y < canvas.height; y++) {
    for (let x = 0; x < canvas.width; x++) {
      if (data[(y * canvas.width + x) * 4 + 3]! > 120) {
        cells.push([x, y]);
        minX = Math.min(minX, x);
        maxX = Math.max(maxX, x);
        minY = Math.min(minY, y);
        maxY = Math.max(maxY, y);
      }
    }
  }
  if (cells.length === 0) return null;
  return {
    cols: maxX - minX + 1,
    rows: maxY - minY + 1,
    cells: cells.map(([x, y]) => [x - minX, y - minY]),
    fontAscent: m.fontBoundingBoxAscent / px,
    fontDescent: m.fontBoundingBoxDescent / px,
    inkTop: (px - minY) / px,
    inkLeft: (minX - 1) / px,
    cell: 1 / px,
  };
}

/** DOM 里那段字的墨迹框（视口坐标）：按行高算出基线，再按点阵的度量换算 */
function inkBox(el: HTMLElement, r: DOMRect, raster: WordmarkRaster): { left: number; top: number; height: number } {
  const cs = getComputedStyle(el);
  const fs = parseFloat(cs.fontSize);
  const lh = cs.lineHeight === 'normal' ? fs * (raster.fontAscent + raster.fontDescent) : parseFloat(cs.lineHeight);
  const baseline = r.top + parseFloat(cs.paddingTop) + (lh - (raster.fontAscent + raster.fontDescent) * fs) / 2 + raster.fontAscent * fs;
  return { left: r.left + parseFloat(cs.paddingLeft) + raster.inkLeft * fs, top: baseline - raster.inkTop * fs, height: raster.rows * raster.cell * fs };
}

export function World() {
  const { theme, reducedMotion } = usePrefs();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const sceneRef = useRef<WorldScene | null>(null);
  const [ready, setReady] = useState(false);
  const themeRef = useRef(theme);
  themeRef.current = theme;
  const rasterRef = useRef<WordmarkRaster | null>(null);

  // 起世界：懒加载 three 和场景；没有 WebGL 时什么也不做
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let alive = true;
    let ro: ResizeObserver | null = null;
    void (async () => {
      try {
        const { World: Scene } = await import('./world-scene');
        if (!alive) return;
        const narrow = window.innerWidth < 1024;
        const scene = await Scene.create(canvas, { theme: themeRef.current, narrow });
        if (!alive) {
          scene.dispose();
          return;
        }
        sceneRef.current = scene;
        const size = () => {
          const dpr = Math.min(window.innerWidth < 1024 ? 1.5 : 2, window.devicePixelRatio || 1);
          scene.resize(canvas.clientWidth * dpr, canvas.clientHeight * dpr);
        };
        size();
        ro = new ResizeObserver(size);
        ro.observe(canvas);
        setReady(true);
        // 悦灵的图集（应用同一份烘焙产物）：装进世界以后，带路的悦灵改由世界来画
        const assets = await whenMascotAssetsSettled();
        if (!alive || assets.status !== 'ready') return;
        const cell = window.devicePixelRatio > 1.15 && assets.atlas.sizes.includes(288) ? 288 : 96;
        const res = await fetch(new URL(`mascot/allay-${cell}.png`, document.baseURI));
        if (!res.ok || !alive) return;
        const bitmap = await createImageBitmap(await res.blob());
        if (!alive) return;
        scene.setAllayAtlas(bitmap, { columns: assets.atlas.columns, size: cell });
        allay3d.ready = true;
      } catch (error) {
        console.warn('[world] 3D scene unavailable', error);
      }
    })();
    return () => {
      alive = false;
      ro?.disconnect();
      allay3d.ready = false;
      sceneRef.current?.dispose();
      sceneRef.current = null;
    };
  }, []);

  useEffect(() => {
    sceneRef.current?.setTheme(theme);
  }, [theme, ready]);

  // 页尾字标的点阵（语言、主题、字体载入后重新栅格化）
  useEffect(() => {
    const scene = sceneRef.current;
    if (!ready || !scene || reducedMotion) return;
    const el = document.querySelector<HTMLElement>('[data-voxel-wordmark]');
    if (!el) return;
    const apply = () => {
      const grid = rasterizeWordmark(el);
      rasterRef.current = grid;
      if (grid) scene.setWordmark(grid);
    };
    apply();
    void document.fonts?.ready.then(apply);
  }, [ready, reducedMotion, theme]);

  // 每帧：读各节位置和字标的位置（读阶段），再交给世界画（写阶段）
  useEffect(() => {
    const scene = sceneRef.current;
    if (!ready || !scene) return;
    const root = document.documentElement;
    const stations = STATION_IDS.map((id) => document.getElementById(id));
    const tracked = stations.map((el) => (el ? track(el) : null));
    const wordEl = document.querySelector<HTMLElement>('[data-voxel-wordmark]');
    let wordRect: { left: number; top: number; height: number } | null = null;
    let settled = '';
    let lastWordReady = false;
    // 正文框：文档坐标存一份，变化时重算（另外每 2 秒补一次，懒加载的内容、语言切换后的换行）
    let docRects = collectTextRects();
    const screenRects = new Float32Array(4096);
    const recollect = () => (docRects = collectTextRects());
    const offGeo = onGeometryChange(recollect);
    const recollectTimer = window.setInterval(recollect, 2000);
    const offRead = onFrameRead((s) => {
      const raster = rasterRef.current;
      if (!wordEl || reducedMotion || !raster) return;
      const r = wordEl.getBoundingClientRect();
      wordRect = r.bottom > 0 && r.top < s.vh ? inkBox(wordEl, r, raster) : null;
    });
    const offWrite = onFrame((s) => {
      // 视口中线落在哪一节里
      let station = 0;
      const mid = s.y + s.vh * 0.5;
      tracked.forEach((t, i) => {
        if (t && (t.geometry as Geometry).top <= mid) station = i;
      });
      if (reducedMotion) station = 0;
      const pointer = s.pointer ? { x: (s.pointer.x / s.vw) * 2 - 1, y: (s.pointer.y / s.vh) * 2 - 1 } : null;
      // 视口里的正文框（文档坐标减去滚动位置，只留在视口里的）
      let n = 0;
      for (let i = 0; i < docRects.length && n < screenRects.length - 4; i += 4) {
        const top = docRects[i + 1]! - s.y;
        const bottom = docRects[i + 3]! - s.y;
        if (bottom < 0 || top > s.vh) continue;
        screenRects[n++] = docRects[i]!;
        screenRects[n++] = top;
        screenRects[n++] = docRects[i + 2]!;
        screenRects[n++] = bottom;
      }
      scene.frame({ now: s.now, dt: s.dt, station, pointer, wordmark: wordRect, allay: allay3d.ready ? allay3d.state : null, vw: s.vw, vh: s.vh, still: reducedMotion, textRects: screenRects.subarray(0, n) });
      const now = String(scene.settled);
      if (now !== settled) {
        settled = now;
        canvasRef.current?.setAttribute('data-settled', now);
      }
      // 字标拼好以后，DOM 里的字只变透明（仍可选中、可被读屏读到）
      const wordReady = !!wordRect && !reducedMotion;
      if (wordEl && wordReady !== lastWordReady) {
        lastWordReady = wordReady;
        wordEl.dataset.voxelReady = String(wordReady);
      }
    });
    // 点空白处敲方块；指针下有能敲的方块时光标变成手形
    const isBackground = (target: EventTarget | null) => target instanceof Element && !target.closest(INTERACTIVE) && !root.dataset.dragging;
    const onDown = (e: PointerEvent) => {
      if (e.button !== 0 || e.pointerType === 'touch' || !isBackground(e.target)) return;
      const hit = scene.pick((e.clientX / window.innerWidth) * 2 - 1, (e.clientY / window.innerHeight) * 2 - 1, performance.now());
      if (hit) e.preventDefault();
    };
    let hoverTimer = 0;
    const onMove = (e: PointerEvent) => {
      if (hoverTimer) return;
      hoverTimer = window.setTimeout(() => {
        hoverTimer = 0;
        const hot = isBackground(e.target) && scene.hovering((e.clientX / window.innerWidth) * 2 - 1, (e.clientY / window.innerHeight) * 2 - 1);
        root.dataset.worldHover = String(hot);
      }, 50);
    };
    if (!reducedMotion) {
      window.addEventListener('pointerdown', onDown);
      window.addEventListener('pointermove', onMove, { passive: true });
    }
    return () => {
      offRead();
      offWrite();
      offGeo();
      window.clearInterval(recollectTimer);
      tracked.forEach((t) => t?.untrack());
      window.removeEventListener('pointerdown', onDown);
      window.removeEventListener('pointermove', onMove);
      window.clearTimeout(hoverTimer);
      if (wordEl) wordEl.dataset.voxelReady = 'false';
      root.dataset.worldHover = 'false';
    };
  }, [ready, reducedMotion]);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      data-testid="world"
      data-motion="world"
      data-settled="true"
      className={`pointer-events-none z-0 transition-opacity duration-[1200ms] ease-(--ease-out) ${reducedMotion ? 'absolute inset-x-0 top-0 h-[100svh] w-full' : 'fixed inset-0 size-full'} ${ready ? 'opacity-100' : 'opacity-0'}`}
    />
  );
}
