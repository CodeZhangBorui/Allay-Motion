// 预设（docs/04-templates.md 4.7）的界面动作：保存当前参数、套用一个预设。
// 保存时只留与默认值不同的参数；套用时缺的补默认值、多的丢弃（template-sdk 的 createPreset / applyPreset）。
import { applyPreset, compareVersionStrings, createPreset } from '@allay/template-sdk';
import type { PresetEntry } from '../../../shared/templates';
import { useProjectStore } from '../../stores/projectStore';
import { useTemplateStore } from '../../stores/templateStore';
import { readTemplate } from '../../templates/catalog';
import { previewEngine } from '../preview/previewEngine';

/** 把当前模板的当前参数存成预设 */
export async function saveCurrentPreset(name: string, locale: string): Promise<PresetEntry | null> {
  const { template, params } = useProjectStore.getState();
  if (!template) return null;
  const preset = createPreset(template.ref, name, template.params, params, new Date(), { locale });
  return window.allay.presets.save({ template: preset.template, name: preset.name, params: preset.params });
}

/**
 * 套用预设：预设记的模板版本还在就用它，否则用同一个 id 的最高版本（模板升级后预设照常可用）。
 * 找不到模板时返回 false。
 */
export async function applyPresetEntry(entry: PresetEntry, locale: string): Promise<boolean> {
  const versions = useTemplateStore
    .getState()
    .entries.filter((e) => e.id === entry.template.id && !e.baseMissing)
    .map((e) => e.version)
    .sort(compareVersionStrings);
  const version = versions.includes(entry.template.version) ? entry.template.version : versions.at(-1);
  if (!version) return false;
  const source = await readTemplate(entry.template.id, version);
  if (!source) return false;
  useProjectStore.getState().setTemplate(source, applyPreset(source.params, entry, { locale }), locale);
  previewEngine.retry();
  return true;
}
