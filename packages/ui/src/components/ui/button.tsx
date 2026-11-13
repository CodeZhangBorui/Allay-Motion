import { Button as ButtonPrimitive } from "@base-ui/react/button"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "cn"

// 按钮（6.2 形状与厚度）：缺角 2 px 描边的凸块，文字用像素字；按下时斜面对调、下移 1 px。
// default 是主操作：青色实心块配深色墨字。ghost 平时是平的，悬停时浮出凸块，按下（aria-pressed）时是凹槽。

const buttonVariants = cva(
  "group/button inline-flex shrink-0 items-center justify-center font-px12 whitespace-nowrap transition-[background-color,color,translate] duration-(--dur-1) ease-(--ease-step) select-none disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default: "blk blk-primary hover:bg-primary-hover active:blk-down active:bg-primary-active",
        outline: "blk blk-raised text-foreground hover:bg-surface-3 active:blk-down aria-expanded:blk-down",
        secondary: "blk blk-raised text-foreground hover:bg-surface-3 active:blk-down aria-expanded:blk-down",
        ghost:
          "hover:blk hover:blk-raised hover:text-foreground active:blk-down aria-expanded:blk aria-expanded:blk-sunken aria-expanded:text-foreground aria-pressed:blk aria-pressed:blk-sunken",
        destructive: "blk blk-raised text-danger hover:bg-surface-3 active:blk-down",
        link: "text-primary-text underline underline-offset-4 decoration-2",
      },
      size: {
        // 控件高度：28 默认、24 紧凑、32 对话框底部按钮（6.2 尺寸）
        default: "h-7 gap-1.5 px-3 has-data-[icon=inline-end]:pr-2.5 has-data-[icon=inline-start]:pl-2.5",
        xs: "h-6 gap-1 px-2 [&_svg:not([class*='size-'])]:size-4",
        sm: "h-6 gap-1 px-2 [&_svg:not([class*='size-'])]:size-4",
        lg: "h-8 gap-1.5 px-3.5",
        icon: "size-7",
        "icon-xs": "size-6 [&_svg:not([class*='size-'])]:size-4",
        "icon-sm": "size-6",
        "icon-lg": "size-8",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

function Button({
  className,
  variant = "default",
  size = "default",
  ...props
}: ButtonPrimitive.Props & VariantProps<typeof buttonVariants>) {
  return (
    <ButtonPrimitive
      data-slot="button"
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  )
}

export { Button, buttonVariants }
