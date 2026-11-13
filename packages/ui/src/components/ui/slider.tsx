import { Slider as SliderPrimitive } from '@base-ui/react/slider';
import { cn } from 'cn';

// shadcn 的 Slider（Base UI），单值。轨道是控件高亮色的细条，已填充部分是强调色，圆形手柄。
// 属性面板里的数值不用它（数值框本身就是滑块，见 editor/ScrubNumberField），这里给其他地方用。

function Slider({ className, thumbLabel, ...props }: SliderPrimitive.Root.Props<number> & { thumbLabel?: string }) {
  return (
    <SliderPrimitive.Root className={cn('relative flex w-full touch-none items-center select-none', className)} {...props}>
      <SliderPrimitive.Control className="flex h-6 w-full cursor-pointer items-center">
        <SliderPrimitive.Track className="relative h-1 w-full rounded-full bg-control-hi">
          <SliderPrimitive.Indicator className="rounded-full bg-primary" />
          <SliderPrimitive.Thumb
            aria-label={thumbLabel}
            className="block size-3 rounded-full bg-foreground outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--ring)"
          />
        </SliderPrimitive.Track>
      </SliderPrimitive.Control>
    </SliderPrimitive.Root>
  );
}

export { Slider };
