import { sanitizeParams, type OutputSettings, type ParamValues } from '@allay/template-sdk';
import { create } from 'zustand';
import type { TemplateSource } from '../templates/catalog';

// projectStore（1.7）的 M3 部分：当前模板、参数、输出设置。撤销、工程名、未保存标记在 M4。
// 参数始终是完整的一组：换模板、改参数时都经 template-sdk 的校验函数清洗（4.4），text 的多语言默认值按界面语言取一次。

interface ProjectState {
  /** 启动时模板列表还没取到，或者没有可用的模板 */
  template: TemplateSource | null;
  params: ParamValues;
  output: OutputSettings;
  /** 模板或参数每变一次加一，预览据此重新装载 */
  revision: number;
  setTemplate(template: TemplateSource, params?: Readonly<Record<string, unknown>>, locale?: string): void;
  /** 改一部分参数（多余的键丢弃，越界的钳制） */
  setParams(patch: Readonly<Record<string, unknown>>, locale?: string): void;
}

export const DEFAULT_OUTPUT: OutputSettings = { width: 1920, height: 1080, fps: 60 };

export const useProjectStore = create<ProjectState>((set) => ({
  template: null,
  params: {},
  output: DEFAULT_OUTPUT,
  revision: 0,
  setTemplate: (template, params = {}, locale = 'en') =>
    set((s) => ({ template, params: sanitizeParams(template.params, params, { locale }), revision: s.revision + 1 })),
  setParams: (patch, locale = 'en') =>
    set((s) => (s.template ? { params: sanitizeParams(s.template.params, { ...s.params, ...patch }, { locale }), revision: s.revision + 1 } : {})),
}));
