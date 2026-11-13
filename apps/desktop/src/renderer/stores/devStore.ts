import type { TemplateDiagnostic } from '@allay/template-sdk';
import { create } from 'zustand';

// 模板开发模式（docs/08-milestones.md MD）的状态：当前模板是否在监视、热重载做到哪一步、上一次的结果和诊断。
// 给预览区的错误浮层、状态栏的监视提示、测试钩子和宿主接口（engine.onDiagnostics）看。

export interface TemplateRef {
  id: string;
  version: string;
}

export type ReloadPhase = 'idle' | 'reloading';

export interface ReloadRecord {
  /** 完成的时刻（Date.now()，只用于显示“几点几分”） */
  at: number;
  ok: boolean;
}

interface DevState {
  /** 正在监视的模板：当前模板是用户模板时就是它，否则为 null */
  watching: TemplateRef | null;
  phase: ReloadPhase;
  /** 上一次热重载 */
  last: ReloadRecord | null;
  /** 上一次热重载失败时的诊断（成功、换模板时清空）；不为空时显示错误浮层 */
  diagnostics: readonly TemplateDiagnostic[];
  /** 热重载完成的次数（成功和失败都算；测试据此判断“处理完了”） */
  reloads: number;
}

export const useDevStore = create<DevState>(() => ({ watching: null, phase: 'idle', last: null, diagnostics: [], reloads: 0 }));

export function sameRef(a: TemplateRef | null | undefined, b: TemplateRef | null | undefined): boolean {
  return !!a && !!b && a.id === b.id && a.version === b.version;
}
