import { cn } from 'cn';
import { TriangleAlert } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { Skeleton } from '../components/ui/misc';

// TemplateCard（6.4）：一个凹槽里放 16:9 的封面，名称在槽下用像素字。悬停时播放预览循环；
// 选中时整张卡片是 2 px 的 --ring 描边，四角各有一个小方块标记（不发光）。
// 用户自己的模板在角上有一个 --amethyst 的小方块标记；出错或试运行有警告时加警告角标。

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

const CORNERS = ['-top-1 -left-1', '-top-1 -right-1', '-bottom-1 -left-1', '-bottom-1 -right-1'];

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
        'group relative flex w-full min-w-0 flex-col gap-1.5 p-1.5 text-left transition-colors duration-(--dur-1) ease-(--ease-step) hover:bg-surface-2 disabled:opacity-50',
        selected && 'blk blk-edge-ring bg-surface-2',
      )}
    >
      <div className="relative aspect-video w-full blk-sunken p-0.5">
        <div className="preview-checker-sm relative size-full overflow-hidden">
          {coverUrl ? <img src={coverUrl} alt="" draggable={false} className="absolute inset-0 size-full object-cover" /> : <Skeleton className="absolute inset-0" />}
          {hover && coverUrl && renderPreview && <div className="absolute inset-0">{renderPreview()}</div>}
        </div>
        {user && (
          <span className="absolute top-1 left-1 size-2.5 bg-amethyst halo-well" title={userLabel}>
            <span className="sr-only">{userLabel}</span>
          </span>
        )}
        {warning && (
          <span className="absolute top-1 right-1 inline-flex size-5 items-center justify-center bg-well text-warning" aria-hidden="true">
            <TriangleAlert className="size-(--icon-sm)" />
          </span>
        )}
      </div>
      <span className={cn('truncate px-0.5 font-px12', selected ? 'text-foreground' : 'text-fg-muted group-hover:text-foreground')}>
        {name}
        {warning && <span className="sr-only"> · {warning}</span>}
      </span>
      {selected && CORNERS.map((c) => <span key={c} className={cn('pointer-events-none absolute size-1.5 bg-ring', c)} aria-hidden="true" />)}
    </button>
  );
}
