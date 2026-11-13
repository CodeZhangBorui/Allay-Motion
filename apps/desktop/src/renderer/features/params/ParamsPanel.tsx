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
import { Badge, ScrollArea } from '@allay/ui/components/misc';
import { ParamPanel } from '@allay/ui/editor';
import { ChevronDown, Ellipsis, FilePlus2 } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { PresetEntry } from '../../../shared/templates';
import { notify } from '../../stores/noticeStore';
import { setParam, useProjectStore } from '../../stores/projectStore';
import { useTemplateStore } from '../../stores/templateStore';
import { useUiStore } from '../../stores/uiStore';
import { applyPresetEntry } from '../templates/presets';
import { SavePresetDialog, SaveTemplateDialog } from './dialogs';

// 右栏：属性（6.4）。头部：模板名、分类徽标、预设下拉、更多菜单（保存为预设、另存为模板、重置全部参数、导入/导出预设）。
// 主体：按 groups 分组的可折叠区块（ParamPanel，由参数定义自动生成），折叠状态按模板记忆。底部：“另存为模板”（4.7）。

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

export function ParamsPanel() {
  const { t, i18n } = useTranslation();
  const template = useProjectStore((s) => s.template);
  const params = useProjectStore((s) => s.params);
  const fileNames = useProjectStore((s) => s.fileNames);
  const groupState = useUiStore((s) => (template ? s.settings.editor.groups[template.ref.id] : undefined));
  const dialog = useUiStore((s) => s.dialog);
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

  if (!template) {
    return (
      <aside aria-label={t('params.title')} className="flex h-full min-w-0 flex-col bg-surface-1" data-testid="params-panel">
        <div className="flex h-10 items-center border-b-2 px-3 font-px12">{t('params.title')}</div>
        <p className="p-3 text-xs text-fg-muted">{t('params.placeholder')}</p>
      </aside>
    );
  }
  const entry = entries.find((e) => e.id === template.ref.id && e.version === template.ref.version);
  const name = localize(template.manifest.name, locale);
  const changedCount = Object.keys(diffFromDefaults(template.params, params, { locale })).length;

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

  return (
    <aside aria-label={t('params.title')} className="flex h-full min-w-0 flex-col bg-surface-1" data-testid="params-panel">
      <header className="flex h-10 shrink-0 items-center gap-2 border-b-2 pr-1.5 pl-3">
        <h2 className="max-w-[65%] min-w-0 shrink-0 truncate font-px12 text-foreground" title={name} data-testid="params-template-name">
          {name}
        </h2>
        <Badge className="min-w-0 shrink truncate">
          <span className="truncate">{t(`gallery.categories.${template.manifest.category}`)}</span>
        </Badge>
        {entry?.source === 'user' && <Badge variant="amethyst">{t('gallery.user')}</Badge>}
        <div className="flex-1" />
        <DropdownMenu>
          <DropdownMenuTrigger render={<Button variant="ghost" size="sm" className="text-fg-muted" data-testid="preset-menu" />}>
            {t('params.presets.title')}
            <ChevronDown className="size-(--icon-sm)" />
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
        <DropdownMenu>
          <DropdownMenuTrigger render={<Button variant="ghost" size="icon" aria-label={t('params.more')} data-testid="params-more" />}>
            <Ellipsis />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            <DropdownMenuItem onClick={() => useUiStore.getState().openDialog('savePreset')}>{t('params.presets.save')}</DropdownMenuItem>
            <DropdownMenuItem onClick={() => useUiStore.getState().openDialog('saveTemplate')}>{t('params.saveAsTemplate')}</DropdownMenuItem>
            <DropdownMenuItem disabled={changedCount === 0} data-testid="params-reset-all" onClick={() => useProjectStore.getState().setParams(defaults, locale)}>
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
      </header>
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
      <footer className="shrink-0 border-t-2 p-2">
        <Button variant="ghost" className="w-full justify-start text-fg-muted" data-testid="save-as-template" onClick={() => useUiStore.getState().openDialog('saveTemplate')}>
          <FilePlus2 />
          {t('params.saveAsTemplate')}
        </Button>
      </footer>
      {dialog === 'savePreset' && <SavePresetDialog onSaved={refreshPresets} />}
      {dialog === 'saveTemplate' && <SaveTemplateDialog />}
    </aside>
  );
}
