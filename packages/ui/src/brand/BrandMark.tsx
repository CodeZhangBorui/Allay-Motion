// 顶栏左侧的品牌标记。M0 是占位图形（强调色的圆角小方块）；
// 正式的悦灵头像在 M5 由 packages/mascot 的 AllayHead 提供，接口保持：size 和可选的 className。

export interface BrandMarkProps {
  size?: number;
  className?: string;
}

export function BrandMark({ size = 20, className }: BrandMarkProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 20 20" aria-hidden="true" className={className}>
      <rect x="1" y="1" width="18" height="18" rx="5" fill="var(--allay)" />
      <rect x="6" y="8" width="2" height="3" fill="var(--background)" />
      <rect x="12" y="8" width="2" height="3" fill="var(--background)" />
    </svg>
  );
}
