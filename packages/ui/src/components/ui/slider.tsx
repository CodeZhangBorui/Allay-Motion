import { Slider as SliderPrimitive } from '@base-ui/react/slider';
import { cn } from 'cn';

// shadcn 的 Slider（Base UI），单值。轨道是 8 px 高的凹槽，已填充的部分平涂青色；手柄是方的凸块。命中区 24 px 高。

function Slider({ className, thumbLabel, ...props }: SliderPrimitive.Root.Props<number> & { thumbLabel?: string }) {
  return (
    <SliderPrimitive.Root className={cn('relative flex w-full touch-none items-center select-none', className)} {...props}>
      <SliderPrimitive.Control className="flex h-6 w-full cursor-pointer items-center px-1.5">
        <SliderPrimitive.Track className="relative h-2 w-full blk blk-sunken">
          <SliderPrimitive.Indicator className="bg-primary" />
          <SliderPrimitive.Thumb
            aria-label={thumbLabel}
            className="block h-4 w-3 blk blk-raised outline-none active:blk-down focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--ring)"
          />
        </SliderPrimitive.Track>
      </SliderPrimitive.Control>
    </SliderPrimitive.Root>
  );
}

export { Slider };
