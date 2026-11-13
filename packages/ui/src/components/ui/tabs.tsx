import { Tabs as TabsPrimitive } from '@base-ui/react/tabs';
import { cn } from 'cn';

// shadcn 的 Tabs（Base UI）。两种样式：
// - variant="text"：面板标题行的标签页（12.5 半粗的文字，选中项是正文色，其余是次要色），可以随时多加一个标签页；
// - variant="quiet"：安静的文字切换（分类），选中项有控件底色。
// 设置对话框里竖排的那组也用 quiet。

const Tabs = TabsPrimitive.Root;

type Variant = 'text' | 'quiet';

function TabsList({ className, ...props }: TabsPrimitive.List.Props) {
  return <TabsPrimitive.List className={cn('relative flex items-center', className)} {...props} />;
}

function TabsTrigger({ className, variant = 'quiet', ...props }: TabsPrimitive.Tab.Props & { variant?: Variant }) {
  return (
    <TabsPrimitive.Tab
      className={cn(
        'inline-flex items-center gap-1.5 whitespace-nowrap transition-colors duration-(--dur-1) select-none',
        variant === 'text' && 'h-7 rounded-md text-base font-semibold text-fg-subtle hover:text-fg-muted data-[active]:text-foreground',
        variant === 'quiet' && 'h-control rounded-md px-2.5 text-sm text-fg-muted hover:text-foreground data-[active]:bg-control data-[active]:text-foreground',
        className,
      )}
      {...props}
    />
  );
}

function TabsContent({ className, ...props }: TabsPrimitive.Panel.Props) {
  return <TabsPrimitive.Panel className={cn('outline-none', className)} {...props} />;
}

export { Tabs, TabsContent, TabsList, TabsTrigger };
