import { useEffect, useLayoutEffect } from 'react';
import type { UiSettings } from '../../shared/settings';

/**
 * 读一个颜色变量的实际值，转成 #RRGGBB。
 * 构建时 CSS 会被压缩（#FFFFFF → #fff），所以不直接读变量文本，而是让浏览器解析成 rgb()。
 */
function resolveColorVar(name: string): string | null {
  const probe = document.createElement('span');
  probe.style.color = `var(${name})`;
  probe.style.display = 'none';
  document.body.appendChild(probe);
  const rgb = getComputedStyle(probe).color;
  probe.remove();
  const m = /^rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(rgb);
  if (!m) return null;
  return `#${[m[1], m[2], m[3]].map((n) => Number(n).toString(16).padStart(2, '0')).join('')}`.toUpperCase();
}

/** 把主题和“减少动效”写到 <html> 上 */
export function applyThemeToDocument(settings: Pick<UiSettings, 'theme' | 'reducedMotion'>): void {
  const root = document.documentElement;
  root.dataset.theme = settings.theme;
  const systemReduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const reduced = settings.reducedMotion === 'on' || (settings.reducedMotion === 'system' && systemReduced);
  root.dataset.reducedMotion = String(reduced);
}

/** 主题变化时更新页面，并让系统窗口按钮区的颜色跟着走（6.3、T-UI-8） */
export function useThemeSync(settings: Pick<UiSettings, 'theme' | 'reducedMotion'>): void {
  const { theme, reducedMotion } = settings;
  useLayoutEffect(() => {
    applyThemeToDocument({ theme, reducedMotion });
    // 顶栏坐在底色上，按钮区跟底色一致
    const color = resolveColorVar('--background');
    const symbolColor = resolveColorVar('--foreground');
    if (color && symbolColor) {
      window.allay.window.setTitleBarColors({ color, symbolColor }).catch((error: unknown) => {
        console.error('failed to update title bar colors', error);
      });
    }
  }, [theme, reducedMotion]);
  // “跟随系统”时，系统的减少动效开关变了也要跟着变（悦灵的编排据此切换静止表现，docs/07-allay-mascot.md 7.9）
  useEffect(() => {
    if (reducedMotion !== 'system') return;
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const onChange = () => applyThemeToDocument({ theme, reducedMotion });
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, [theme, reducedMotion]);
}
