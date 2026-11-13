// 模板源码检查：模板必须是不含任何 import 的单文件 ESM（docs/02-engine.md 2.4、04-templates.md 4.8 第 3 步）。
// 主进程（安装校验）、渲染进程（每次交给引擎之前）和构建脚本共用。
//
// 两个解析器，各管一件事：
// - acorn（纯 JS，不用 eval、不用 WebAssembly，CSP 不用放宽）：语法预检，给出语法错误的位置；
//   同一棵语法树上跑确定性的静态规则（H12），结果是 rule 类诊断（只是提示，不替代运行时的拦截与双渲比对）。
// - es-module-lexer 的纯 JS 版本：import 检查。这是 M1 起的安全门（T-ARC-4），保持原样，只补上位置。
import { parse as parseAcorn, type Node as AcornNode, type Program } from 'acorn';
import { init, parse } from 'es-module-lexer/js';
import { MAX_TEMPLATE_CODE_BYTES, type TemplateDiagnostic } from '@allay/template-sdk';

export type TemplateCodeProblem = 'too-large' | 'has-import' | 'syntax-error';

const PROBLEM_CODE: Record<TemplateCodeProblem, string> = { 'too-large': 'too-large', 'has-import': 'has-import', 'syntax-error': 'syntax-error' };

export class TemplateCodeError extends Error {
  /** compile 类诊断（H5）；能定位时带行列 */
  readonly diagnostic: TemplateDiagnostic;

  constructor(
    readonly problem: TemplateCodeProblem,
    message: string,
    loc?: { line: number; column: number },
  ) {
    super(message);
    this.name = 'TemplateCodeError';
    this.diagnostic = { kind: 'compile', severity: 'error', code: PROBLEM_CODE[problem], message: message.slice(0, 2000), ...(loc ?? {}) };
  }
}

/** 字符偏移 → 行列（都从 1 开始；列按 UTF-16 码元数，与 V8 的调用栈、VS Code 一致） */
export function positionOf(code: string, offset: number): { line: number; column: number } {
  let line = 1;
  let lineStart = 0;
  const end = Math.min(Math.max(0, offset), code.length);
  for (let i = 0; i < end; i++) {
    const c = code.charCodeAt(i);
    if (c === 10 || ((c === 13 || c === 0x2028 || c === 0x2029) && code.charCodeAt(i + 1) !== 10)) {
      line++;
      lineStart = i + 1;
    }
  }
  return { line, column: end - lineStart + 1 };
}

/** acorn 的语法错误带 loc（行从 1、列从 0 开始） */
function syntaxError(error: unknown): TemplateCodeError {
  const e = error as { message?: unknown; loc?: { line?: unknown; column?: unknown } };
  const message = typeof e?.message === 'string' ? e.message : String(error);
  const line = e?.loc?.line;
  const column = e?.loc?.column;
  const loc = typeof line === 'number' && typeof column === 'number' && line >= 1 && column >= 0 ? { line, column: column + 1 } : undefined;
  return new TemplateCodeError('syntax-error', `template code could not be parsed: ${message}`, loc);
}

function parseProgram(code: string): Program {
  try {
    // ecmaVersion 'latest'：与 Electron 的 V8 同代的语法都认；allowHashBang 与浏览器的模块一致
    return parseAcorn(code, { ecmaVersion: 'latest', sourceType: 'module', locations: true, allowHashBang: true });
  } catch (error) {
    throw syntaxError(error);
  }
}

/**
 * 预检并跑静态规则。有静态或动态 import、超过 1 MB、解析不了时抛 TemplateCodeError（带 compile 类诊断）；
 * 否则返回 rule 类诊断（可能为空）。
 */
export async function analyzeTemplateCode(code: string): Promise<TemplateDiagnostic[]> {
  if (new TextEncoder().encode(code).byteLength > MAX_TEMPLATE_CODE_BYTES) {
    throw new TemplateCodeError('too-large', 'template code exceeds 1 MB');
  }
  const program = parseProgram(code);
  await init;
  let imports: readonly { importStart: number }[];
  try {
    [imports] = parse(code);
  } catch (error) {
    throw new TemplateCodeError('syntax-error', `template code could not be parsed: ${error instanceof Error ? error.message : String(error)}`);
  }
  const first = imports[0];
  if (first) throw new TemplateCodeError('has-import', 'template code must not contain static or dynamic import', positionOf(code, first.importStart));
  return determinismRules(program);
}

/** 有静态或动态 import、超过 1 MB、解析不了时抛 TemplateCodeError */
export async function assertTemplateCode(code: string): Promise<void> {
  await analyzeTemplateCode(code);
}

// ---- 确定性的静态规则（H12） ----

/** 规则的错误码与说明。说明是英文的细节，界面按 code 显示文案 */
export const DETERMINISM_RULES = {
  'math-random': 'Math.random() gives different values on every render; use ctx.random(key) instead',
  'date-now': 'Date.now() reads the real clock; the frame must depend only on t',
  'new-date': 'new Date() / Date() without arguments reads the real clock; the frame must depend only on t',
  'performance-now': 'performance.now() reads the real clock; the frame must depend only on t',
  import: 'templates must not import anything; everything comes from ctx',
} as const;
export type DeterminismRule = keyof typeof DETERMINISM_RULES;

/** 最多报这么多条，免得一份生成的代码刷屏 */
const MAX_RULE_DIAGNOSTICS = 100;

type AnyNode = AcornNode & Record<string, unknown>;

function isNode(value: unknown): value is AnyNode {
  return typeof value === 'object' && value !== null && typeof (value as { type?: unknown }).type === 'string';
}

function isIdent(node: unknown, name: string): boolean {
  return isNode(node) && node.type === 'Identifier' && node.name === name;
}

/** obj.prop、obj['prop']、obj?.prop */
function isMember(node: AnyNode, object: string, property: string): boolean {
  if (node.type !== 'MemberExpression' || !isIdent(node.object, object)) return false;
  const p = node.property as AnyNode;
  return node.computed ? p.type === 'Literal' && p.value === property : isIdent(p, property);
}

/** 静态规则：只看语法树，字符串和注释里的 Math.random 不算 */
function determinismRules(program: Program): TemplateDiagnostic[] {
  const out: TemplateDiagnostic[] = [];
  const report = (rule: DeterminismRule, node: AnyNode) => {
    if (out.length >= MAX_RULE_DIAGNOSTICS) return;
    const loc = node.loc;
    out.push({
      kind: 'rule',
      severity: 'warning',
      code: rule,
      message: DETERMINISM_RULES[rule],
      ...(loc ? { line: loc.start.line, column: loc.start.column + 1 } : {}),
    });
  };
  const visit = (node: AnyNode) => {
    switch (node.type) {
      case 'MemberExpression':
        if (isMember(node, 'Math', 'random')) report('math-random', node);
        else if (isMember(node, 'Date', 'now')) report('date-now', node);
        else if (isMember(node, 'performance', 'now')) report('performance-now', node);
        break;
      case 'NewExpression':
        // new Date(0)、new Date(2026, 0, 1) 是确定的，只有不带参数才读真实时间
        if (isIdent(node.callee, 'Date') && (node.arguments as unknown[]).length === 0) report('new-date', node);
        break;
      case 'CallExpression':
        // Date() 不带 new 总是返回当前时间的字符串
        if (isIdent(node.callee, 'Date')) report('new-date', node);
        break;
      case 'ImportDeclaration':
      case 'ImportExpression':
        report('import', node);
        break;
      case 'ExportNamedDeclaration':
      case 'ExportAllDeclaration':
        if (node.source) report('import', node);
        break;
    }
    for (const key of Object.keys(node)) {
      if (key === 'loc' || key === 'start' || key === 'end') continue;
      const child = node[key];
      if (Array.isArray(child)) {
        for (const c of child) if (isNode(c)) visit(c);
      } else if (isNode(child)) visit(child);
    }
  };
  visit(program as unknown as AnyNode);
  return out;
}

/** 只跑静态规则（语法错误时返回空：语法错误由 analyzeTemplateCode 报） */
export function checkDeterminismRules(code: string): TemplateDiagnostic[] {
  let program: Program;
  try {
    program = parseProgram(code);
  } catch {
    return [];
  }
  return determinismRules(program);
}
