import { Collapsible as CollapsiblePrimitive } from '@base-ui/react/collapsible';
import { Input as InputPrimitive } from '@base-ui/react/input';
import { ScrollArea as ScrollAreaPrimitive } from '@base-ui/react/scroll-area';
import { Toggle as TogglePrimitive } from '@base-ui/react/toggle';
import { ToggleGroup as ToggleGroupPrimitive } from '@base-ui/react/toggle-group';
import { cn } from 'cn';
import { LoaderCircle } from 'lucide-react';
import type { ComponentProps } from 'react';
import { fieldClass } from './select';

// 几个小的 shadcn 组件：Input、Textarea、Badge、ToggleGroup、Collapsible、ScrollArea、Kbd、Spinner、Skeleton。

function Input({ className, ...props }: InputPrimitive.Props) {
  return <InputPrimitive className={cn(fieldClass, 'w-full min-w-0 select-text placeholder:text-fg-subtle', className)} {...props} />;
}

function Textarea({ className, ...props }: ComponentProps<'textarea'>) {
  return <textarea className={cn(fieldClass, 'h-auto min-h-14 w-full resize-y py-1 select-text placeholder:text-fg-subtle', className)} {...props} />;
}

function Badge({ className, variant = 'outline', ...props }: ComponentProps<'span'> & { variant?: 'outline' | 'amethyst' | 'warning' }) {
  return (
    <span
      className={cn(
        'inline-flex h-5 shrink-0 items-center gap-1 px-1.5 font-px12 whitespace-nowrap',
        variant === 'outline' && 'bg-well text-fg-muted',
        variant === 'amethyst' && 'bg-amethyst text-background',
        variant === 'warning' && 'bg-warning text-background',
        className,
      )}
      {...props}
    />
  );
}

/** 分段控件：4 项以内的 enum（4.4）、背景模式等。一排相连的方块按钮，选中的那块是按下去的凹槽 */
function ToggleGroup({ className, ...props }: ToggleGroupPrimitive.Props<string>) {
  return <ToggleGroupPrimitive className={cn('inline-flex h-7 items-stretch gap-0.5 p-0.5', className)} {...props} />;
}

function ToggleGroupItem({ className, ...props }: TogglePrimitive.Props<string>) {
  return (
    <TogglePrimitive
      className={cn(
        'inline-flex min-w-6 flex-1 items-center justify-center gap-1 blk blk-raised px-2 font-px12 whitespace-nowrap text-fg-muted transition-colors duration-(--dur-1) ease-(--ease-step) select-none hover:bg-surface-3 hover:text-foreground data-[pressed]:blk-sunken data-[pressed]:text-primary-text [&_svg]:size-(--icon-sm)',
        className,
      )}
      {...props}
    />
  );
}

const Collapsible = CollapsiblePrimitive.Root;
const CollapsibleTrigger = CollapsiblePrimitive.Trigger;
function CollapsibleContent({ className, ...props }: CollapsiblePrimitive.Panel.Props) {
  return <CollapsiblePrimitive.Panel className={cn('overflow-hidden', className)} {...props} />;
}

function ScrollArea({ className, children, viewportClassName, ...props }: ScrollAreaPrimitive.Root.Props & { viewportClassName?: string }) {
  return (
    <ScrollAreaPrimitive.Root className={cn('relative min-h-0 overflow-hidden', className)} {...props}>
      <ScrollAreaPrimitive.Viewport className={cn('h-full w-full overscroll-contain outline-none', viewportClassName)}>{children}</ScrollAreaPrimitive.Viewport>
      <ScrollAreaPrimitive.Scrollbar className="flex w-2 justify-center bg-well opacity-0 transition-opacity duration-(--dur-2) ease-(--ease-step) data-[hovering]:opacity-100 data-[scrolling]:opacity-100">
        <ScrollAreaPrimitive.Thumb className="w-full bg-input-border" />
      </ScrollAreaPrimitive.Scrollbar>
    </ScrollAreaPrimitive.Root>
  );
}

function Kbd({ className, ...props }: ComponentProps<'kbd'>) {
  return <kbd className={cn('inline-flex h-5 min-w-5 items-center justify-center bg-well px-1 font-px12 text-fg-muted', className)} {...props} />;
}

/** 区域很小（按钮内、行内）时的小转圈（6.8） */
function Spinner({ className, label }: { className?: string; label?: string }) {
  return <LoaderCircle role={label ? 'status' : undefined} aria-label={label} aria-hidden={label ? undefined : true} className={cn('size-(--icon-sm) animate-spin text-fg-muted [animation-timing-function:steps(8,end)]', className)} />;
}

/** 骨架块：形状与最终布局一致；只有很轻的呼吸（7.6 A） */
function Skeleton({ className, ...props }: ComponentProps<'div'>) {
  return <div aria-hidden="true" className={cn('allay-breathe bg-skeleton', className)} {...props} />;
}

export { Badge, Collapsible, CollapsibleContent, CollapsibleTrigger, Input, Kbd, ScrollArea, Skeleton, Spinner, Textarea, ToggleGroup, ToggleGroupItem };
