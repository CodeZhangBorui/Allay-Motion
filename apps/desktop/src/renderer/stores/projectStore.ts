import { sanitizeParams, sameValue, type OutputSettings, type ParamValue, type ParamValues } from '@allay/template-sdk';
import { temporal } from 'zundo';
import { create } from 'zustand';
import type { ExportPreset } from '../../shared/export';
import type { TemplateSource } from '../templates/catalog';

// projectStore（1.7）：当前模板、参数、输出设置、工程名、是否有未保存改动。
// 撤销用 zundo，只记录模板和参数。一次连续操作（拖滑块、拖数字、拖时间轴上的分界线）只算一步：
// 指针按下时暂停记录（先记下按下前的状态），松开时恢复记录并补一条。
// 参数始终是完整的一组：换模板、改参数时都经 template-sdk 的校验函数清洗（4.4），text 的多语言默认值按界面语言取一次。

export type QualityLevel = 'draft' | 'standard' | 'high' | 'ultra';

export interface ExportSettings {
  preset: ExportPreset;
  quality: QualityLevel;
  shutterAngle: number;
}

interface ProjectState {
  /** 启动时模板列表还没取到，或者没有可用的模板 */
  template: TemplateSource | null;
  params: ParamValues;
  output: OutputSettings;
  exportSettings: ExportSettings;
  /** 工程名；null 是“未命名工程” */
  name: string | null;
  /** 主进程签发的工程句柄（打开或保存过）；null 表示还没有对应的文件 */
  handle: string | null;
  /** 模板、参数或输出每变一次加一，预览据此重新装载或改参数 */
  revision: number;
  /** 模板或输出每变一次加一：这时预览要重新装载，只改参数时走 setParams */
  structureRevision: number;
  /** 上次保存（或打开、新建）时的 revision */
  savedRevision: number;
  /** file: 引用对应的文件名（只用于显示） */
  fileNames: Record<string, string>;
  setTemplate(template: TemplateSource, params?: Readonly<Record<string, unknown>>, locale?: string): void;
  /** 改一部分参数（多余的键丢弃，越界的钳制） */
  setParams(patch: Readonly<Record<string, unknown>>, locale?: string): void;
  setOutput(output: OutputSettings): void;
  setExportSettings(patch: Partial<ExportSettings>): void;
  setFileName(ref: string, name: string): void;
  /** 新建或打开工程：重置名字、句柄，清空撤销历史 */
  reset(next: { template: TemplateSource; params?: Readonly<Record<string, unknown>>; output?: OutputSettings; exportSettings?: ExportSettings; name: string | null; handle: string | null; locale?: string }): void;
  markSaved(name: string, handle: string): void;
}

export const DEFAULT_OUTPUT: OutputSettings = { width: 1920, height: 1080, fps: 60 };
export const DEFAULT_EXPORT: ExportSettings = { preset: 'prores4444', quality: 'standard', shutterAngle: 180 };

type Tracked = Pick<ProjectState, 'template' | 'params'>;

export const useProjectStore = create<ProjectState>()(
  temporal(
    (set) => ({
      template: null,
      params: {},
      output: DEFAULT_OUTPUT,
      exportSettings: DEFAULT_EXPORT,
      name: null,
      handle: null,
      revision: 0,
      structureRevision: 0,
      savedRevision: 0,
      fileNames: {},
      setTemplate: (template, params = {}, locale = 'en') =>
        set((s) => ({
          template,
          params: sanitizeParams(template.params, params, { locale }),
          revision: s.revision + 1,
          structureRevision: s.structureRevision + 1,
        })),
      setParams: (patch, locale = 'en') =>
        set((s) => {
          if (!s.template) return {};
          const params = sanitizeParams(s.template.params, { ...s.params, ...patch }, { locale });
          // 值没变就不产生新状态（不记撤销、不重画）
          if (Object.keys(params).every((k) => sameValue(params[k], s.params[k]))) return {};
          return { params, revision: s.revision + 1 };
        }),
      setOutput: (output) => set((s) => ({ output, revision: s.revision + 1, structureRevision: s.structureRevision + 1 })),
      setExportSettings: (patch) => set((s) => ({ exportSettings: { ...s.exportSettings, ...patch } })),
      setFileName: (ref, name) => set((s) => ({ fileNames: { ...s.fileNames, [ref]: name } })),
      reset: ({ template, params = {}, output = DEFAULT_OUTPUT, exportSettings = DEFAULT_EXPORT, name, handle, locale = 'en' }) =>
        set((s) => {
          const revision = s.revision + 1;
          return {
            template,
            params: sanitizeParams(template.params, params, { locale }),
            output,
            exportSettings,
            name,
            handle,
            revision,
            structureRevision: s.structureRevision + 1,
            savedRevision: revision,
          };
        }),
      markSaved: (name, handle) => set((s) => ({ name, handle, savedRevision: s.revision })),
    }),
    {
      partialize: (s): Tracked => ({ template: s.template, params: s.params }),
      equality: (a, b) => a.template === b.template && a.params === b.params,
      limit: 200,
    },
  ),
);

export function isDirty(s: Pick<ProjectState, 'revision' | 'savedRevision'>): boolean {
  return s.revision !== s.savedRevision;
}

// ---- 撤销重做（只记录模板和参数）----

let gestureDepth = 0;
let gestureBefore: Tracked | null = null;

/** 一次连续操作开始：按下前的状态记下来，期间的改动不进历史 */
export function beginGesture(): void {
  if (gestureDepth++ > 0) return;
  const s = useProjectStore.getState();
  gestureBefore = { template: s.template, params: s.params };
  useProjectStore.temporal.getState().pause();
}

/** 一次连续操作结束：有变化就补一条撤销记录（按下前的状态） */
export function endGesture(): void {
  if (gestureDepth === 0 || --gestureDepth > 0) return;
  const t = useProjectStore.temporal;
  t.getState().resume();
  const before = gestureBefore;
  gestureBefore = null;
  const s = useProjectStore.getState();
  if (!before || (before.template === s.template && before.params === s.params)) return;
  t.setState((ts) => ({ pastStates: [...ts.pastStates, before].slice(-200), futureStates: [] }));
}

function afterHistoryJump(prevTemplate: TemplateSource | null): void {
  useProjectStore.setState((s) => ({
    revision: s.revision + 1,
    structureRevision: s.template !== prevTemplate ? s.structureRevision + 1 : s.structureRevision,
  }));
}

export function undo(): void {
  const t = useProjectStore.temporal.getState();
  if (gestureDepth > 0 || t.pastStates.length === 0) return;
  const prev = useProjectStore.getState().template;
  t.undo();
  afterHistoryJump(prev);
}

export function redo(): void {
  const t = useProjectStore.temporal.getState();
  if (gestureDepth > 0 || t.futureStates.length === 0) return;
  const prev = useProjectStore.getState().template;
  t.redo();
  afterHistoryJump(prev);
}

export function clearHistory(): void {
  useProjectStore.temporal.getState().clear();
}

/** 单个参数（给属性面板用） */
export function setParam(key: string, value: ParamValue, locale: string): void {
  useProjectStore.getState().setParams({ [key]: value }, locale);
}
