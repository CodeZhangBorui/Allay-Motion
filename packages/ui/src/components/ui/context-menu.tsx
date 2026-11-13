import { ContextMenu as ContextMenuPrimitive } from '@base-ui/react/context-menu';
import { cn } from 'cn';
import { menuItemClass, menuPopupClass } from './dropdown-menu';

// shadcn 的 ContextMenu（Base UI）。外观与 DropdownMenu 相同。

const ContextMenu = ContextMenuPrimitive.Root;
const ContextMenuTrigger = ContextMenuPrimitive.Trigger;

function ContextMenuContent({ className, ...props }: ContextMenuPrimitive.Popup.Props) {
  return (
    <ContextMenuPrimitive.Portal>
      <ContextMenuPrimitive.Positioner className="z-50 outline-none">
        <ContextMenuPrimitive.Popup data-slot="context-menu-content" className={cn(menuPopupClass, className)} {...props} />
      </ContextMenuPrimitive.Positioner>
    </ContextMenuPrimitive.Portal>
  );
}

function ContextMenuItem({ className, ...props }: ContextMenuPrimitive.Item.Props) {
  return <ContextMenuPrimitive.Item className={cn(menuItemClass, className)} {...props} />;
}

function ContextMenuSeparator({ className, ...props }: ContextMenuPrimitive.Separator.Props) {
  return <ContextMenuPrimitive.Separator className={cn('-mx-1 my-1 h-px bg-divider', className)} {...props} />;
}

export { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuSeparator, ContextMenuTrigger };
