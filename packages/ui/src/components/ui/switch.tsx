import { Switch as SwitchPrimitive } from '@base-ui/react/switch';
import { cn } from 'cn';

// shadcn 的 Switch（Base UI）。一条凹槽里放一个方的凸块：关着时凸块在左、槽是暗的；开着时凸块在右、槽平涂青色。
// 描边用 --input-border（非文字元素的对比度 ≥ 3）。

function Switch({ className, ...props }: SwitchPrimitive.Root.Props) {
  return (
    <SwitchPrimitive.Root
      className={cn(
        'relative inline-flex h-4 w-7 shrink-0 cursor-pointer items-center blk blk-sunken transition-colors duration-(--dur-2) ease-(--ease-step) data-[checked]:bg-primary data-[disabled]:cursor-default data-[disabled]:opacity-50',
        // 点击目标不小于 24×24（6.9）：用伪元素扩大命中区
        'before:absolute before:-inset-x-0.5 before:-inset-y-1.5 before:content-[""]',
        className,
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb className="block h-4 w-3 blk-raised transition-transform duration-(--dur-2) ease-(--ease-step) data-[checked]:translate-x-4" />
    </SwitchPrimitive.Root>
  );
}

export { Switch };
