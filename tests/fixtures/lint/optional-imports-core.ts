// T-DEV-4 的故意违规夹具：可选模块引用主程序的引擎（只允许引用 @allay/host-api）。
// 不参与编译和 lint（eslint.config.js 忽略 tests/fixtures/lint/**），测试以 packages/optional/demo/src/ 下的虚拟路径检查。
import { Engine } from '@allay/engine';
import type { Disposable, EditorHost } from '@allay/host-api';

export function activate(host: EditorHost): Disposable {
  void host;
  void Engine;
  return { dispose() {} };
}
