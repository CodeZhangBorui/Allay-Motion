import { Warning } from '@phosphor-icons/react';
import { cn } from 'cn';
import { useState, type ReactNode } from 'react';
import { Skeleton } from '../components/ui/misc';
import { ICON, ICON_WEIGHT } from '../lib/icons';

// TemplateCard（6.4）：16:9 的缩略图（圆角 7），名称在下、时长（等宽）在右。悬停时播放预览循环；
// 选中时缩略图外有一圈面板色的 2 px 间隙加 2 px 强调色外框，不发光；名称变成正文色。
// 用户自己的模板在角上有一个 --amethyst 的小点；出错或试运行有警告时加警告角标。

export interface TemplateCardProps {
  name: string;
  /** 时长（已格式化，如“1.1 s”）；不知道时不显示 */
  duration?: string;
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

export function TemplateCard({ name, duration, coverUrl, selected, user, userLabel, warning, disabled, renderPreview, onSelect, testId, description }: TemplateCardProps) {
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
      className="group flex w-full min-w-0 flex-col gap-[7px] rounded-lg text-left disabled:opacity-45"
    >
      <div
        className={cn(
          'preview-checker-sm relative aspect-video w-full overflow-hidden rounded-lg transition-shadow duration-(--dur-1)',
          selected ? 'shadow-[0_0_0_2px_var(--surface-1),0_0_0_4px_var(--primary)]' : 'group-hover:brightness-110',
        )}
      >
        {coverUrl ? <img src={coverUrl} alt="" draggable={false} className="absolute inset-0 size-full object-cover" /> : <Skeleton className="absolute inset-0 rounded-none" />}
        {hover && coverUrl && renderPreview && <div className="absolute inset-0">{renderPreview()}</div>}
        {user && (
          <span className="absolute top-1.5 left-1.5 size-2 rounded-full bg-amethyst" title={userLabel}>
            <span className="sr-only">{userLabel}</span>
          </span>
        )}
        {warning && (
          <span className="absolute top-1 right-1 inline-flex size-5 items-center justify-center rounded-sm bg-surface-1 text-warning" aria-hidden="true">
            <Warning size={ICON.sm} weight={ICON_WEIGHT.active} />
          </span>
        )}
      </div>
      <span className="flex min-w-0 items-baseline justify-between gap-2 px-px">
        <span className={cn('truncate', selected ? 'font-medium text-foreground' : 'text-fg-muted group-hover:text-foreground')}>
          {name}
          {warning && <span className="sr-only"> · {warning}</span>}
        </span>
        {duration && <span className="shrink-0 num text-xs text-fg-subtle">{duration}</span>}
      </span>
    </button>
  );
}
