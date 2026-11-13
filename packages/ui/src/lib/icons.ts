import type { IconWeight } from '@phosphor-icons/react';

// 图标（6.2）：Phosphor，常态 regular，激活、选中、播放控制用 fill。尺寸与字重只在这里定，组件里引用这些常量。

/** 图标尺寸（px）：sm 用在控件里、行内；md 是工具栏和按钮的默认 */
export const ICON = { xs: 12, sm: 14, md: 16 } as const;

/** 常态与激活态的字重 */
export const ICON_WEIGHT: { normal: IconWeight; active: IconWeight } = { normal: 'regular', active: 'fill' };

/** 应用根部 IconContext 的默认值 */
export const ICON_DEFAULTS = { size: ICON.md, weight: ICON_WEIGHT.normal, color: 'currentColor', mirrored: false } as const;
