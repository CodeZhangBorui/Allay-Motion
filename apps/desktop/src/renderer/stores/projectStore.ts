import type { OutputSettings, ParamValues } from '@allay/template-sdk';
import { create } from 'zustand';
import { M1_BLOCK_WIPE, type TemplateSource } from '../templates/builtin';

// projectStore（1.7）的 M1 部分：当前模板、参数、输出设置。撤销、工程名、未保存标记在 M4。

interface ProjectState {
  template: TemplateSource;
  params: ParamValues;
  output: OutputSettings;
  /** 模板或参数每变一次加一，预览据此重新装载 */
  revision: number;
  setTemplate(template: TemplateSource, params?: ParamValues): void;
}

export const DEFAULT_OUTPUT: OutputSettings = { width: 1920, height: 1080, fps: 60 };

export const useProjectStore = create<ProjectState>((set) => ({
  template: M1_BLOCK_WIPE,
  params: {},
  output: DEFAULT_OUTPUT,
  revision: 0,
  setTemplate: (template, params = {}) => set((s) => ({ template, params, revision: s.revision + 1 })),
}));
