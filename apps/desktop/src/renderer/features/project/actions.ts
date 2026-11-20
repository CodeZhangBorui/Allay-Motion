// 工程的新建、打开、保存、另存为（docs/01-product-architecture.md 1.9）。路径只在主进程：这里只有句柄。
import { compareVersionStrings, diffFromDefaults } from '@allay/template-sdk';
import i18next from 'i18next';
import { DOC_PARAM } from '../../../shared/animation/schema';
import type { ProjectData, ProjectOpenResult } from '../../../shared/project';
import { notify } from '../../stores/noticeStore';
import { clearHistory, isDirty, useProjectStore } from '../../stores/projectStore';
import { useResourceStore } from '../../stores/resourceStore';
import { useTemplateStore } from '../../stores/templateStore';
import { useUiStore } from '../../stores/uiStore';
import { DEFAULT_TEMPLATE_ID, readTemplate } from '../../templates/catalog';
import { sourceFromDoc } from '../animation/source';
import { previewEngine } from '../preview/previewEngine';
import { askConfirm } from './confirm';

const t = (key: string, vars?: Record<string, unknown>) => i18next.t(key, vars ?? {});

/** 保存时启用了哪些层（只是记一笔，1.9） */
function resourceHint(): string[] {
  const st = useResourceStore.getState().state;
  if (!st) return [];
  return st.layers.filter((l) => l.enabled && !(l.kind === 'builtin' && l.empty) && l.source !== 'imported').map((l) => (l.kind === 'vanilla' ? 'vanilla' : l.kind === 'pack' ? `pack:${l.name}` : 'builtin'));
}

export function projectData(): ProjectData | null {
  const s = useProjectStore.getState();
  if (!s.template) return null;
  const fps = s.output.fps as ProjectData['output']['fps'];
  return {
    name: s.name ?? t('project.untitled'),
    template: s.template.ref,
    // 自建动画的文档参数不存（文档本身存在 animation 里）
    params: Object.fromEntries(Object.entries(diffFromDefaults(s.template.params, s.params, { locale: i18next.language })).filter(([k]) => !(s.template!.animation && k === DOC_PARAM))),
    output: { width: s.output.width, height: s.output.height, fps },
    export: s.exportSettings,
    preview: { background: useUiStore.getState().settings.editor.background },
    audio: { spatial: useUiStore.getState().settings.editor.spatialAudio },
    resourceHint: resourceHint(),
    // 自建动画：存最后一份合法的文档（代码视图里没改完的文本不进工程文件）
    ...(s.template.animation ? { animation: s.template.animation.doc } : {}),
  };
}

/** 有未保存的改动时先问一句；返回 false 表示用户取消 */
export async function confirmDiscard(): Promise<boolean> {
  if (!isDirty(useProjectStore.getState())) return true;
  return askConfirm({ title: t('project.unsaved.title'), body: t('project.unsaved.body'), confirm: t('project.unsaved.discard') });
}

export async function newProject(): Promise<void> {
  if (!(await confirmDiscard())) return;
  const entries = await useTemplateStore.getState().refresh();
  const flagship = entries.filter((e) => e.id === DEFAULT_TEMPLATE_ID).at(-1) ?? entries.find((e) => !e.baseMissing);
  if (!flagship) return;
  const template = await readTemplate(flagship.id, flagship.version);
  if (!template) return;
  useProjectStore.getState().reset({ template, name: null, handle: null, locale: i18next.language });
  clearHistory();
  previewEngine.retry();
}

async function applyOpened(result: ProjectOpenResult): Promise<boolean> {
  if (result.canceled) return false;
  if (!result.ok) {
    notify('error', t(`project.errors.${result.error}`));
    return false;
  }
  const { data } = result;
  // 自建动画（docs/animation-editor.md 5.1）：模板从工程里的文档生成，不去模板库里找
  if (data.animation) {
    useProjectStore.getState().reset({ template: sourceFromDoc(data.template, data.animation), params: {}, output: data.output, exportSettings: data.export, name: result.name, handle: result.handle, locale: i18next.language });
    clearHistory();
    useUiStore.getState().setEditor({ background: data.preview.background });
    previewEngine.retry();
    return true;
  }
  const entries = await useTemplateStore.getState().refresh();
  // 引用的模板：同一个版本优先，没有就用同一个 id 的最高版本（模板升级后工程照常可用）
  const versions = entries.filter((e) => e.id === data.template.id && !e.baseMissing).map((e) => e.version).sort(compareVersionStrings);
  const version = versions.includes(data.template.version) ? data.template.version : versions.at(-1);
  const template = version ? await readTemplate(data.template.id, version) : null;
  if (!template) {
    notify('error', t('project.errors.templateMissing', { id: data.template.id, version: data.template.version }));
    return false;
  }
  useProjectStore.getState().reset({
    template,
    params: data.params,
    output: data.output,
    exportSettings: data.export,
    name: result.name,
    handle: result.handle,
    locale: i18next.language,
  });
  clearHistory();
  useUiStore.getState().setEditor({ background: data.preview.background, spatialAudio: data.audio?.spatial ?? false });
  previewEngine.retry();
  if (result.missingFiles.length > 0) notify('error', t('project.missingFiles', { keys: result.missingFiles.join(', ') }));
  else {
    const now = resourceHint();
    const same = now.length === data.resourceHint.length && now.every((h, i) => h === data.resourceHint[i]);
    if (!same && data.resourceHint.length > 0) notify('info', t('project.resourceHint'));
  }
  return true;
}

export async function openProject(): Promise<boolean> {
  if (!(await confirmDiscard())) return false;
  return applyOpened(await window.allay.project.open());
}

/** 双击关联的 .allay（M8）：主进程经命令通道发来一次性令牌，路径不经过界面 */
export async function openAssociatedProject(token: string): Promise<boolean> {
  if (!(await confirmDiscard())) return false;
  return applyOpened(await window.allay.project.openRequested(token));
}

export async function openRecent(id: string): Promise<boolean> {
  if (!(await confirmDiscard())) return false;
  return applyOpened(await window.allay.project.openRecent(id));
}

export async function saveProject(as = false): Promise<boolean> {
  const data = projectData();
  if (!data) return false;
  const { handle } = useProjectStore.getState();
  const r = as ? await window.allay.project.saveAs(data) : await window.allay.project.save(handle, data);
  if (r.canceled) return false;
  if (!r.ok) {
    notify('error', t(`project.errors.${r.error}`));
    return false;
  }
  useProjectStore.getState().markSaved(r.name, r.handle);
  notify('info', t('project.saved', { name: r.name }));
  return true;
}
