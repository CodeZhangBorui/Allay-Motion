import { Command as CommandPrimitive } from 'cmdk';
import { MagnifyingGlass } from '@phosphor-icons/react';
import { cn } from 'cn';
import { ICON } from '../../lib/icons';
import type { ComponentProps } from 'react';

// shadcn 的 Command（cmdk）：命令面板（6.4，Ctrl+K）放在 Dialog 里用。

function Command({ className, ...props }: ComponentProps<typeof CommandPrimitive>) {
  return <CommandPrimitive className={cn('flex h-full w-full flex-col overflow-hidden text-sm', className)} {...props} />;
}

function CommandInput({ className, ...props }: ComponentProps<typeof CommandPrimitive.Input>) {
  return (
    <div className="m-2 flex h-9 shrink-0 items-center gap-2 rounded-md bg-control px-2.5">
      <MagnifyingGlass size={ICON.md} className="shrink-0 text-fg-subtle" aria-hidden="true" />
      <CommandPrimitive.Input className={cn('h-full w-full bg-transparent outline-none select-text placeholder:text-fg-subtle', className)} {...props} />
    </div>
  );
}

function CommandList({ className, ...props }: ComponentProps<typeof CommandPrimitive.List>) {
  return <CommandPrimitive.List className={cn('max-h-[360px] overflow-x-hidden overflow-y-auto px-1.5 pb-1.5', className)} {...props} />;
}

function CommandEmpty(props: ComponentProps<typeof CommandPrimitive.Empty>) {
  return <CommandPrimitive.Empty className="px-3 py-6 text-center text-sm text-fg-muted" {...props} />;
}

function CommandGroup({ className, ...props }: ComponentProps<typeof CommandPrimitive.Group>) {
  return <CommandPrimitive.Group className={cn('[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:pt-2 [&_[cmdk-group-heading]]:pb-1 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:text-fg-subtle', className)} {...props} />;
}

function CommandItem({ className, ...props }: ComponentProps<typeof CommandPrimitive.Item>) {
  return (
    <CommandPrimitive.Item
      className={cn(
        'relative flex h-8 cursor-default items-center gap-2 rounded-md px-2 outline-none select-none data-[disabled=true]:pointer-events-none data-[disabled=true]:opacity-45 data-[selected=true]:bg-control [&_svg]:size-3.5 [&_svg]:shrink-0 [&_svg]:text-fg-subtle',
        className,
      )}
      {...props}
    />
  );
}

export { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList };
