import { Tabs, TabsContent, TabsList, TabsTrigger } from '@allay/ui/components/tabs';
import { useTranslation } from 'react-i18next';
import { useProjectStore } from '../stores/projectStore';
import { useUiStore } from '../stores/uiStore';
import { ErrorBoundary } from './ErrorBoundary';
import { usePanels } from './registry';
import { fadeClass, useWorkspaceMode } from './workspaceMode';

// 左右面板（6.4）：标题行是注册表里这一侧的标签页（12.5 半粗），右侧是当前标签页的操作；下面是当前标签页的内容。
// 面板本身不知道有哪些标签页：核心功能和可选模块都经注册表（registry.ts）挂上来。
// 每个标签页和它的操作各包一层错误边界：一个标签页出错只换掉它自己（ErrorBoundary.tsx）。

export function TabbedPanel({ region, label, testId }: { region: 'left' | 'right'; label: string; testId: string }) {
  const { t } = useTranslation();
  // 只显示属于当前工作区模式的标签页；模式切换时整块淡出、换内容、再淡入（workspaceMode.ts）
  const mode = useWorkspaceMode((s) => s.shown);
  const phase = useWorkspaceMode((s) => s.phase);
  const fade = fadeClass(phase, region === 'left' ? 0 : 1);
  const panels = usePanels(region).filter((p) => !p.modes || p.modes.includes(mode));
  const stored = useUiStore((s) => (region === 'left' ? s.leftTab : s.rightTab));
  const active = panels.some((p) => p.id === stored) ? stored : (panels[0]?.id ?? '');
  const setActive = (id: string) => useUiStore.setState(region === 'left' ? { leftTab: id } : { rightTab: id });
  const current = panels.find((p) => p.id === active);
  const Actions = current?.actions;
  // 换了模板就让出错的标签页自动重试一次
  const templateKey = useProjectStore((s) => (s.template ? `${s.template.ref.id}@${s.template.ref.version}` : ''));
  return (
    <aside aria-label={label} className="flex h-full min-w-0 flex-col overflow-hidden rounded-xl bg-surface-1" data-testid={testId} data-mode={mode}>
      <Tabs style={fade.style} value={active} onValueChange={(v) => setActive(String(v))} className={`flex min-h-0 flex-1 flex-col ${fade.className}`}>
        <div className="flex h-panel-head shrink-0 items-center gap-4 pr-2 pl-3.5">
          <TabsList className="gap-4" aria-label={label}>
            {panels.map((p) => (
              <TabsTrigger key={p.id} variant="text" value={p.id} data-testid={p.testId ?? `${region}-tab-${p.id}`}>
                {t(p.titleKey)}
              </TabsTrigger>
            ))}
          </TabsList>
          <span className="flex-1" />
          {Actions && (
            <ErrorBoundary scope={`${region}.${active}.actions`} resetKey={templateKey}>
              <Actions />
            </ErrorBoundary>
          )}
        </div>
        {panels.map((p) => (
          <TabsContent key={p.id} value={p.id} className="flex min-h-0 flex-1 flex-col">
            <ErrorBoundary scope={`${region}.${p.id}`} resetKey={templateKey}>
              <p.component />
            </ErrorBoundary>
          </TabsContent>
        ))}
      </Tabs>
    </aside>
  );
}
