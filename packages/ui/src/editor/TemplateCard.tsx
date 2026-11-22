import { ImageBroken, Warning } from '@phosphor-icons/react';
import { cn } from 'cn';
import { useEffect, useRef, type KeyboardEvent, type ReactNode, type Ref } from 'react';
import { Skeleton } from '../components/ui/misc';
import { ICON, ICON_WEIGHT } from '../lib/icons';

// TemplateCard（6.4）：16:9 的缩略图（圆角 7），名称在下、时长（等宽）在右。
// - 封面三种样子：还在生成（骨架）、好了（图）、生成失败（凹槽底上一个第三级灰的图标，原因在提示里）。
// - 悬停预览：指针或键盘焦点在卡片上停够 previewDelay 才告诉外面（onPreviewIntent），外面准备好了就把正在播放的画面放进 preview；
//   生成中的进度是缩略图底边一条 2 px 的强调色线（数值填充一类的强调色用法），从缓存读出来时没有。
// - 选中时缩略图外有一圈面板色的 2 px 间隙加 2 px 强调色外框，不发光；名称变成正文色。焦点环是全局的 2 px 强调色外框。
// - 用户自己的模板在左上角有一个 --amethyst 的小点；出错或试运行有警告时右上角加警告角标。

export interface TemplateCardProps {
  name: string;
  /** 时长（已格式化，如“1.1 s”）；不知道时不显示 */
  duration?: string;
  /** 封面（blob: URL） */
  coverUrl: string | null;
  /** 封面的状态：loading 显示骨架，failed 显示出错的样子（原因在 coverError） */
  coverState?: 'loading' | 'ready' | 'failed';
  coverError?: string;
  selected: boolean;
  user: boolean;
  userLabel: string;
  warning?: string;
  disabled?: boolean;
  /** 正在播放的悬停预览（有内容时盖在封面上） */
  preview?: ReactNode;
  /** 悬停预览正在生成：进度 0–1；没有在生成时不传 */
  previewProgress?: number | null;
  /** 指针或焦点在卡片上停够了 previewDelay（true），或者离开了（false） */
  onPreviewIntent?(active: boolean): void;
  previewDelay?: number;
  onSelect(): void;
  testId?: string;
  /** 附在名称后面、给屏幕阅读器的说明 */
  description?: string;
  /** 鼠标停留时的提示里名称下面的那一行（如“转场 · 1.1 s”） */
  detail?: string;
  /** 模板库的漫游 tabindex：只有当前那一张是 0 */
  tabIndex?: number;
  onKeyDown?(event: KeyboardEvent<HTMLButtonElement>): void;
  onFocus?(): void;
  ref?: Ref<HTMLButtonElement>;
}

/** 停多久才算“要看悬停预览”：快速划过的卡片不生成 */
export const PREVIEW_DELAY_MS = 350;

export function TemplateCard({
  name,
  duration,
  coverUrl,
  coverState = coverUrl ? 'ready' : 'loading',
  coverError,
  selected,
  user,
  userLabel,
  warning,
  disabled,
  preview,
  previewProgress,
  onPreviewIntent,
  previewDelay = PREVIEW_DELAY_MS,
  onSelect,
  testId,
  description,
  detail,
  tabIndex,
  onKeyDown,
  onFocus,
  ref,
}: TemplateCardProps) {
  // 停留计时：指针或焦点进来开始数，离开时取消；已经报过 true 的，离开时报 false
  const dwell = useRef<{ timer: ReturnType<typeof setTimeout> | null; active: boolean; notify?: (active: boolean) => void }>({ timer: null, active: false });
  dwell.current.notify = onPreviewIntent;
  const arm = () => {
    const d = dwell.current;
    if (d.timer !== null) clearTimeout(d.timer);
    d.timer = setTimeout(() => {
      d.timer = null;
      d.active = true;
      d.notify?.(true);
    }, previewDelay);
  };
  const disarm = () => {
    const d = dwell.current;
    if (d.timer !== null) clearTimeout(d.timer);
    d.timer = null;
    if (d.active) {
      d.active = false;
      d.notify?.(false);
    }
  };
  useEffect(() => {
    const d = dwell.current;
    return () => {
      if (d.timer !== null) clearTimeout(d.timer);
      if (d.active) d.notify?.(false);
    };
  }, []);

  const tip = [name, detail, coverState === 'failed' ? coverError : undefined, warning].filter(Boolean).join('\n');
  return (
    <button
      ref={ref}
      type="button"
      data-testid={testId}
      data-cover={coverState}
      aria-pressed={selected}
      aria-description={description}
      disabled={disabled}
      tabIndex={tabIndex}
      title={tip}
      onClick={onSelect}
      onKeyDown={onKeyDown}
      onPointerEnter={arm}
      onPointerLeave={disarm}
      onFocus={() => {
        arm();
        onFocus?.();
      }}
      onBlur={disarm}
      className="group flex w-full min-w-0 scroll-mt-9 scroll-mb-2 flex-col gap-[7px] rounded-lg text-left disabled:opacity-45"
    >
      <div
        className={cn(
          'relative aspect-video w-full overflow-hidden rounded-lg transition-[box-shadow,filter] duration-(--dur-1)',
          coverState === 'failed' ? 'bg-well' : 'preview-checker-sm',
          selected ? 'shadow-[0_0_0_2px_var(--surface-1),0_0_0_4px_var(--primary)]' : 'group-hover:brightness-110',
        )}
      >
        {coverState === 'ready' && coverUrl && <img src={coverUrl} alt="" draggable={false} className="absolute inset-0 size-full object-cover" />}
        {coverState === 'loading' && <Skeleton className="absolute inset-0 rounded-none" />}
        {coverState === 'failed' && (
          <span className="absolute inset-0 flex items-center justify-center text-fg-faint" aria-hidden="true">
            <ImageBroken size={ICON.md + 4} />
          </span>
        )}
        {preview && <div className="absolute inset-0">{preview}</div>}
        {previewProgress !== undefined && previewProgress !== null && (
          <span className="absolute bottom-0 left-0 h-0.5 bg-primary transition-[width] duration-(--dur-2)" style={{ width: `${Math.round(Math.min(1, Math.max(0.04, previewProgress)) * 100)}%` }} aria-hidden="true" />
        )}
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
          {coverState === 'failed' && coverError && <span className="sr-only"> · {coverError}</span>}
        </span>
        {duration && <span className="shrink-0 num text-xs text-fg-subtle">{duration}</span>}
      </span>
    </button>
  );
}
