// 剪辑点：全页唯一的整幅转场（docs/decisions.md 官网 · 第三版）。
// 盖在“分镜”和“试用”两节的接缝上的，就是应用的方块擦除模板本身——由桌面版的引擎在浏览器里实时渲染，
// 滚动位置就是它的播放头（进入 → 铺满 → 退出，可逆、跟手）。这正是成片在剪辑软件里的用法：盖在两段素材的接缝上。
// - 铺满的那一刻（剪辑点）才把下面的内容换成下一节的开场白，换的过程被方块完全挡住；
// - 一块固定在视口上的画布，pointer-events: none，不挡点击；不在这一段时不渲染；
// - 引擎起不来（没有 WebGL2 等）或减少动效时，没有转场，开场白一直可见。
import { localize, type ParamValues } from '@allay/template-sdk';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { builtinEntries } from '../../host/templates';
import { SECTION } from '../links';
import { clamp01, onFrame, track } from '../motion/frame';
import { usePrefs } from '../prefs';
import type { LivePreview } from '../engine/runtime';

const TEMPLATE = 'allay.builtin.block-wipe';
const IN = 0.5;
const HOLD = 0.16;
const OUT = 0.5;
const DURATION = IN + HOLD + OUT;
const CUT_TIME = IN + HOLD / 2;

/** 滚动（这一节上沿在视口里的位置，以视口高为单位）→ 模板时间：进入、停留、退出三段分别线性对应 */
function timeAt(top: number): number {
  // 上沿从 0.9 走到 0：进入；0 到 −0.2：停留（铺满）；−0.2 到 −1.1：退出
  if (top >= 0.9) return 0;
  if (top >= 0) return ((0.9 - top) / 0.9) * IN;
  if (top >= -0.2) return IN + (-top / 0.2) * HOLD;
  if (top >= -1.1) return IN + HOLD + ((-0.2 - top) / 0.9) * OUT;
  return DURATION;
}

/**
 * 方块：一面安静的墙，亮色只零星点缀。深色主题是近黑的混凝土（夹一点黑曜石的纹理）上的钻石块和青金石，
 * 浅色主题是白色混凝土上的浮冰和钻石块。墙铺满时是平静的一块面，翻转时才看得出体积；品牌蓝的光扫过波前。
 */
function blocksFor(theme: 'dark' | 'light'): ParamValues['blocks'] {
  return theme === 'dark'
    ? [
        { id: 'minecraft:black_concrete', weight: 9 },
        { id: 'minecraft:obsidian', weight: 1 },
        { id: 'minecraft:diamond_block', weight: 1.2 },
        { id: 'minecraft:lapis_block', weight: 0.6 },
      ]
    : [
        { id: 'minecraft:white_concrete', weight: 9 },
        { id: 'minecraft:quartz_block', weight: 1 },
        { id: 'minecraft:packed_ice', weight: 1 },
        { id: 'minecraft:diamond_block', weight: 1 },
      ];
}

export function CutScene() {
  const { t } = useTranslation();
  const { reducedMotion, theme, language } = usePrefs();
  const sectionRef = useRef<HTMLElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const glowRef = useRef<HTMLDivElement>(null);
  const waveRef = useRef<HTMLDivElement>(null);
  const hudTimeRef = useRef<HTMLSpanElement>(null);
  const clipBRef = useRef<HTMLDivElement>(null);
  const liveRef = useRef<LivePreview | null>(null);
  const [near, setNear] = useState(false);
  const [ready, setReady] = useState(false);
  const entry = useMemo(() => builtinEntries().find((e) => e.id === TEMPLATE), []);
  const enabled = !reducedMotion && entry !== undefined;

  // 快到这里时才启动引擎（离视口三屏，访客还在分镜里时就开始，滚到这里时已经好了）
  useEffect(() => {
    const el = sectionRef.current;
    if (!el || !enabled || near) return;
    const io = new IntersectionObserver((es) => es.some((e) => e.isIntersecting) && setNear(true), { rootMargin: '300% 0px' });
    io.observe(el);
    return () => io.disconnect();
  }, [enabled, near]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!near || !canvas || !entry) return;
    let disposed = false;
    let live: LivePreview | null = null;
    void (async () => {
      const rt = await import('../engine/runtime');
      if (disposed || !rt.hasWebgl2()) return;
      try {
        live = await rt.LivePreview.create(canvas);
      } catch (error) {
        console.warn('[cut] engine failed to start', error);
        return;
      }
      if (disposed) {
        live.dispose();
        return;
      }
      live.loop = false;
      live.setPlaying(false);
      live.setVisible(false);
      liveRef.current = live;
      setReady(true);
    })();
    return () => {
      disposed = true;
      liveRef.current = null;
      setReady(false);
      live?.dispose();
    };
  }, [near, entry]);

  // 装载：按视口的宽高比、当前主题的方块；尺寸变了重新装
  useEffect(() => {
    const live = liveRef.current;
    const canvas = canvasRef.current;
    if (!ready || !live || !entry || !canvas) return;
    const load = () => {
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      const portrait = vh > vw;
      const width = portrait ? 1080 : 1920;
      const height = Math.round((width * vh) / vw / 2) * 2;
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      live.resize(vw * dpr, vh * dpr);
      void live.show(entry, language, {
        blocks: blocksFor(theme),
        cols: portrait ? 6 : vw < 1280 ? 9 : 11,
        style: '3d',
        inPattern: 'bottomToTop',
        outPattern: 'same',
        inDuration: IN,
        hold: HOLD,
        outDuration: OUT,
        overlap: 0.55,
        jitter: 0.32,
        spin: 'flipX',
        seed: 7,
      }, { width, height });
    };
    load();
    let timer = 0;
    const onResize = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(load, 200);
    };
    window.addEventListener('resize', onResize);
    return () => {
      window.removeEventListener('resize', onResize);
      window.clearTimeout(timer);
    };
  }, [ready, entry, theme, language]);

  // 滚动 → 播放头；只在这一段可见时画
  useEffect(() => {
    const section = sectionRef.current;
    if (!section || !enabled) return;
    const g = track(section);
    let lastT = -1;
    let lastActive = false;
    const off = onFrame((s) => {
      const top = (g.geometry.top - s.y) / s.vh;
      const time = timeAt(top);
      const active = ready && time > 0 && time < DURATION;
      const live = liveRef.current;
      if (active !== lastActive) {
        lastActive = active;
        if (overlayRef.current) overlayRef.current.dataset.active = String(active);
        live?.setVisible(active);
      }
      // 剪辑点以前，下面的开场白不显示（换的那一刻被方块完全挡住）；引擎没起来时一直显示
      if (clipBRef.current) clipBRef.current.style.visibility = ready && time < CUT_TIME ? 'hidden' : 'visible';
      if (!active || !live) return;
      if (Math.abs(time - lastT) > 1e-4) {
        lastT = time;
        live.seek(time);
        if (hudTimeRef.current) hudTimeRef.current.textContent = `${time.toFixed(2)} / ${DURATION.toFixed(2)} s`;
        // 品牌蓝的光从方块的缝隙里透出来：铺满前后最亮
        const cover = clamp01(1 - Math.abs(time - CUT_TIME) / (CUT_TIME * 0.9));
        if (glowRef.current) glowRef.current.style.opacity = (cover * 0.9).toFixed(3);
        // 一道品牌蓝的光跟着波前（从下往上）扫过翻转中的方块
        const ph = time <= IN ? time / IN : time >= IN + HOLD ? (time - IN - HOLD) / OUT : -1;
        const wave = waveRef.current;
        if (wave) {
          if (ph < 0) wave.style.opacity = '0';
          else {
            wave.style.opacity = Math.sin(Math.PI * clamp01(ph)).toFixed(3);
            wave.style.transform = `translate3d(0, ${((1.15 - ph * 1.3) * s.vh).toFixed(1)}px, 0)`;
          }
        }
      }
    });
    return () => {
      off();
      g.untrack();
    };
  }, [enabled, ready]);

  // 测试钩子：剪辑点那一刻画面是否铺满（读引擎的像素）
  useEffect(() => {
    if (!ready || !new URLSearchParams(window.location.search).has('e2e')) return;
    (window as unknown as { __siteCut?: unknown }).__siteCut = {
      cutTime: CUT_TIME,
      duration: DURATION,
      timeAtTop: timeAt,
      coverage: async (time: number) => {
        const px = await liveRef.current?.readPixels(time);
        if (!px) return -1;
        let opaque = 0;
        let n = 0;
        for (let i = 3; i < px.length; i += 4 * 97) {
          n++;
          if (px[i]! > 250) opaque++;
        }
        return n > 0 ? opaque / n : -1;
      },
    };
  }, [ready]);

  const name = entry ? localize(entry.manifest.name, language) : '';

  return (
    <section ref={sectionRef} id={SECTION.cut} data-cut aria-labelledby="cut-title" className={`relative ${enabled ? 'h-[240vh]' : ''}`}>
      <div className={enabled ? 'sticky top-0 flex h-[100svh] items-center overflow-hidden' : 'py-28'}>
        <div className="pointer-events-none absolute inset-0 bg-grid fade-mask opacity-60" aria-hidden="true" />
        <div ref={clipBRef} className="wrap relative">
          <span data-allay-anchor="cut" data-allay-facing="left" className="absolute top-[12%] right-[12%] hidden size-1 lg:block" aria-hidden="true" />
          <p className="t-mono flex items-center gap-3 text-fg-subtle">
            <span className="inline-block size-2 rotate-45 rounded-[1.5px] bg-mark" aria-hidden="true" />
            {t('site.cut.kicker')}
          </p>
          <h2 id="cut-title" className="t-display mt-6 max-w-[11em]">
            {t('site.cut.titleA')}
            <br />
            <span className="t-glow">{t('site.cut.titleB')}</span>
          </h2>
          <p className="t-lead mt-8 max-w-[32em]">{t('site.cut.body', { template: name })}</p>
        </div>
      </div>

      {enabled && (
        <div ref={overlayRef} data-active="false" className="cut-overlay pointer-events-none fixed inset-0 z-40" data-testid="cut-overlay" aria-hidden="true">
          <div ref={glowRef} className="absolute inset-0 opacity-0" style={{ background: 'radial-gradient(80% 60% at 50% 100%, rgb(var(--glow) / .5), transparent 70%)' }} />
          <canvas ref={canvasRef} className="absolute inset-0 size-full" />
          <div ref={waveRef} className="cut-wave absolute inset-x-0 top-[-35vh] h-[70vh] opacity-0" />
          <div className="absolute bottom-5 left-[var(--gutter)] flex items-center gap-3 rounded-full px-4 py-2 text-[12px] nav-glass">
            <span className="inline-block size-2 rotate-45 rounded-[1.5px] bg-mark" />
            <span className="font-medium">{t('site.cut.hud', { template: name })}</span>
            <span ref={hudTimeRef} className="t-tab text-fg-subtle">
              0.00 / {DURATION.toFixed(2)} s
            </span>
          </div>
        </div>
      )}
    </section>
  );
}
