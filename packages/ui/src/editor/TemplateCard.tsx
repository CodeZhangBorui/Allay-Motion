import { cn } from 'cn';
import { TriangleAlert } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { Skeleton } from '../components/ui/misc';

// TemplateCard（6.4）：16:9 的封面加一行名称。悬停时播放预览循环；选中时 2 px 的 --ring 描边加一圈柔和的悦灵青辉光。
// 用户自己的模板在角上有一个 --amethyst 的小标记；出错或试运行有警告时加警告角标。

export interface TemplateCardProps {
  name: string;
  /** 封面（blob: URL）；null 表示还在生成，显示骨架 */
  coverUrl: string | null;
  selected: boolean;
  user: boolean;
  userLabel: string;
  warning?: string;
  disabled?: boolean;
  /** 悬停时显示的预览循环 */
  renderPreview?: () => ReactNode;
  onSelect(): void;
  testId?: string;
  /** 附在名称后面、给屏幕阅读器和提示用的说明 */
  description?: string;
}

export function TemplateCard({ name, coverUrl, selected, user, userLabel, warning, disabled, renderPreview, onSelect, testId, description }: TemplateCardProps) {
  const [hover, setHover] = useState(false);
  return (
    <button
      type="button"
      data-testid={testId}
      aria-pressed={selected}
      aria-description={description}
      disabled={disabled}
      title={warning ? `${name}\n${warning}` : name}
      onClick={onSelect}
      onPointerEnter={() => setHover(true)}
      onPointerLeave={() => setHover(false)}
      onFocus={() => setHover(true)}
      onBlur={() => setHover(false)}
      className={cn(
        'group flex w-full min-w-0 flex-col gap-1.5 rounded-lg p-1 text-left transition-colors duration-(--dur-1) hover:bg-surface-2 disabled:opacity-50',
        selected && 'bg-surface-2',
      )}
    >
      <div
        className={cn(
          'preview-checker-sm relative aspect-video w-full overflow-hidden rounded-md border transition-shadow duration-(--dur-2)',
          selected && 'border-transparent shadow-[0_0_0_2px_var(--ring),0_0_14px_2px_color-mix(in_srgb,var(--allay-glow)_45%,transparent)]',
        )}
      >
        {coverUrl ? <img src={coverUrl} alt="" draggable={false} className="absolute inset-0 size-full object-cover" /> : <Skeleton className="absolute inset-0 rounded-none" />}
        {hover && coverUrl && renderPreview && <div className="absolute inset-0">{renderPreview()}</div>}
        {user && (
          <span className="absolute top-1 left-1 size-2 rounded-full bg-amethyst ring-2 ring-surface-1" title={userLabel}>
            <span className="sr-only">{userLabel}</span>
          </span>
        )}
        {warning && (
          <span className="absolute top-1 right-1 inline-flex size-5 items-center justify-center rounded-sm bg-surface-1/90 text-warning" aria-hidden="true">
            <TriangleAlert className="size-3.5" />
          </span>
        )}
      </div>
      <span className={cn('truncate px-0.5 text-xs', selected ? 'font-medium text-foreground' : 'text-fg-muted group-hover:text-foreground')}>
        {name}
        {warning && <span className="sr-only"> · {warning}</span>}
      </span>
    </button>
  );
}
