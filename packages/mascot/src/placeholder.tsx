import type { CSSProperties, ReactNode } from 'react';
import type { ClipName } from '../model/allay.motions';

// 烘焙产物缺失时的 CSS 占位（M4 的实现，界面重设计后跟上配色）：方块的头、两只眼、椭圆翅膀。
// 产物不在仓库里（docs/decisions.md M5a），所以 CI、没装游戏的机器和自动化测试看到的是它。
// 不读任何图片、不画新像素；配色只用设计变量。

export function AllayPlaceholder({
  clip,
  size: s,
  facing,
  carry,
  reduced,
  className,
  style,
}: {
  clip: ClipName;
  size: number;
  facing: 'left' | 'right';
  carry?: ReactNode;
  reduced: boolean;
  className?: string;
  style?: CSSProperties;
}) {
  return (
    <span
      data-allay="body"
      data-clip={clip}
      data-source="placeholder"
      aria-hidden="true"
      className={`allay-placeholder pointer-events-none relative inline-block shrink-0 ${className ?? ''}`}
      style={{
        width: s,
        height: s,
        transform: facing === 'left' ? 'scaleX(-1)' : undefined,
        transition: reduced ? undefined : 'transform 140ms var(--ease-out)',
        ...style,
      }}
    >
      <span className="allay-ph-bob absolute inset-0 block">
        <span className="allay-ph-wing absolute block rounded-[50%] bg-allay-light/70" style={{ left: s * 0.1, top: s * 0.28, width: s * 0.36, height: s * 0.22 }} />
        <span className="allay-ph-wing absolute block rounded-[50%] bg-allay-light/50" style={{ left: s * 0.02, top: s * 0.36, width: s * 0.3, height: s * 0.18 }} />
        <span className="absolute block rounded-[22%] bg-allay" style={{ left: s * 0.36, top: s * 0.14, width: s * 0.36, height: s * 0.36 }}>
          <span className="absolute block rounded-[1px] bg-background" style={{ left: s * 0.15, top: s * 0.13, width: s * 0.05, height: s * 0.09 }} />
          <span className="absolute block rounded-[1px] bg-background" style={{ left: s * 0.25, top: s * 0.13, width: s * 0.05, height: s * 0.09 }} />
        </span>
        <span className="absolute block rounded-[30%] bg-allay-deep" style={{ left: s * 0.44, top: s * 0.5, width: s * 0.2, height: s * 0.26 }} />
        <span className="absolute block rounded-b-[40%] bg-allay/40" style={{ left: s * 0.42, top: s * 0.68, width: s * 0.24, height: s * 0.14 }} />
        {carry && (
          <span className="absolute flex items-center justify-center" style={{ left: s * 0.6, top: s * 0.52, width: s * 0.3, height: s * 0.3 }}>
            {carry}
          </span>
        )}
      </span>
    </span>
  );
}

/** 头像的占位：圆角方块和两只眼睛 */
export function HeadPlaceholder({ size: s, closed }: { size: number; closed: boolean }) {
  return (
    <span className="relative inline-block shrink-0 rounded-[22%] bg-allay" style={{ width: s * 0.8, height: s * 0.8 }}>
      <span className="absolute block rounded-[1px] bg-background" style={{ left: s * 0.22, top: s * 0.3, width: s * 0.1, height: closed ? s * 0.03 : s * 0.17 }} />
      <span className="absolute block rounded-[1px] bg-background" style={{ left: s * 0.48, top: s * 0.3, width: s * 0.1, height: closed ? s * 0.03 : s * 0.17 }} />
    </span>
  );
}
