import { Button as ButtonPrimitive } from "@base-ui/react/button"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "cn"

// 按钮（6.2）：平的圆角块，无描边无阴影，悬停只变亮度。default 是唯一的实心强调色按钮（导出），其他都是控件色或透明。

const buttonVariants = cva(
  "group/button inline-flex shrink-0 items-center justify-center rounded-md text-sm font-medium whitespace-nowrap transition-colors duration-(--dur-1) select-none disabled:pointer-events-none disabled:opacity-45 [&_svg]:pointer-events-none [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground font-semibold hover:bg-primary-hover active:bg-primary-press",
        outline: "bg-control text-foreground hover:bg-control-hi aria-expanded:bg-control-hi",
        secondary: "bg-control text-foreground hover:bg-control-hi aria-expanded:bg-control-hi",
        ghost: "text-fg-muted hover:bg-control hover:text-foreground aria-expanded:bg-control aria-expanded:text-foreground aria-pressed:bg-control-hi aria-pressed:text-foreground",
        destructive: "bg-control text-danger hover:bg-control-hi",
        link: "text-primary-text underline-offset-4 hover:underline",
      },
      size: {
        // 控件高度 26（6.2 尺寸）；lg 30 用在顶栏和对话框底部
        default: "h-control gap-1.5 px-2.5",
        xs: "h-6 gap-1 rounded-sm px-2 text-xs",
        sm: "h-6 gap-1 px-2 text-xs",
        lg: "h-[30px] gap-1.5 rounded-lg px-3",
        icon: "size-[30px] rounded-lg",
        "icon-xs": "size-5 rounded-sm",
        "icon-sm": "size-control",
        "icon-lg": "size-8 rounded-lg",
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
