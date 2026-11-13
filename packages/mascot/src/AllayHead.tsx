import { useEffect, useRef, useState } from 'react';
import { headUrl, pickHeadSize, useMascotAssets } from './assets';
import { HeadPlaceholder } from './placeholder';
import { useReducedMotion } from './reduced';

// AllayHead（docs/07-allay-mascot.md 7.4、7.5 第 9 项）：顶栏头像。静态；每 6–10 秒眨一次眼；点击它转一圈。
// 用烘焙的正面头像（allay-head-<n>.png 与闭眼版），按设备像素取不超过所需的最大一张，整数像素显示、不插值。
// 睁眼和闭眼两张都放在 DOM 里，眨眼只切可见性，不会因为换图闪一下。产物缺失时用 CSS 占位。
// 头像不算“全身悦灵”，不参与 stage.ts 的协调。

const BLINK_INTERVALS = [7200, 8600, 6400, 9300, 7800];
const BLINK_MS = 140;

export function AllayHead({ size = 20, className, onClick, label }: { size?: number; className?: string; onClick?: () => void; label?: string }) {
  const assets = useMascotAssets();
  const reduced = useReducedMotion();
  const [closed, setClosed] = useState(false);
  const [spin, setSpin] = useState(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    // 眨眼间隔取 6–10 秒之间的固定序列（界面装饰；不用 Math.random 只是为了截图可复现）
    let i = 0;
    const next = () => {
      timer.current = setTimeout(() => {
        setClosed(true);
        timer.current = setTimeout(() => {
          setClosed(false);
          next();
        }, BLINK_MS);
      }, BLINK_INTERVALS[i++ % BLINK_INTERVALS.length]);
    };
    next();
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);

  const s = size;
  const dpr = typeof window === 'undefined' ? 1 : window.devicePixelRatio || 1;
  const headPx = pickHeadSize(s * dpr);
  const css = headPx / dpr;
  const head = (
    <span
      data-allay="head"
      data-eyes={closed ? 'closed' : 'open'}
      data-source={assets.status === 'ready' ? 'atlas' : assets.status === 'missing' ? 'placeholder' : 'pending'}
      aria-hidden="true"
      className="pointer-events-none relative inline-flex shrink-0 items-center justify-center"
      style={{
        width: s,
        height: s,
        transform: spin ? `rotate(${spin * 360}deg)` : undefined,
        transition: spin && !reduced ? 'transform var(--dur-4) var(--ease-out)' : undefined,
      }}
    >
      {assets.status === 'missing' && <HeadPlaceholder size={s} closed={closed} />}
      {assets.status === 'ready' &&
        ([false, true] as const).map((c) => (
          <img
            key={String(c)}
            src={headUrl(headPx, c)}
            alt=""
            draggable={false}
            className="pointer-events-none absolute"
            style={{ width: css, height: css, imageRendering: 'pixelated', visibility: c === closed ? 'visible' : 'hidden' }}
          />
        ))}
    </span>
  );
  if (!onClick) {
    return <span className={`inline-flex shrink-0 items-center justify-center ${className ?? ''}`} style={{ width: s, height: s }}>{head}</span>;
  }
  return (
    <button
      type="button"
      aria-label={label}
      className={`inline-flex shrink-0 items-center justify-center rounded-sm ${className ?? ''}`}
      style={{ width: Math.max(24, s), height: Math.max(24, s) }}
      onClick={() => {
        // 点击转一圈；减少动效时不转
        if (!reduced) setSpin((n) => n + 1);
        onClick();
      }}
    >
      {head}
    </button>
  );
}
