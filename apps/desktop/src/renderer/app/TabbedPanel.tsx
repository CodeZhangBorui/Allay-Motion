import { Tabs, TabsContent, TabsList, TabsTrigger } from '@allay/ui/components/tabs';
import { useTranslation } from 'react-i18next';
import { useUiStore } from '../stores/uiStore';
import { usePanels } from './registry';

// 左右面板（6.4）：标题行是注册表里这一侧的标签页（12.5 半粗），右侧是当前标签页的操作；下面是当前标签页的内容。
// 面板本身不知道有哪些标签页：核心功能和可选模块都经注册表（registry.ts）挂上来。

export function TabbedPanel({ region, label, testId }: { region: 'left' | 'right'; label: string; testId: string }) {
  const { t } = useTranslation();
  const panels = usePanels(region);
  const stored = useUiStore((s) => (region === 'left' ? s.leftTab : s.rightTab));
  const active = panels.some((p) => p.id === stored) ? stored : (panels[0]?.id ?? '');
  const setActive = (id: string) => useUiStore.setState(region === 'left' ? { leftTab: id } : { rightTab: id });
  const current = panels.find((p) => p.id === active);
  const Actions = current?.actions;
  return (
    <aside aria-label={label} className="flex h-full min-w-0 flex-col overflow-hidden rounded-xl bg-surface-1" data-testid={testId}>
      <Tabs value={active} onValueChange={(v) => setActive(String(v))} className="flex min-h-0 flex-1 flex-col">
        <div className="flex h-panel-head shrink-0 items-center gap-4 pr-2 pl-3.5">
          <TabsList className="gap-4" aria-label={label}>
            {panels.map((p) => (
              <TabsTrigger key={p.id} variant="text" value={p.id} data-testid={p.testId ?? `${region}-tab-${p.id}`}>
                {t(p.titleKey)}
              </TabsTrigger>
            ))}
          </TabsList>
          <span className="flex-1" />
          {Actions && <Actions />}
        </div>
        {panels.map((p) => (
          <TabsContent key={p.id} value={p.id} className="flex min-h-0 flex-1 flex-col">
            <p.component />
          </TabsContent>
        ))}
      </Tabs>
    </aside>
  );
}
