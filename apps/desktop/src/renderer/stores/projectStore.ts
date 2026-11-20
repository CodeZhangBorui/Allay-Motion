import { sanitizeParams, sameValue, type OutputSettings, type ParamValue, type ParamValues } from '@allay/template-sdk';
import { temporal } from 'zundo';
import { create } from 'zustand';
import type { ExportPreset } from '../../shared/export';
import type { TemplateSource } from '../templates/catalog';
import { DOC_PARAM } from '../../shared/animation/schema';

/**
 * 自建动画的预览模板从隐藏参数 DOC_PARAM 读文档（docs/animation-editor.md 第 8 节）：参数值总是由 template.animation.doc 决定，
 * 调用方传什么都以它为准，这样任何换模板、重置的地方都不会把文档弄丢
 */
function withDoc(template: TemplateSource, params: Readonly<Record<string, unknown>>): Readonly<Record<string, unknown>> {
  return template.animation ? { ...params, [DOC_PARAM]: JSON.stringify(template.animation.doc) } : params;
}

/** 两个模板来源在预览看来是不是同一份代码（同一份 manifest、代码、素材）：是的话撤销重做只是改参数 */
function sameStructure(a: TemplateSource | null, b: TemplateSource | null): boolean {
  if (a === b) return true;
  if (!a || !b || !a.animation || !b.animation) return false;
  return a.code === b.code && a.assets === b.assets && JSON.stringify(a.manifest) === JSON.stringify(b.manifest);
}

// projectStore（1.7）：当前模板、参数、输出设置、工程名、是否有未保存改动。
// 撤销用 zundo，只记录模板和参数。一次连续操作（拖滑块、拖数字、拖时间轴上的分界线）只算一步：
// 指针按下时暂停记录（先记下按下前的状态），松开时恢复记录并补一条。
// 参数始终是完整的一组：换模板、改参数时都经 template-sdk 的校验函数清洗（4.4），text 的多语言默认值按界面语言取一次。

/**
 * 撤销记录的来源（docs/code-editing-and-mcp-plan.md H6）：哪一次改动产生了这个状态。
 * labelKey 是文案键（命令的 undoLabelKey 或 titleKey，界面上直接改参数时是 history.*）；
 * source 是谁改的：界面、命令（含快捷键、命令面板）、主进程经命令通道（H11）、可选模块（module:<id>）。
 */
export interface UndoOrigin {
  labelKey: string;
  source: 'ui' | 'command' | 'main' | `module:${string}`;
}

export const UI_ORIGIN: UndoOrigin = { labelKey: 'history.params', source: 'ui' };

/** 当前这次改动的来源（dispatch 执行 write 命令期间设置；没有设置时是界面上的直接修改） */
let ambientOrigin: UndoOrigin | null = null;

/** 在 fn 同步执行期间产生的改动都记成 origin（只覆盖同步部分：异步命令在 await 之后的改动按界面修改记） */
export function withOrigin<T>(origin: UndoOrigin, fn: () => T): T {
  const prev = ambientOrigin;
  ambientOrigin = origin;
  try {
    return fn();
  } finally {
    ambientOrigin = prev;
  }
}

function originFor(fallbackKey: string): UndoOrigin {
  return ambientOrigin ?? { ...UI_ORIGIN, labelKey: fallbackKey };
}

export type QualityLevel = 'draft' | 'standard' | 'high' | 'ultra';

export interface ExportSettings {
  preset: ExportPreset;
  quality: QualityLevel;
  /** 快门角 0–360（5.2） */
  shutterAngle: number;
  /** 绿幕 MP4 的底色 #RRGGBB */
  key: string;
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
  /** 产生当前状态的那次改动（撤销时显示“撤销什么”，H6） */
  origin: UndoOrigin;
  setTemplate(template: TemplateSource, params?: Readonly<Record<string, unknown>>, locale?: string): void;
  /**
   * 自建动画改了文档、但预览模板的 manifest 和代码没变（第 9 项）：换 template（文档在上面）和参数，
   * 不加 structureRevision，预览走 setParams。调用方保证 sameStructure
   */
  setAnimationSource(template: TemplateSource): void;
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
export const DEFAULT_EXPORT: ExportSettings = { preset: 'prores4444', quality: 'standard', shutterAngle: 180, key: '#00FF00' };

type Tracked = Pick<ProjectState, 'template' | 'params' | 'origin'>;

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
      origin: UI_ORIGIN,
      setTemplate: (template, params = {}, locale = 'en') =>
        set((s) => ({
          template,
          params: sanitizeParams(template.params, withDoc(template, params), { locale }),
          revision: s.revision + 1,
          structureRevision: s.structureRevision + 1,
          origin: originFor('history.template'),
        })),
      setAnimationSource: (template) =>
        set((s) => ({
          template,
          params: { ...s.params, ...withDoc(template, {}) } as ParamValues,
          revision: s.revision + 1,
          origin: originFor('history.template'),
        })),
      setParams: (patch, locale = 'en') =>
        set((s) => {
          if (!s.template) return {};
          const params = sanitizeParams(s.template.params, { ...s.params, ...patch }, { locale });
          // 值没变就不产生新状态（不记撤销、不重画）
          if (Object.keys(params).every((k) => sameValue(params[k], s.params[k]))) return {};
          return { params, revision: s.revision + 1, origin: originFor('history.params') };
        }),
      setOutput: (output) => set((s) => ({ output, revision: s.revision + 1, structureRevision: s.structureRevision + 1 })),
      setExportSettings: (patch) => set((s) => ({ exportSettings: { ...s.exportSettings, ...patch } })),
      setFileName: (ref, name) => set((s) => ({ fileNames: { ...s.fileNames, [ref]: name } })),
      reset: ({ template, params = {}, output = DEFAULT_OUTPUT, exportSettings = DEFAULT_EXPORT, name, handle, locale = 'en' }) =>
        set((s) => {
          const revision = s.revision + 1;
          return {
            template,
            params: sanitizeParams(template.params, withDoc(template, params), { locale }),
            output,
            exportSettings,
            name,
            handle,
            revision,
            structureRevision: s.structureRevision + 1,
            savedRevision: revision,
            origin: UI_ORIGIN,
          };
        }),
      markSaved: (name, handle) => set((s) => ({ name, handle, savedRevision: s.revision })),
    }),
    {
      partialize: (s): Tracked => ({ template: s.template, params: s.params, origin: s.origin }),
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
  gestureBefore = { template: s.template, params: s.params, origin: s.origin };
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
    structureRevision: sameStructure(s.template, prevTemplate) ? s.structureRevision : s.structureRevision + 1,
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

/**
 * 撤销历史的列表（第三轮第 11 项）：每一步是产生那个状态的改动（最早的在前）。current 是现在所在的那一步在列表里的下标，
 * 列表最前面一项是历史开始时的状态（没有对应的改动，labelKey 为 null）
 */
export function historyList(): { entries: { labelKey: string | null; source: UndoOrigin['source'] | null }[]; current: number } {
  const t = useProjectStore.temporal.getState();
  const past = t.pastStates;
  const future = [...t.futureStates].reverse();
  const entries: { labelKey: string | null; source: UndoOrigin['source'] | null }[] = [];
  // 第 i 个状态是第 i 次改动的结果：它的 origin 记的是那次改动
  past.forEach((p, i) => entries.push(i === 0 ? { labelKey: null, source: null } : { labelKey: p.origin?.labelKey ?? null, source: p.origin?.source ?? null }));
  const cur = useProjectStore.getState().origin;
  entries.push(past.length === 0 ? { labelKey: null, source: null } : { labelKey: cur.labelKey, source: cur.source });
  for (const f of future) entries.push({ labelKey: f.origin?.labelKey ?? null, source: f.origin?.source ?? null });
  return { entries, current: past.length };
}

/** 跳到历史列表里的第 index 步（往前是连着撤销，往后是连着重做；拖动中不动） */
export function jumpHistory(index: number): void {
  const { current, entries } = historyList();
  const target = Math.max(0, Math.min(entries.length - 1, index));
  for (let i = current; i > target; i--) undo();
  for (let i = current; i < target; i++) redo();
}

export function clearHistory(): void {
  useProjectStore.temporal.getState().clear();
}

/** 单个参数（给属性面板用） */
export function setParam(key: string, value: ParamValue, locale: string): void {
  useProjectStore.getState().setParams({ [key]: value }, locale);
}

/** 撤销、重做各自会撤回或重做哪一次改动（H6）；没有可撤销的时为 null */
export function undoInfo(): { undo: UndoOrigin | null; redo: UndoOrigin | null } {
  const t = useProjectStore.temporal.getState();
  return {
    undo: t.pastStates.length > 0 ? useProjectStore.getState().origin : null,
    // zundo 的重做从 futureStates 的末尾取
    redo: t.futureStates.at(-1)?.origin ?? null,
  };
}

// ---- 工程修订号（docs/code-editing-and-mcp-plan.md H3）----

/** 工程状态的修订号：模板、参数或输出每变一次加一（就是 revision）。写命令可以带上读到的修订号做并发保护 */
export function projectRevision(): number {
  return useProjectStore.getState().revision;
}

export class RevisionConflictError extends Error {
  constructor(
    readonly expected: number,
    readonly actual: number,
  ) {
    super(`project revision is ${actual}, expected ${expected}`);
    this.name = 'RevisionConflictError';
  }
}

/** baseRevision 不是当前修订号时抛 RevisionConflictError，不改任何东西；是的话执行 fn */
export function ifRevision<T>(baseRevision: number | undefined, fn: () => T): T {
  const actual = projectRevision();
  if (baseRevision !== undefined && baseRevision !== actual) throw new RevisionConflictError(baseRevision, actual);
  return fn();
}

// ---- 模板开发模式的热重载（H9）----

/**
 * 同一个模板（id 和版本相同）的代码或 manifest 在磁盘上被改了，预览已经切到新代码：换掉工程里的模板，参数用 params。
 * 不进撤销历史（这不是用户在应用里的改动）；历史里引用旧模板的状态也换成新模板（参数用 remap 重新对上），
 * 免得撤销把已经不在磁盘上的旧代码带回来。
 */
export function hotSwapTemplate(next: TemplateSource, params: ParamValues, remap: (old: TemplateSource, values: ParamValues) => ParamValues): void {
  const same = (t: TemplateSource | null) => !!t && t.ref.id === next.ref.id && t.ref.version === next.ref.version;
  const temporalApi = useProjectStore.temporal;
  const tracking = temporalApi.getState().isTracking;
  if (tracking) temporalApi.getState().pause();
  try {
    useProjectStore.setState((s) => ({ template: next, params, revision: s.revision + 1, structureRevision: s.structureRevision + 1 }));
  } finally {
    if (tracking) temporalApi.getState().resume();
  }
  const fix = <S extends Partial<Tracked>>(st: S): S => (st.template && same(st.template) && st.params ? { ...st, template: next, params: remap(st.template, st.params) } : st);
  temporalApi.setState((ts) => ({ pastStates: ts.pastStates.map(fix), futureStates: ts.futureStates.map(fix) }));
  if (gestureBefore && same(gestureBefore.template)) gestureBefore = fix(gestureBefore);
}
