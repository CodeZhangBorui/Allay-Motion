// pnpm test:engine：T-DEV-2 的引擎层部分（docs/08-milestones.md MD；docs/code-editing-and-mcp-plan.md H5、H12）。
// 语法错误、setup 抛错、update 抛错、死循环、Math.random、乱序不一致各一个夹具模板，分别得到对应 kind 的结构化诊断；
// 有位置的断言行号列号（模板没有转译，Blob 模块的行列就是源码的行列）。界面部分（错误浮层、保留上一帧）属于 MD-b。
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';
import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test';
import type { Harness } from './harness/harness';

const ROOT = resolve(import.meta.dirname, '../..');
const ELECTRON = createRequire(join(ROOT, 'apps/desktop/package.json'))('electron') as string;

let app: ElectronApplication;
let page: Page;

test.beforeAll(async () => {
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) if (v !== undefined && k !== 'ELECTRON_RUN_AS_NODE' && k !== 'NODE_OPTIONS') env[k] = v;
  app = await electron.launch({ executablePath: ELECTRON, args: [join(import.meta.dirname, 'electron-main.mjs')], env });
  page = await app.firstWindow();
  await page.waitForFunction(() => window.harnessReady === true);
});

test.afterAll(async () => {
  await app?.close();
});

type Fn = { [K in keyof Harness]: Harness[K] extends (...a: infer A) => infer R ? (...a: A) => R : never };
function call<K extends keyof Harness>(name: K, ...args: Parameters<Fn[K]>): Promise<Awaited<ReturnType<Fn[K]>>> {
  return page.evaluate(
    ([n, a]) => (window.harness[n as keyof Harness] as (...x: unknown[]) => unknown)(...(a as unknown[])),
    [name, args] as const,
  ) as Promise<Awaited<ReturnType<Fn[K]>>>;
}

const OUT = { width: 256, height: 144, fps: 30 };

test('T-DEV-2 语法错误：装载前预检，compile 诊断带行列', async () => {
  const r = await call('diagnose', 'devSyntaxError', OUT);
  expect(r.phase).toBe('load');
  expect(r.name).toBe('TemplateCodeError');
  expect(r.diagnostic).toMatchObject({ kind: 'compile', severity: 'error', code: 'syntax-error', line: 6, column: 25 });
  // 预检在交给 Worker 之前：Worker 没受影响
  expect(r.dead).toBe(false);
});

test('T-DEV-2 setup 抛错：setup 诊断指向 throw 那一行', async () => {
  const r = await call('diagnose', 'devSetupThrows', OUT);
  expect(r.phase).toBe('load');
  expect(r.diagnostic).toMatchObject({ kind: 'setup', severity: 'error', code: 'setup-threw', line: 5, column: 11 });
  expect(r.diagnostic?.message).toContain('setup exploded');
  // 原来的文字仍在（旧的调用方只看 message）
  expect(r.message).toContain('template setup() failed');
  expect(r.dead).toBe(false);
});

test('T-DEV-2 update 抛错：update 诊断带出错的时刻和位置', async () => {
  const r = await call('diagnose', 'devUpdateThrows', OUT);
  expect(r.phase).toBe('render');
  expect(r.diagnostic).toMatchObject({ kind: 'update', severity: 'error', code: 'update-threw', line: 9, column: 29 });
  expect(r.diagnostic?.message).toMatch(/TypeError/);
  expect(r.diagnostic && 't' in r.diagnostic ? r.diagnostic.t : null).toBeCloseTo(0.5, 6);
  expect(r.dead).toBe(false);
});

test('T-DEV-2 死循环：看门狗终止 Worker，watchdog 诊断（没有位置）', async () => {
  const r = await call('diagnose', 'hangUpdate', OUT, { timeouts: { exportFrame: 2000 } });
  expect(r.phase).toBe('render');
  expect(r.name).toBe('EngineUnresponsiveError');
  expect(r.dead).toBe(true);
  expect(r.diagnostic).toEqual({
    kind: 'watchdog',
    severity: 'error',
    code: 'unresponsive',
    message: 'engine did not respond to renderFrame in time',
    operation: 'renderFrame',
    timeoutMs: 2000,
  });
});

test('T-DEV-2 Math.random：静态规则给出 rule 提示，开发构建的运行时拦截给出 determinism 诊断，指向同一行', async () => {
  const r = await call('diagnose', 'devRandomUpdate', OUT);
  // 静态规则：只有代码里的那一处（字符串和注释里的不算）
  expect(r.rules).toHaveLength(1);
  expect(r.rules[0]).toMatchObject({ kind: 'rule', severity: 'warning', code: 'math-random', line: 8, column: 24 });
  // 运行时：update 里的调用被拦下
  expect(r.phase).toBe('render');
  expect(r.diagnostic).toMatchObject({ kind: 'determinism', severity: 'error', code: 'forbidden-api', line: 8, column: 29 });
  expect(r.diagnostic?.message).toMatch(/Math\.random\(\) is not allowed/);
  expect(r.dead).toBe(false);
});

test('T-DEV-2 乱序不一致：同一帧穿插渲染别的帧后结果不同，determinism 诊断（没有位置）', async () => {
  const r = await call('diagnose', 'devOrderDependent', OUT, { check: { probe: 15, others: [0, 29, 7] } });
  expect(r.phase).toBe('check');
  expect(r.rules).toEqual([]);
  expect(r.diagnostic).toMatchObject({ kind: 'determinism', severity: 'warning', code: 'render-mismatch', t: 0.5 });
  expect(r.diagnostic).not.toHaveProperty('line');
});

test('T-DEV-2 对照：确定的模板（T1）自检通过，没有规则提示', async () => {
  const r = await call('diagnose', 'blockWipe', { width: 320, height: 180, fps: 60 }, { check: { probe: 33, others: [0, 65, 10] } });
  expect(r.phase).toBe('check');
  expect(r.diagnostic).toBeNull();
  expect(r.rules).toEqual([]);
});
