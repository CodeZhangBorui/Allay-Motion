// T-DEV-4 的故意违规夹具：主程序的包用相对路径引用可选模块。
// 不参与编译和 lint（eslint.config.js 忽略 tests/fixtures/lint/**），测试以 packages/engine/src/ 下的虚拟路径检查。
import { activate } from '../../optional/code-editor/src/index';

export const leaked = activate;
