// 交给引擎之前的源码检查：模板必须是不含任何 import 的单文件 ESM（docs/02-engine.md 2.4、04-templates.md 4.8 第 3 步）。
// 用 es-module-lexer 的纯 JS 版本（不需要 WebAssembly，CSP 不用放宽）。
import { init, parse } from 'es-module-lexer/js';
import { MAX_TEMPLATE_CODE_BYTES } from '@allay/template-sdk';

export type TemplateCodeProblem = 'too-large' | 'has-import' | 'syntax-error';

export class TemplateCodeError extends Error {
  constructor(readonly problem: TemplateCodeProblem, message: string) {
    super(message);
    this.name = 'TemplateCodeError';
  }
}

/** 有静态或动态 import、超过 1 MB、解析不了时抛 TemplateCodeError */
export async function assertTemplateCode(code: string): Promise<void> {
  if (new TextEncoder().encode(code).byteLength > MAX_TEMPLATE_CODE_BYTES) {
    throw new TemplateCodeError('too-large', 'template code exceeds 1 MB');
  }
  await init;
  let imports: readonly unknown[];
  try {
    [imports] = parse(code);
  } catch (error) {
    throw new TemplateCodeError('syntax-error', `template code could not be parsed: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (imports.length > 0) throw new TemplateCodeError('has-import', 'template code must not contain static or dynamic import');
}
