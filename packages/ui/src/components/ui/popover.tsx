import { Popover as PopoverPrimitive } from '@base-ui/react/popover';
import { cn } from 'cn';

// shadcn 的 Popover（Base UI）：surface-2、圆角 8、弹层阴影加 1 px 边框（6.2），--dur-2 淡入。

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
            'z-50 max-h-(--available-height) w-72 origin-(--transform-origin) overflow-y-auto rounded-lg border bg-surface-2 p-3 text-sm shadow-(--shadow-popover) outline-none',
            'transition-[opacity,scale] duration-(--dur-2) data-[ending-style]:scale-95 data-[ending-style]:opacity-0 data-[starting-style]:scale-95 data-[starting-style]:opacity-0',
            className,
          )}
          {...props}
        />
      </PopoverPrimitive.Positioner>
    </PopoverPrimitive.Portal>
  );
}

export { Popover, PopoverClose, PopoverContent, PopoverTitle, PopoverTrigger };
