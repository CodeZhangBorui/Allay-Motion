import { Menu as MenuPrimitive } from '@base-ui/react/menu';
import { CaretRight, Check } from '@phosphor-icons/react';
import { cn } from 'cn';
import type { ComponentProps } from 'react';

// shadcn 的 DropdownMenu（Base UI Menu）。弹层：浮起的面板（圆角、弹层阴影、无描边，6.2）；高亮项是控件色的圆角块。

export const menuPopupClass =
  'z-50 min-w-44 float p-1 text-sm outline-none transition-opacity duration-(--dur-2) data-[ending-style]:opacity-0 data-[starting-style]:opacity-0';
export const menuItemClass =
  'relative flex h-7 cursor-default items-center gap-2 rounded-md px-2 outline-none select-none data-[disabled]:pointer-events-none data-[disabled]:opacity-45 data-[highlighted]:bg-control [&_svg]:size-3.5 [&_svg]:shrink-0 [&_svg]:text-fg-subtle';

const DropdownMenu = MenuPrimitive.Root;
const DropdownMenuTrigger = MenuPrimitive.Trigger;
const DropdownMenuGroup = MenuPrimitive.Group;
const DropdownMenuRadioGroup = MenuPrimitive.RadioGroup;
const DropdownMenuSub = MenuPrimitive.SubmenuRoot;

function DropdownMenuContent({
  className,
  side = 'bottom',
  align = 'start',
  sideOffset = 4,
  ...props
}: MenuPrimitive.Popup.Props & Pick<MenuPrimitive.Positioner.Props, 'side' | 'align' | 'sideOffset'>) {
  return (
    <MenuPrimitive.Portal>
      <MenuPrimitive.Positioner side={side} align={align} sideOffset={sideOffset} className="z-50 outline-none">
        <MenuPrimitive.Popup data-slot="dropdown-menu-content" className={cn(menuPopupClass, 'max-h-(--available-height) overflow-y-auto', className)} {...props} />
      </MenuPrimitive.Positioner>
    </MenuPrimitive.Portal>
  );
}

function DropdownMenuItem({ className, variant, ...props }: MenuPrimitive.Item.Props & { variant?: 'default' | 'destructive' }) {
  return <MenuPrimitive.Item className={cn(menuItemClass, variant === 'destructive' && 'text-danger [&_svg]:text-danger', className)} {...props} />;
}

function DropdownMenuCheckboxItem({ className, children, ...props }: MenuPrimitive.CheckboxItem.Props) {
  return (
    <MenuPrimitive.CheckboxItem className={cn(menuItemClass, 'pl-7', className)} {...props}>
      <MenuPrimitive.CheckboxItemIndicator className="absolute left-2 inline-flex">
        <Check />
      </MenuPrimitive.CheckboxItemIndicator>
      {children}
    </MenuPrimitive.CheckboxItem>
  );
}

function DropdownMenuRadioItem({ className, children, ...props }: MenuPrimitive.RadioItem.Props) {
  return (
    <MenuPrimitive.RadioItem className={cn(menuItemClass, 'pl-7', className)} {...props}>
      <MenuPrimitive.RadioItemIndicator className="absolute left-2 inline-flex">
        <Check />
      </MenuPrimitive.RadioItemIndicator>
      {children}
    </MenuPrimitive.RadioItem>
  );
}

function DropdownMenuLabel({ className, ...props }: MenuPrimitive.GroupLabel.Props) {
  return <MenuPrimitive.GroupLabel className={cn('px-2 py-1 text-xs text-fg-subtle', className)} {...props} />;
}

function DropdownMenuSeparator({ className, ...props }: MenuPrimitive.Separator.Props) {
  return <MenuPrimitive.Separator className={cn('-mx-1 my-1 h-px bg-divider', className)} {...props} />;
}

function DropdownMenuShortcut({ className, ...props }: ComponentProps<'span'>) {
  return <span className={cn('ml-auto pl-4 num text-xs text-fg-subtle', className)} {...props} />;
}

function DropdownMenuSubTrigger({ className, children, ...props }: MenuPrimitive.SubmenuTrigger.Props) {
  return (
    <MenuPrimitive.SubmenuTrigger className={cn(menuItemClass, 'data-[popup-open]:bg-control', className)} {...props}>
      {children}
      <CaretRight className="ml-auto" />
    </MenuPrimitive.SubmenuTrigger>
  );
}

function DropdownMenuSubContent({ className, ...props }: MenuPrimitive.Popup.Props) {
  return (
    <MenuPrimitive.Portal>
      <MenuPrimitive.Positioner side="right" align="start" sideOffset={2} className="z-50 outline-none">
        <MenuPrimitive.Popup className={cn(menuPopupClass, className)} {...props} />
      </MenuPrimitive.Positioner>
    </MenuPrimitive.Portal>
  );
}

export {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
};
