// 代码视图的提供者（docs/code-editing-and-mcp-plan.md 3.3 的补充；docs/animation-editor.md 5.4）。
// 主程序里需要显示、编辑一段代码的地方（动画的代码视图）不自己做编辑器：可选模块（packages/optional/code-editor）
// 经宿主接口 ui.registerCodeView 注册一个提供者，这里记下它；没有提供者时（模块被拆掉或开发模式关着）
// 用普通的文本框（PlainCodeView）。主程序不认识具体的模块。
import type { CodeViewProvider } from '@allay/host-api';
import { create } from 'zustand';

interface CodeViewState {
  provider: CodeViewProvider | null;
}

export const useCodeViews = create<CodeViewState>(() => ({ provider: null }));

/** 同一时间只认一个提供者；后注册的顶替前一个，注销时只撤自己 */
export function registerCodeViewProvider(provider: CodeViewProvider): () => void {
  useCodeViews.setState({ provider });
  return () => {
    if (useCodeViews.getState().provider === provider) useCodeViews.setState({ provider: null });
  };
}
