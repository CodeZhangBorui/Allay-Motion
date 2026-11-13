import type { CSSProperties } from 'react';
import { Toaster as Sonner, type ToasterProps } from 'sonner';

// 通知（Sonner）。颜色走设计变量；位置在播放条上方居中，不挡顶栏。

function Toaster(props: ToasterProps) {
  return (
    <Sonner
      position="bottom-center"
      offset={{ bottom: 64 }}
      gap={8}
      style={
        {
          '--normal-bg': 'var(--surface-2)',
          '--normal-text': 'var(--foreground)',
          '--normal-border': 'var(--border)',
          '--border-radius': '8px',
        } as CSSProperties
      }
      {...props}
    />
  );
}

export { Toaster };
