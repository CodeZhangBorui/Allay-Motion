import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import type { ClipName } from '../model/allay.motions';

// 悦灵组件的占位实现（M4）。接口已经是最终的（docs/07-allay-mascot.md 7.4）；外形只用 CSS 几何形状，
// 不读烘焙产物、不画新图。占位图形跟随界面的“方块工作台”风格：全是方角的平涂色块，不发光。
// M5 后半把内部换成图集的 <canvas> 绘制，调用方不用改。

export interface AllayProps {
  clip?: ClipName;
  /** 显示尺寸（px，正方形） */
  size?: number;
  facing?: 'left' | 'right';
  /** 捧着的东西（物品图标等），画在手部锚点上 */
  carry?: ReactNode;
  /** 悦灵青的 drop-shadow 辉光（不烘进图集）。界面重设计后不画辉光（禁止发光），占位实现忽略这个参数 */
  glow?: boolean;
  className?: string;
  style?: CSSProperties;
}

/** 一只悦灵。只负责画当前帧，不负责移动。显示尺寸小于 28 px 时一律用头像（7.3）。 */
export function Allay({ clip = 'hover', size = 72, facing = 'right', carry, className, style }: AllayProps) {
  if (size < 28) return <AllayHead size={size} className={className} />;
  const s = size;
  return (
    <span
      data-allay="body"
      data-clip={clip}
      aria-hidden="true"
      className={`allay-placeholder pointer-events-none relative inline-block shrink-0 ${className ?? ''}`}
      style={{
        width: s,
        height: s,
        // 朝向用水平翻转，转身 140 ms
        transform: facing === 'left' ? 'scaleX(-1)' : undefined,
        transition: 'transform 140ms steps(2, end)',
        ...style,
      }}
    >
      <span className="allay-ph-bob absolute inset-0 block">
        {/* 翅膀 */}
        <span className="allay-ph-wing absolute block bg-allay-light" style={{ left: s * 0.1, top: s * 0.28, width: s * 0.36, height: s * 0.22 }} />
        <span className="allay-ph-wing absolute block bg-allay-light/60" style={{ left: s * 0.02, top: s * 0.36, width: s * 0.3, height: s * 0.18 }} />
        {/* 头 */}
        <span className="absolute block bg-allay" style={{ left: s * 0.36, top: s * 0.14, width: s * 0.36, height: s * 0.36 }}>
          <span className="absolute block bg-background" style={{ left: s * 0.15, top: s * 0.13, width: s * 0.05, height: s * 0.09 }} />
          <span className="absolute block bg-background" style={{ left: s * 0.25, top: s * 0.13, width: s * 0.05, height: s * 0.09 }} />
        </span>
        {/* 身体和下摆 */}
        <span className="absolute block bg-allay-deep" style={{ left: s * 0.44, top: s * 0.5, width: s * 0.2, height: s * 0.26 }} />
        <span className="absolute block bg-allay/40" style={{ left: s * 0.42, top: s * 0.68, width: s * 0.24, height: s * 0.14 }} />
        {carry && (
          <span className="absolute flex items-center justify-center" style={{ left: s * 0.6, top: s * 0.52, width: s * 0.3, height: s * 0.3 }}>
            {carry}
          </span>
        )}
      </span>
    </span>
  );
}

/** 顶栏头像：静态；每 6–10 秒眨一次眼；点击它转一圈（7.5 第 9 项）。占位用 CSS 方块。 */
export function AllayHead({ size = 20, className, onClick, label }: { size?: number; className?: string; onClick?: () => void; label?: string }) {
  const [closed, setClosed] = useState(false);
  const [spin, setSpin] = useState(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    // 眨眼间隔取 6–10 秒之间的固定序列（界面装饰，不影响画面，确定性无所谓；避免 Math.random 只是为了截图可复现）
    const intervals = [7200, 8600, 6400, 9300, 7800];
    let i = 0;
    const next = () => {
      timer.current = setTimeout(() => {
        setClosed(true);
        timer.current = setTimeout(() => {
          setClosed(false);
          next();
        }, 140);
      }, intervals[i++ % intervals.length]);
    };
    next();
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);
  const s = size;
  const head = (
    <span
      data-allay="head"
      data-eyes={closed ? 'closed' : 'open'}
      aria-hidden="true"
      className="relative inline-block shrink-0 bg-allay"
      style={{ width: s * 0.8, height: s * 0.8, transform: `rotate(${spin * 360}deg)`, transition: spin ? 'transform var(--dur-4) steps(4, end)' : undefined }}
    >
      <span className="absolute block bg-background" style={{ left: s * 0.22, top: s * 0.3, width: s * 0.1, height: closed ? s * 0.03 : s * 0.17 }} />
      <span className="absolute block bg-background" style={{ left: s * 0.48, top: s * 0.3, width: s * 0.1, height: closed ? s * 0.03 : s * 0.17 }} />
    </span>
  );
  if (!onClick) {
    return (
      <span className={`inline-flex shrink-0 items-center justify-center ${className ?? ''}`} style={{ width: s, height: s }}>
        {head}
      </span>
    );
  }
  return (
    <button
      type="button"
      aria-label={label}
      className={`inline-flex shrink-0 items-center justify-center ${className ?? ''}`}
      style={{ width: Math.max(24, s), height: Math.max(24, s) }}
      onClick={() => {
        setSpin((n) => n + 1);
        onClick();
      }}
    >
      {head}
    </button>
  );
}
