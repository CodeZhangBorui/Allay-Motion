import { Slider as SliderPrimitive } from '@base-ui/react/slider';
import { cn } from 'cn';

// shadcn 的 Slider（Base UI），单值。轨道 4 px，滑块 12 px；命中区 24 px 高。

function Slider({ className, thumbLabel, ...props }: SliderPrimitive.Root.Props<number> & { thumbLabel?: string }) {
  return (
    <SliderPrimitive.Root className={cn('relative flex w-full touch-none items-center select-none', className)} {...props}>
      <SliderPrimitive.Control className="flex h-6 w-full cursor-pointer items-center">
        <SliderPrimitive.Track className="relative h-1 w-full rounded-full bg-surface-3 shadow-[inset_0_0_0_1px_var(--border-strong)]">
          <SliderPrimitive.Indicator className="rounded-full bg-primary" />
          <SliderPrimitive.Thumb
            aria-label={thumbLabel}
            className="block size-3 rounded-full border-2 border-primary bg-surface-1 shadow-sm outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--ring)"
          />
        </SliderPrimitive.Track>
      </SliderPrimitive.Control>
    </SliderPrimitive.Root>
  );
}

export { Slider };
