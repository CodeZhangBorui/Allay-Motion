import { Tabs as TabsPrimitive } from '@base-ui/react/tabs';
import { cn } from 'cn';

// shadcn 的 Tabs（Base UI）。紧凑的分段样式：选中项是 surface-3 底。

const Tabs = TabsPrimitive.Root;

function TabsList({ className, ...props }: TabsPrimitive.List.Props) {
  return <TabsPrimitive.List className={cn('relative inline-flex h-7 items-center gap-0.5 rounded-md bg-surface-2 p-0.5', className)} {...props} />;
}

function TabsTrigger({ className, ...props }: TabsPrimitive.Tab.Props) {
  return (
    <TabsPrimitive.Tab
      className={cn(
        'inline-flex h-6 min-w-6 flex-1 items-center justify-center gap-1 rounded-[5px] px-2 text-xs font-medium whitespace-nowrap text-fg-muted transition-colors duration-(--dur-1) select-none hover:text-foreground data-[selected]:bg-surface-1 data-[selected]:text-foreground data-[selected]:shadow-sm',
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
