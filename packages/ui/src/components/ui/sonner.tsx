import type { CSSProperties } from 'react';
import { Toaster as Sonner, type ToasterProps } from 'sonner';

// 通知（Sonner）。颜色、圆角走设计变量，无描边、弹层阴影；位置在时间轴面板上方居中，不挡顶栏。

function Toaster(props: ToasterProps) {
  return (
    <Sonner
      position="bottom-center"
      offset={{ bottom: 272 }}
      gap={8}
      style={
        {
          '--normal-bg': 'var(--surface-2)',
          '--normal-text': 'var(--foreground)',
          '--normal-border': 'transparent',
          '--border-radius': 'var(--r-panel)',
        } as CSSProperties
      }
      {...props}
    />
  );
}

export { Toaster };
