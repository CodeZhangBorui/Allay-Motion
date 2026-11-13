import { Select as SelectPrimitive } from '@base-ui/react/select';
import { CaretUpDown, Check } from '@phosphor-icons/react';
import { cn } from 'cn';
import { ICON } from '../../lib/icons';
import { menuItemClass, menuPopupClass } from './dropdown-menu';

// shadcn 的 Select（Base UI）。触发器：控件色的圆角块，高 26（6.2），右端是上下小箭头。

const Select = SelectPrimitive.Root;
const SelectValue = SelectPrimitive.Value;

export const fieldClass =
  'h-control rounded-md bg-control px-2.5 text-sm text-foreground outline-none transition-colors duration-(--dur-1) hover:bg-control-hi focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--ring) disabled:opacity-45';

function SelectTrigger({ className, children, ...props }: SelectPrimitive.Trigger.Props) {
  return (
    <SelectPrimitive.Trigger className={cn(fieldClass, 'inline-flex min-w-0 items-center justify-between gap-1.5 pr-2 text-left', className)} {...props}>
      {children}
      <SelectPrimitive.Icon className="inline-flex shrink-0 text-fg-subtle">
        <CaretUpDown size={ICON.xs} />
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
  return <SelectPrimitive.Separator className={cn('-mx-1 my-1 h-px bg-divider', className)} {...props} />;
}

export { Select, SelectContent, SelectItem, SelectSeparator, SelectTrigger, SelectValue };
