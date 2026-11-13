import { Switch as SwitchPrimitive } from '@base-ui/react/switch';
import { cn } from 'cn';

// shadcn 的 Switch（Base UI）。关：控件高亮色的槽；开：强调色。圆头小滑块。

function Switch({ className, ...props }: SwitchPrimitive.Root.Props) {
  return (
    <SwitchPrimitive.Root
      className={cn(
        'relative inline-flex h-4 w-7 shrink-0 cursor-pointer items-center rounded-full bg-control-hi transition-colors duration-(--dur-2) data-[checked]:bg-primary data-[disabled]:cursor-default data-[disabled]:opacity-45',
        // 点击目标不小于 24×24（6.9）：用伪元素扩大命中区
        'before:absolute before:-inset-x-0.5 before:-inset-y-1.5 before:content-[""]',
        className,
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb className="block size-3 translate-x-0.5 rounded-full bg-fg-muted transition-transform duration-(--dur-2) ease-(--ease-out) data-[checked]:translate-x-[13px] data-[checked]:bg-primary-foreground" />
    </SwitchPrimitive.Root>
  );
}

export { Switch };
