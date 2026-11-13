import { Popover as PopoverPrimitive } from '@base-ui/react/popover';
import { cn } from 'cn';

// shadcn 的 Popover（Base UI）：缺角 2 px 描边加 4 px 硬投影的浮层（6.2），--dur-2 的分级淡入。

const Popover = PopoverPrimitive.Root;
const PopoverTrigger = PopoverPrimitive.Trigger;
const PopoverClose = PopoverPrimitive.Close;
const PopoverTitle = PopoverPrimitive.Title;

function PopoverContent({
  className,
  side = 'bottom',
  align = 'center',
  sideOffset = 6,
  initialFocus,
  ...props
}: PopoverPrimitive.Popup.Props & Pick<PopoverPrimitive.Positioner.Props, 'side' | 'align' | 'sideOffset'>) {
  return (
    <PopoverPrimitive.Portal>
      <PopoverPrimitive.Positioner side={side} align={align} sideOffset={sideOffset} collisionPadding={8} className="z-50 outline-none">
        <PopoverPrimitive.Popup
          data-slot="popover-content"
          initialFocus={initialFocus}
          className={cn(
            'z-50 max-h-(--available-height) w-72 overflow-y-auto blk-float p-3 text-sm outline-none',
            'transition-opacity duration-(--dur-2) ease-(--ease-step) data-[ending-style]:opacity-0 data-[starting-style]:opacity-0',
            className,
          )}
          {...props}
        />
      </PopoverPrimitive.Positioner>
    </PopoverPrimitive.Portal>
  );
}

export { Popover, PopoverClose, PopoverContent, PopoverTitle, PopoverTrigger };
