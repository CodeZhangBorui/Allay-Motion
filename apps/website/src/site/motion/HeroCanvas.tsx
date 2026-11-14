// 首屏 3D 场景的画布：懒加载 three 和场景（motion/hero-scene.ts），挂在共享帧循环上。
// 只在可见时画；减少动效时只画静止的一帧（尺寸、主题变了再画）。WebGL 不可用时什么也不显示（文字照常）。
import { useEffect, useRef, useState, type RefObject } from 'react';
import { usePrefs } from '../prefs';
import { onFrame } from './frame';
import type { HeroScene } from './hero-scene';

export function HeroCanvas({ progress, visible, className }: { progress: RefObject<number>; visible: RefObject<boolean>; className?: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const sceneRef = useRef<HeroScene | null>(null);
  const [ready, setReady] = useState(false);
  const { theme, reducedMotion } = usePrefs();
  const themeRef = useRef(theme);
  themeRef.current = theme;
  const dirty = useRef(true);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let alive = true;
    let ro: ResizeObserver | null = null;
    void (async () => {
      try {
        const { HeroScene } = await import('./hero-scene');
        if (!alive) return;
        const scene = await HeroScene.create(canvas, themeRef.current);
        if (!alive) {
          scene.dispose();
          return;
        }
        sceneRef.current = scene;
        const size = () => {
          const dpr = Math.min(2, window.devicePixelRatio || 1);
          scene.resize(canvas.clientWidth * dpr, canvas.clientHeight * dpr);
          dirty.current = true;
        };
        size();
        ro = new ResizeObserver(size);
        ro.observe(canvas);
        setReady(true);
      } catch (error) {
        console.warn('[hero] 3D scene unavailable', error);
      }
    })();
    return () => {
      alive = false;
      ro?.disconnect();
      sceneRef.current?.dispose();
      sceneRef.current = null;
    };
  }, []);

  useEffect(() => {
    sceneRef.current?.setTheme(theme);
    dirty.current = true;
  }, [theme, ready]);

  useEffect(() => {
    if (!ready) return;
    let lastProgress = -1;
    return onFrame((s) => {
      const scene = sceneRef.current;
      if (!scene || !visible.current) return;
      const p = progress.current ?? 0;
      if (reducedMotion) {
        if (!dirty.current && p === lastProgress) return;
        dirty.current = false;
        lastProgress = p;
        scene.frame({ now: s.now, pointer: null, progress: 0, still: true });
        return;
      }
      const pointer = s.pointer ? { x: (s.pointer.x / s.vw) * 2 - 1, y: (s.pointer.y / s.vh) * 2 - 1 } : null;
      scene.frame({ now: s.now, pointer, progress: p, still: false });
    });
  }, [ready, reducedMotion, progress, visible]);

  return <canvas ref={canvasRef} className={`transition-opacity duration-[1200ms] ease-(--ease-out) ${ready ? 'opacity-100' : 'opacity-0'} ${className ?? ''}`} aria-hidden="true" data-testid="hero-scene" />;
}
