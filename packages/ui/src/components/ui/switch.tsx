import { Switch as SwitchPrimitive } from '@base-ui/react/switch';
import { cn } from 'cn';

// shadcn 的 Switch（Base UI）。开：主蓝；关：surface-3 加 --input-border 边框（非文字元素的对比度 ≥ 3）。

function Switch({ className, ...props }: SwitchPrimitive.Root.Props) {
  return (
    <SwitchPrimitive.Root
      className={cn(
        'relative inline-flex h-4 w-7 shrink-0 cursor-pointer items-center rounded-full border border-input-border bg-surface-3 transition-colors duration-(--dur-2) data-[checked]:border-primary data-[checked]:bg-primary data-[disabled]:cursor-default data-[disabled]:opacity-50',
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
