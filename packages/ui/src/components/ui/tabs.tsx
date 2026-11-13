import { Tabs as TabsPrimitive } from '@base-ui/react/tabs';
import { cn } from 'cn';

// shadcn 的 Tabs（Base UI）。一排相连的方块按钮（像素字），选中的那块是“按下去”的凹槽、字是悦灵青。

const Tabs = TabsPrimitive.Root;

function TabsList({ className, ...props }: TabsPrimitive.List.Props) {
  return <TabsPrimitive.List className={cn('relative inline-flex h-7 items-stretch gap-0.5 p-0.5', className)} {...props} />;
}

function TabsTrigger({ className, ...props }: TabsPrimitive.Tab.Props) {
  return (
    <TabsPrimitive.Tab
      className={cn(
        'inline-flex min-w-6 flex-1 items-center justify-center gap-1 blk blk-raised px-2 font-px12 whitespace-nowrap text-fg-muted transition-colors duration-(--dur-1) ease-(--ease-step) select-none hover:bg-surface-3 hover:text-foreground data-[active]:blk-sunken data-[active]:text-primary-text',
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
