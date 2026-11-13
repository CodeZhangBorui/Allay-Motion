import { Select as SelectPrimitive } from '@base-ui/react/select';
import { cn } from 'cn';
import { Check, ChevronDown } from 'lucide-react';
import { menuItemClass, menuPopupClass } from './dropdown-menu';

// shadcn 的 Select（Base UI）。触发器高 28（6.2 控件高度），是凹槽；右端是一块方形的箭头凸块。

const Select = SelectPrimitive.Root;
const SelectValue = SelectPrimitive.Value;

export const fieldClass =
  'h-7 blk blk-sunken px-2 text-sm text-foreground outline-none hover:[--blk-c:var(--fg-muted)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--ring) disabled:opacity-50';

function SelectTrigger({ className, children, ...props }: SelectPrimitive.Trigger.Props) {
  return (
    <SelectPrimitive.Trigger className={cn(fieldClass, 'inline-flex min-w-0 items-center justify-between gap-1.5 pr-0.5 text-left', className)} {...props}>
      {children}
      <SelectPrimitive.Icon className="inline-flex size-6 shrink-0 items-center justify-center blk-raised text-fg-muted">
        <ChevronDown className="size-4" />
      </SelectPrimitive.Icon>
    </SelectPrimitive.Trigger>
  );
}

function SelectContent({ className, children, ...props }: SelectPrimitive.Popup.Props) {
  return (
    <SelectPrimitive.Portal>
      <SelectPrimitive.Positioner sideOffset={4} alignItemWithTrigger={false} className="z-50 outline-none">
        <SelectPrimitive.Popup className={cn(menuPopupClass, 'max-h-(--available-height) min-w-(--anchor-width) overflow-y-auto', className)} {...props}>
          <SelectPrimitive.List>{children}</SelectPrimitive.List>
        </SelectPrimitive.Popup>
      </SelectPrimitive.Positioner>
    </SelectPrimitive.Portal>
  );
}

function SelectItem({ className, children, ...props }: SelectPrimitive.Item.Props) {
  return (
    <SelectPrimitive.Item className={cn(menuItemClass, 'pr-7', className)} {...props}>
      <SelectPrimitive.ItemText className="flex min-w-0 items-center gap-2">{children}</SelectPrimitive.ItemText>
      <SelectPrimitive.ItemIndicator className="absolute right-2 inline-flex">
        <Check />
      </SelectPrimitive.ItemIndicator>
    </SelectPrimitive.Item>
  );
}

function SelectSeparator({ className, ...props }: SelectPrimitive.Separator.Props) {
  return <SelectPrimitive.Separator className={cn('-mx-1.5 my-1.5 h-0.5 bg-border', className)} {...props} />;
}

export { Select, SelectContent, SelectItem, SelectSeparator, SelectTrigger, SelectValue };
