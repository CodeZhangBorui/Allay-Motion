// 全页共用的体素雕塑：一块固定在所有内容后面的全视口画布、一个 WebGL 上下文、挂在共享帧循环上（motion/world/world-scene.ts）。
// - 该拼成哪个形，由各节里给雕塑留的空白占位框（data-voxel-slot）决定：哪个框在视口里露出得最多就拼哪个
//   （带回差，免得在边界上来回跳），都不在就散成细尘；重组一次触发、按时间播完，不绑滚动位置；
// - 页尾字标：按 DOM 里那段字的字体栅格化成点阵交给世界，每帧把墨迹框的位置告诉世界，方块对齐它拼出来；
//   拼成字标时 DOM 里的字只是变透明（仍然可选中、可被读屏读到），世界没起来就照常显示；
// - 指针：最近一秒的轨迹交给世界拨开方块；在空白处（不是文字、按钮、链接、卡片）按下放出一圈冲击波，
//   按住拖动转当前的雕塑，松手后弹回；指针在雕塑的框里时光标是“可抓”；
// - 首屏的体素悦灵在场时，带路的悦灵让位（bridge.ts）；
// - 减少动效：只在首屏后面画一帧静止的体素悦灵（随页面滚走）；没有 WebGL 时什么也不画（文字照常、带路悦灵照常）。
import { whenMascotAssetsSettled } from '@allay/mascot';
import { useEffect, useRef, useState } from 'react';
import { usePrefs } from '../../prefs';
import { onFrame, onFrameRead, onGeometryChange } from '../frame';
import { allay3d, setSculptureExpected } from './bridge';
import type { Box, FormName, Tier, World as WorldScene, WordmarkGrid } from './world-scene';

/** 正文：方块不能落在它们后面（卡片、面板本身是不透明的，挡得住，不用算） */
const TEXT = 'main h1, main h2, main h3, main p, main li, main [role=tablist], footer p:not([data-voxel-wordmark]), footer a, footer span';

/**
 * 一个元素里文字实际占的行框（只取文本节点的，不取子元素的盒子：标题里按行包的块级 span 和标题本身一样宽，
 * 按盒子算会把旁边给雕塑留的空白也当成文字）
 */
function textBoxes(el: Element, range: Range, fn: (r: DOMRect) => boolean | void): void {
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    if (!n.nodeValue?.trim()) continue;
    range.selectNodeContents(n);
    for (const r of range.getClientRects()) {
      if (r.width < 1 || r.height < 1) continue;
      if (fn(r) === true) return;
    }
  }
}

/** 正文在文档里的位置（文档坐标，每 4 个数一个框），尺寸变化、字体载入后重算；每帧减去滚动位置就是视口坐标 */
function collectTextRects(): Float32Array {
  const out: number[] = [];
  const sy = window.scrollY;
  const range = document.createRange();
  for (const el of document.querySelectorAll<HTMLElement>(TEXT)) {
    if (el.closest('.card, .monitor, [aria-hidden="true"]')) continue;
    textBoxes(el, range, (r) => {
      out.push(r.left - 10, r.top + sy - 6, r.right + 10, r.bottom + sy + 6);
    });
  }
  range.detach();
  return new Float32Array(out);
}

/** 不能当“空白处”的东西：在它们上面按下时不放冲击波、不拖雕塑 */
const INTERACTIVE = 'a,button,input,textarea,select,label,summary,iframe,[role=button],[role=tab],[role=slider],[contenteditable],.card,.monitor,pre,code,img,nav,header';
/** 文字：只有按在字上（行框里）才算文字，标题盒子右边空着的那一大块算空白 */
const TEXTY = 'p,h1,h2,h3,h4,li';

function onText(el: Element, x: number, y: number): boolean {
  let hit = false;
  textBoxes(el, document.createRange(), (r) => (hit = x >= r.left - 6 && x <= r.right + 6 && y >= r.top - 3 && y <= r.bottom + 3));
  return hit;
}

/** 有占位框的形（字标另算：对齐 DOM 里的字） */
const SLOT_FORMS = ['allay', 'cut', 'timeline'] as const;

/** 字标的点阵，外加把它对齐到 DOM 里那段字所需的度量（都以字号为单位） */
interface WordmarkRaster extends WordmarkGrid {
  fontAscent: number;
  fontDescent: number;
  inkTop: number;
  inkLeft: number;
  cell: number;
}

function rasterizeWordmark(el: HTMLElement, px: number): WordmarkRaster | null {
  const text = el.textContent?.trim();
  if (!text) return null;
  const cs = getComputedStyle(el);
  const canvas = document.createElement('canvas');
  const g = canvas.getContext('2d', { willReadFrequently: true });
  if (!g) return null;
  const font = `${cs.fontWeight} ${px}px ${cs.fontFamily}`;
  g.font = font;
  const w = Math.ceil(g.measureText(text).width) + 4;
  canvas.width = w;
  canvas.height = Math.ceil(px * 1.4);
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

/** 能不能起 WebGL2（探测用的上下文马上释放） */
function canWebgl2(): boolean {
  try {
    const c = document.createElement('canvas');
    const gl = c.getContext('webgl2');
    gl?.getExtension('WEBGL_lose_context')?.loseContext();
    return !!gl;
  } catch {
    return false;
  }
}

/** 一个框在视口里露出来的比例（nav 下面那一段） */
function visible(r: { top: number; height: number }, top: number, vh: number): number {
  if (r.height <= 1) return 0;
  return Math.max(0, Math.min(r.top + r.height, vh) - Math.max(r.top, top)) / r.height;
}

export function World() {
  const { theme, reducedMotion } = usePrefs();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const sceneRef = useRef<WorldScene | null>(null);
  const tierRef = useRef<Tier>('high');
  const [ready, setReady] = useState(false);
  const themeRef = useRef(theme);
  themeRef.current = theme;
  const rasterRef = useRef<WordmarkRaster | null>(null);

  // 起世界：懒加载 three 和场景；没有 WebGL 时什么也不做
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    if (!canWebgl2()) return;
    setSculptureExpected(true);
    let alive = true;
    let ro: ResizeObserver | null = null;
    // 先让文字出来（首屏的入场动画），再起场景
    const timer = window.setTimeout(() => {
      void (async () => {
        try {
          const { World: Scene, pickTier } = await import('./world-scene');
          if (!alive) return;
          const tier = pickTier();
          tierRef.current = tier;
          const slotHeight = document.querySelector('[data-voxel-slot="allay"]')?.getBoundingClientRect().height || window.innerHeight * 0.4;
          const scene = await Scene.create(canvas, { theme: themeRef.current, tier, slotHeight });
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
          canvas.dataset.tier = tier;
          canvas.dataset.instances = String(scene.instances);
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
          setSculptureExpected(false);
        }
      })();
    }, 180);
    return () => {
      alive = false;
      window.clearTimeout(timer);
      ro?.disconnect();
      allay3d.ready = false;
      allay3d.sculpture = null;
      setSculptureExpected(false);
      sceneRef.current?.dispose();
      sceneRef.current = null;
    };
  }, []);

  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene) return;
    // 远处融进页面底色：取 body 的背景色（主题切换后）
    const raf = requestAnimationFrame(() => scene.setTheme(theme, getComputedStyle(document.body).backgroundColor || (theme === 'dark' ? '#0b0b0c' : '#f4f4f5')));
    return () => cancelAnimationFrame(raf);
  }, [theme, ready]);

  // 页尾字标的点阵（语言、主题、字体载入后重新栅格化）
  useEffect(() => {
    const scene = sceneRef.current;
    if (!ready || !scene || reducedMotion) return;
    const el = document.querySelector<HTMLElement>('[data-voxel-wordmark]');
    if (!el) return;
    // 点阵多细跟着档位走（一格一块方块）：高档 30 px 一个字号，中档 24，窄屏 16
    const px = { high: 30, mid: 24, narrow: 16 }[tierRef.current];
    const apply = () => {
      const grid = rasterizeWordmark(el, px);
      rasterRef.current = grid;
      if (grid) scene.setWordmark(grid);
    };
    apply();
    void document.fonts?.ready.then(apply);
  }, [ready, reducedMotion, theme]);

  // 每帧：读占位框、字标、正文的位置（读阶段），再交给世界画（写阶段）
  useEffect(() => {
    const scene = sceneRef.current;
    const canvas = canvasRef.current;
    if (!ready || !scene || !canvas) return;
    const root = document.documentElement;
    const still = reducedMotion;
    let slotEls = new Map<FormName, HTMLElement>();
    const findSlots = () => {
      slotEls = new Map();
      for (const el of document.querySelectorAll<HTMLElement>('[data-voxel-slot]')) slotEls.set(el.dataset.voxelSlot as FormName, el);
    };
    findSlots();
    const wordEl = document.querySelector<HTMLElement>('[data-voxel-wordmark]');
    let docRects = collectTextRects();
    const screenRects = new Float32Array(4096);
    const recollect = () => {
      docRects = collectTextRects();
      findSlots();
    };
    const offGeo = onGeometryChange(recollect);
    const recollectTimer = window.setInterval(recollect, 2000);

    const slots: Partial<Record<FormName, Box | null>> = {};
    const vis: Partial<Record<FormName, number>> = {};
    let word: { left: number; top: number; height: number } | null = null;
    let target: FormName = still ? 'allay' : 'rest';
    let vw = window.innerWidth;
    let vh = window.innerHeight;
    // 指针轨迹（最近的在前）、冲击波、拖动
    const trailPts: { x: number; y: number; t: number; speed: number }[] = [];
    const trail = new Float32Array(16 * 4);
    const shocks: { x: number; y: number; t: number; k: number }[] = [];
    const shockBuf = new Float32Array(8);
    const drag = { yaw: 0, pitch: 0, vy: 0, vp: 0, on: false, x: 0, y: 0, moved: 0 };

    const offRead = onFrameRead((s) => {
      // 减少动效：画布贴在首屏上（随页面滚动），坐标换成相对画布的
      const base = still ? canvas.getBoundingClientRect() : null;
      vw = base ? base.width : s.vw;
      vh = base ? base.height : s.vh;
      const navH = still ? 0 : 56;
      for (const name of SLOT_FORMS) {
        const el = slotEls.get(name);
        const r = el?.getBoundingClientRect();
        if (!r || r.width < 2 || r.height < 2) {
          slots[name] = null;
          vis[name] = 0;
          continue;
        }
        const box = { left: r.left - (base?.left ?? 0), top: r.top - (base?.top ?? 0), width: r.width, height: r.height };
        slots[name] = box;
        vis[name] = visible(box, navH, vh);
      }
      // 首屏的占位框不显示（窄屏的减少动效版）时不拼体素悦灵，带路的悦灵照常用首屏的锚点
      setSculptureExpected(!!slots.allay);
      const raster = rasterRef.current;
      word = null;
      vis.word = 0;
      if (wordEl && raster && !still) {
        const r = wordEl.getBoundingClientRect();
        if (r.bottom > -s.vh && r.top < s.vh * 2) word = inkBox(wordEl, r, raster);
        vis.word = visible({ top: r.top, height: r.height }, navH, s.vh);
      }
      if (still) {
        target = 'allay';
        return;
      }
      // 换成露出最多的那个（至少露出六成）；当前的形还露出三成以上、又没有明显更合适的，就留着（回差，免得在边界上来回跳）；
      // 都不够就散成细尘
      const cur = target !== 'rest' ? (vis[target] ?? 0) : 0;
      let best: FormName = 'rest';
      let bestVis = 0.6;
      for (const name of [...SLOT_FORMS, 'word'] as const) {
        const v = vis[name] ?? 0;
        if (v >= bestVis) {
          best = name;
          bestVis = v;
        }
      }
      if (best !== target && cur >= 0.3 && bestVis < cur + 0.3) return;
      target = best === 'rest' && cur >= 0.3 ? target : best;
    });

    let lastForm = '';
    let lastSettled = '';
    let lastWordReady = false;
    let lastHot = false;
    const offWrite = onFrame((s) => {
      // 视口里的正文框
      let n = 0;
      if (still) {
        // 减少动效：画布贴在页面顶上，文档坐标就是画布坐标
        for (let i = 0; i < docRects.length && n < screenRects.length - 4; i += 4) {
          if (docRects[i + 1]! > vh) continue;
          screenRects.set(docRects.subarray(i, i + 4), n);
          n += 4;
        }
      } else {
        for (let i = 0; i < docRects.length && n < screenRects.length - 4; i += 4) {
          const top = docRects[i + 1]! - s.y;
          const bottom = docRects[i + 3]! - s.y;
          if (bottom < 0 || top > s.vh) continue;
          screenRects[n++] = docRects[i]!;
          screenRects[n++] = top;
          screenRects[n++] = docRects[i + 2]!;
          screenRects[n++] = bottom;
        }
      }
      // 轨迹：当前指针（距今 0 秒）在最前，后面是最近一秒的点
      trail.fill(0);
      let k = 0;
      const now = performance.now();
      if (s.pointer && !still) {
        const recent = trailPts[0];
        const speed = recent ? recent.speed * Math.exp(-(now - recent.t) / 120) : 0;
        trail.set([s.pointer.x, s.pointer.y, 0, speed], 0);
        k = 1;
      }
      for (const p of trailPts) {
        if (k >= 16) break;
        const age = (now - p.t) / 1000;
        if (age > 1.6) break;
        trail.set([p.x, p.y, age, p.speed], k * 4);
        k++;
      }
      shockBuf.fill(0);
      shocks.slice(0, 2).forEach((sh, i) => shockBuf.set([sh.x, sh.y, (now - sh.t) / 1000, sh.k], i * 4));
      // 拖动：松手后弹回
      if (!drag.on) {
        const e = Math.exp(-3 * s.dt);
        const step = (v: number, vel: number): [number, number] => [(v + (vel + 3 * v) * s.dt) * e, (vel - 3 * (vel + 3 * v) * s.dt) * e];
        [drag.yaw, drag.vy] = step(drag.yaw, drag.vy);
        [drag.pitch, drag.vp] = step(drag.pitch, drag.vp);
      }
      scene.frame({
        now: s.now,
        dt: s.dt,
        vw,
        vh,
        scroll: s.y,
        target,
        slots,
        word,
        pointer: still ? null : s.pointer,
        trail: trail.subarray(0, k * 4),
        shocks: shockBuf,
        drag,
        allay: allay3d.ready && !still ? allay3d.state : null,
        still,
        textRects: screenRects.subarray(0, n),
      });
      const form = scene.form;
      if (form !== lastForm) {
        lastForm = form;
        canvas.dataset.form = form;
      }
      const settled = String(scene.settled);
      if (settled !== lastSettled) {
        lastSettled = settled;
        canvas.dataset.settled = settled;
      }
      // 体素悦灵在场（拼向它或已拼好，且它的框还有三成在视口里）：带路的悦灵让位，散开时从这里飞出去
      const box = slots.allay;
      const present = form === 'allay' && !!box && (still || (vis.allay ?? 0) >= 0.3);
      allay3d.sculpture = present && box && !still ? { x: box.left + box.width / 2, y: box.top + box.height * 0.4 } : null;
      canvas.dataset.sculpture = String(present);
      // 字标拼着、拼好时 DOM 里的字只变透明（仍可选中、可被读屏读到）
      const wordReady = form === 'word' && !!word;
      if (wordEl && wordReady !== lastWordReady) {
        lastWordReady = wordReady;
        wordEl.dataset.voxelReady = String(wordReady);
      }
      // 指针在当前雕塑的框里：光标提示可以抓着转
      const cur = form !== 'rest' && form !== 'word' ? slots[form] : null;
      const hot = !!(cur && s.pointer && !still && s.pointer.x > cur.left && s.pointer.x < cur.left + cur.width && s.pointer.y > cur.top && s.pointer.y < cur.top + cur.height);
      if (hot !== lastHot) {
        lastHot = hot;
        root.dataset.worldHover = String(hot);
      }
    });

    // 指针轨迹（鼠标、笔；触摸不拨，免得和滚动抢）
    const isBackground = (e: PointerEvent) => {
      const el = e.target;
      if (!(el instanceof Element) || el.closest(INTERACTIVE) || root.dataset.dragging === 'true') return false;
      const texty = el.closest(TEXTY);
      return !texty || !onText(texty, e.clientX, e.clientY);
    };
    const onMove = (e: PointerEvent) => {
      if (e.pointerType === 'touch') return;
      const now = performance.now();
      const last = trailPts[0];
      const dist = last ? Math.hypot(e.clientX - last.x, e.clientY - last.y) : Infinity;
      if (!last || dist > 9 || now - last.t > 60) {
        const speed = last ? (dist / Math.max(8, now - last.t)) * 1000 : 0;
        trailPts.unshift({ x: e.clientX, y: e.clientY, t: now, speed: Number.isFinite(speed) ? speed : 0 });
        if (trailPts.length > 15) trailPts.pop();
      }
      if (drag.on) {
        drag.moved += Math.abs(e.clientX - drag.x) + Math.abs(e.clientY - drag.y);
        drag.yaw += (e.clientX - drag.x) * 0.008;
        drag.pitch = Math.max(-0.6, Math.min(0.6, drag.pitch + (e.clientY - drag.y) * 0.004));
        drag.x = e.clientX;
        drag.y = e.clientY;
      }
    };
    const shock = (x: number, y: number) => {
      shocks.unshift({ x, y, t: performance.now(), k: 1 });
      if (shocks.length > 2) shocks.pop();
      canvas.dataset.shocks = String(Number(canvas.dataset.shocks ?? 0) + 1);
    };
    const onDown = (e: PointerEvent) => {
      if (e.button !== 0 || !isBackground(e)) return;
      if (e.pointerType === 'touch') {
        drag.x = e.clientX;
        drag.y = e.clientY;
        drag.moved = 0;
        return;
      }
      e.preventDefault();
      shock(e.clientX, e.clientY);
      drag.on = true;
      drag.x = e.clientX;
      drag.y = e.clientY;
      drag.moved = 0;
      drag.vy = 0;
      drag.vp = 0;
      root.dataset.worldDrag = 'true';
    };
    const onUp = (e: PointerEvent) => {
      // 触摸：点一下（没怎么动）才放冲击波
      if (e.pointerType === 'touch' && isBackground(e) && Math.hypot(e.clientX - drag.x, e.clientY - drag.y) < 8) shock(e.clientX, e.clientY);
      if (!drag.on) return;
      drag.on = false;
      root.dataset.worldDrag = 'false';
    };
    if (!still) {
      window.addEventListener('pointermove', onMove, { passive: true });
      window.addEventListener('pointerdown', onDown);
      window.addEventListener('pointerup', onUp);
      window.addEventListener('pointercancel', onUp);
    }
    // 测试和调试：世界此刻的状态（指针有没有真的拨动方块、拖动转了多少）
    (window as unknown as { __siteWorld?: unknown }).__siteWorld = {
      form: () => scene.form,
      settled: () => scene.settled,
      stir: () => scene.stir,
      yaw: () => scene.yaw,
      bench: (n: number) => scene.bench(n),
      instances: scene.instances,
      tier: tierRef.current,
    };
    return () => {
      offRead();
      offWrite();
      offGeo();
      window.clearInterval(recollectTimer);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerdown', onDown);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
      allay3d.sculpture = null;
      if (wordEl) wordEl.dataset.voxelReady = 'false';
      root.dataset.worldHover = 'false';
      root.dataset.worldDrag = 'false';
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
