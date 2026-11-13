import { defaultParams, diffFromDefaults, localize, sanitizeValue, type ParamDef, type ParamValue } from '@allay/template-sdk';
import { Button } from '@allay/ui/components/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@allay/ui/components/dropdown-menu';
import { ScrollArea } from '@allay/ui/components/misc';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@allay/ui/components/tabs';
import { ParamPanel } from '@allay/ui/editor';
import { ICON } from '@allay/ui/lib/icons';
import { ArrowCounterClockwise, CaretUpDown, DotsThree, FloppyDisk } from '@phosphor-icons/react';
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import type { PresetEntry } from '../../../shared/templates';
import { notify } from '../../stores/noticeStore';
import { setParam, useProjectStore } from '../../stores/projectStore';
import { useTemplateStore } from '../../stores/templateStore';
import { useTransportStore } from '../../stores/transportStore';
import { useUiStore, type RightTab } from '../../stores/uiStore';
import { OutputSettingsForm } from '../settings/OutputSettingsForm';
import { applyPresetEntry } from '../templates/presets';
import { SavePresetDialog, SaveTemplateDialog } from './dialogs';

// 右面板（6.4，跨主区和时间轴两行高）：标题行是标签页“属性 | 输出”，右侧是更多菜单
// （保存为预设、另存为模板、重置全部参数、导入/导出预设）。
// 属性页：模板名（15 px）和“类别 · 时长”，右侧预设下拉；主体是按 groups 分组的参数（ParamPanel，由参数定义自动生成），
// 折叠状态按模板记忆；底部一行“另存为模板 / 全部重置”。输出页：分辨率、帧率等输出设置。
// 标签页机制可以再加一个标签页（RightTab 多一个值），不用改布局。

/** 应用内的“剪贴板”：复制值、粘贴值只在参数之间用，不经系统剪贴板（权限请求一律被拒，1.6 第 4 条） */
let clipboard: { type: ParamDef['type']; value: ParamValue } | null = null;

export function usePresets(templateId: string | undefined): [PresetEntry[], () => void] {
  const [presets, setPresets] = useState<PresetEntry[]>([]);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let alive = true;
    void window.allay.presets.list().then((all) => alive && setPresets(all.filter((p) => p.template.id === templateId)));
    return () => {
      alive = false;
    };
  }, [templateId, tick]);
  return [presets, () => setTick((n) => n + 1)];
}

function PanelHead({ children }: { children: ReactNode }) {
  return <div className="flex h-panel-head shrink-0 items-center gap-4 pr-2 pl-3.5">{children}</div>;
}

export function ParamsPanel() {
  const { t, i18n } = useTranslation();
  const template = useProjectStore((s) => s.template);
  const params = useProjectStore((s) => s.params);
  const fileNames = useProjectStore((s) => s.fileNames);
  const duration = useTransportStore((s) => s.duration);
  const groupState = useUiStore((s) => (template ? s.settings.editor.groups[template.ref.id] : undefined));
  const dialog = useUiStore((s) => s.dialog);
  const rightTab = useUiStore((s) => s.rightTab);
  const entries = useTemplateStore((s) => s.entries);
  const [presets, refreshPresets] = usePresets(template?.ref.id);
  const locale = i18n.language;

  const defaults = useMemo(() => (template ? defaultParams(template.params, { locale }) : {}), [template, locale]);
  const onChange = useCallback((key: string, value: ParamValue) => setParam(key, value, locale), [locale]);
  const clip = useMemo(
    () => ({
      copy: (def: ParamDef, value: ParamValue) => {
        clipboard = { type: def.type, value: structuredClone(value) };
      },
      paste: (def: ParamDef) => (clipboard && clipboard.type === def.type ? sanitizeValue(def, clipboard.value, { locale }) : undefined),
    }),
    [locale],
  );

  const tabs = (
    <TabsList className="gap-4" aria-label={t('params.title')}>
      <TabsTrigger variant="text" value="props" data-testid="right-tab-props">
        {t('params.tabs.props')}
      </TabsTrigger>
      <TabsTrigger variant="text" value="output" data-testid="right-tab-output">
        {t('params.tabs.output')}
      </TabsTrigger>
    </TabsList>
  );

  const exportPreset = async (p: PresetEntry) => {
    const r = await window.allay.presets.exportFile(p.id);
    if (!r.canceled) notify('info', t('params.presets.exported'));
  };
  const importPreset = async () => {
    const r = await window.allay.presets.importFile();
    if (r.canceled) return;
    if (!r.ok) notify('error', t('params.presets.importFailed'));
    else {
      notify('info', t('params.presets.imported', { name: r.entry.name }));
      refreshPresets();
    }
  };

  const entry = template ? entries.find((e) => e.id === template.ref.id && e.version === template.ref.version) : undefined;
  const name = template ? localize(template.manifest.name, locale) : '';
  const changedCount = template ? Object.keys(diffFromDefaults(template.params, params, { locale })).length : 0;
  const resetAll = () => useProjectStore.getState().setParams(defaults, locale);

  return (
    <aside aria-label={t('params.title')} className="flex h-full min-w-0 flex-col overflow-hidden rounded-xl bg-surface-1" data-testid="params-panel">
      <Tabs value={rightTab} onValueChange={(v) => useUiStore.getState().setRightTab(v as RightTab)} className="flex min-h-0 flex-1 flex-col">
        <PanelHead>
          {tabs}
          <span className="flex-1" />
          {template && (
            <DropdownMenu>
              <DropdownMenuTrigger render={<Button variant="ghost" size="icon-sm" className="text-fg-subtle" aria-label={t('params.more')} data-testid="params-more" />}>
                <DotsThree size={ICON.md} weight="bold" />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                <DropdownMenuItem onClick={() => useUiStore.getState().openDialog('savePreset')}>{t('params.presets.save')}</DropdownMenuItem>
                <DropdownMenuItem onClick={() => useUiStore.getState().openDialog('saveTemplate')}>{t('params.saveAsTemplate')}</DropdownMenuItem>
                <DropdownMenuItem disabled={changedCount === 0} onClick={resetAll}>
                  {t('params.resetAll')}
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => void importPreset()}>{t('params.presets.import')}</DropdownMenuItem>
                <DropdownMenuSub>
                  <DropdownMenuSubTrigger disabled={presets.length === 0}>{t('params.presets.export')}</DropdownMenuSubTrigger>
                  <DropdownMenuSubContent>
                    {presets.map((p) => (
                      <DropdownMenuItem key={p.id} onClick={() => void exportPreset(p)}>
                        <span className="truncate">{p.name}</span>
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuSubContent>
                </DropdownMenuSub>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </PanelHead>

        <TabsContent value="props" className="flex min-h-0 flex-1 flex-col">
          {!template ? (
            <p className="px-3.5 py-3 text-xs text-fg-subtle">{t('params.placeholder')}</p>
          ) : (
            <>
              <div className="flex shrink-0 items-center gap-2.5 px-3.5 pt-0.5 pb-3">
                <div className="min-w-0 flex-1">
                  <h2 className="truncate text-lg font-semibold" title={name} data-testid="params-template-name">
                    {name}
                  </h2>
                  <p className="truncate text-xs text-fg-subtle" data-testid="params-template-meta">
                    {duration > 0
                      ? t('params.meta', { category: t(`gallery.categories.${template.manifest.category}`), duration: duration.toFixed(2) })
                      : t(`gallery.categories.${template.manifest.category}`)}
                    {entry?.source === 'user' && <span className="text-amethyst"> · {t('gallery.user')}</span>}
                  </p>
                </div>
                <DropdownMenu>
                  <DropdownMenuTrigger
                    render={<Button variant="secondary" className="w-[118px] shrink-0 justify-between pr-2 pl-2.5 font-normal" data-testid="preset-menu" />}
                  >
                    <span className="truncate">{t('params.presets.title')}</span>
                    <CaretUpDown size={ICON.xs} className="text-fg-subtle" />
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-56">
                    {presets.length === 0 ? (
                      <DropdownMenuLabel>{t('params.presets.none')}</DropdownMenuLabel>
                    ) : (
                      presets.map((p) => (
                        <DropdownMenuItem
                          key={p.id}
                          data-testid={`preset-${p.name}`}
                          onClick={() =>
                            void applyPresetEntry(p, locale).then((ok) => {
                              if (!ok) notify('error', t('params.presets.applyFailed'));
                            })
                          }
                        >
                          <span className="truncate">{p.name}</span>
                        </DropdownMenuItem>
                      ))
                    )}
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onClick={() => useUiStore.getState().openDialog('savePreset')} data-testid="preset-save">
                      {t('params.presets.save')}
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
              <ScrollArea className="min-h-0 flex-1">
                <ParamPanel
                  defs={template.params}
                  groups={template.manifest.groups ?? []}
                  hidden={template.hidden}
                  values={params}
                  defaults={defaults}
                  onChange={onChange}
                  collapsed={groupState ?? {}}
                  onToggleGroup={(g, c) => useUiStore.getState().setGroupCollapsed(template.ref.id, g, c)}
                  fileNames={fileNames}
                  clipboard={clip}
                />
              </ScrollArea>
              <footer className="flex h-panel-head shrink-0 items-center gap-2 border-t border-divider px-2">
                <Button variant="ghost" className="min-w-0 gap-2 px-2" data-testid="save-as-template" onClick={() => useUiStore.getState().openDialog('saveTemplate')}>
                  <FloppyDisk size={ICON.md} />
                  <span className="truncate">{t('params.saveAsTemplate')}</span>
                </Button>
                <span className="flex-1" />
                <Button variant="ghost" className="min-w-0 gap-2 px-2" disabled={changedCount === 0} title={t('params.resetAll')} data-testid="params-reset-all" onClick={resetAll}>
                  <ArrowCounterClockwise size={ICON.md} />
                  <span className="truncate">{t('params.resetAllShort')}</span>
                </Button>
              </footer>
            </>
          )}
        </TabsContent>
        <TabsContent value="output" className="px-3.5 pt-1 pb-3">
          <OutputSettingsForm />
        </TabsContent>
      </Tabs>
      {dialog === 'savePreset' && <SavePresetDialog onSaved={refreshPresets} />}
      {dialog === 'saveTemplate' && <SaveTemplateDialog />}
    </aside>
  );
}
