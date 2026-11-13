import { useEffect, useState } from 'react';

// “减少动效”（docs/07-allay-mascot.md 7.9）：应用把设置和系统的 prefers-reduced-motion 合成后写在
// <html data-reduced-motion="true|false"> 上（useThemeSync），这里只读它。

export function isReducedMotion(): boolean {
  return typeof document !== 'undefined' && document.documentElement.dataset.reducedMotion === 'true';
}

export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(isReducedMotion);
  useEffect(() => {
    const mo = new MutationObserver(() => setReduced(isReducedMotion()));
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-reduced-motion'] });
    setReduced(isReducedMotion());
    return () => mo.disconnect();
  }, []);
  return reduced;
}
