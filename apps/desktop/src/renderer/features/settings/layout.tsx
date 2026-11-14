import { cn } from '@allay/ui/lib/utils';
import type { ReactNode } from 'react';

// 设置页的排版（docs/06-ui-design.md 6.11）：和属性面板同一套语言——
// 分组是“半粗小标题 + 若干行”，组与组之间 1 px 分隔线；每一行左边是标签（正文色）和一行说明（第三级灰），
// 右边是控件，控件统一右对齐、统一宽度。没有卡片、没有描边、没有阴影。

export function SettingsSection({ title, description, children, testId, className }: { title?: string; description?: string; children: ReactNode; testId?: string; className?: string }) {
  return (
    <section className={cn('flex flex-col border-t border-divider pt-3 pb-4 first:border-t-0 first:pt-0', className)} data-testid={testId}>
      {title && <h3 className="text-base font-semibold text-foreground">{title}</h3>}
      {description && <p className="mt-0.5 max-w-[56ch] text-xs leading-snug text-fg-subtle">{description}</p>}
      <div className={cn('flex flex-col', title || description ? 'mt-2' : undefined)}>{children}</div>
    </section>
  );
}

/** 控件列的统一宽度 */
export const CONTROL_W = 'w-52';

export function SettingsRow({
  label,
  hint,
  children,
  htmlFor,
  testId,
  stacked,
}: {
  label: ReactNode;
  hint?: ReactNode;
  children?: ReactNode;
  htmlFor?: string;
  testId?: string;
  /** 控件太宽（列表、长路径）时放到标签下面 */
  stacked?: boolean;
}) {
  return (
    <div className={cn('flex gap-x-6 py-2', stacked ? 'flex-col gap-y-2' : 'min-h-11 items-center justify-between')} data-testid={testId}>
      <div className="flex min-w-0 flex-col gap-0.5">
        {htmlFor ? (
          <label htmlFor={htmlFor} className="text-sm text-foreground">
            {label}
          </label>
        ) : (
          <span className="text-sm text-foreground">{label}</span>
        )}
        {hint && <span className="text-xs leading-snug text-fg-subtle">{hint}</span>}
      </div>
      {children !== undefined && <div className={cn('flex shrink-0 items-center gap-2', stacked ? 'w-full' : 'justify-end')}>{children}</div>}
    </div>
  );
}

/** 页头：标题和一句说明 */
export function SettingsPageHeader({ title, description }: { title: string; description?: string }) {
  return (
    <header className="flex flex-col gap-1 pb-4">
      <h2 className="text-lg font-semibold text-foreground">{title}</h2>
      {description && <p className="max-w-[60ch] text-sm text-fg-subtle">{description}</p>}
    </header>
  );
}
