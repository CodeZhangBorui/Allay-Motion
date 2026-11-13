// ESLint 配置。依赖方向（docs/01-product-architecture.md 1.4）用 no-restricted-imports 强制：
// 每个包一条“除了允许的都禁止”的正则，再加上“只允许类型导入”的例外。
import { builtinModules } from 'node:module';
import js from '@eslint/js';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';
import tseslint from 'typescript-eslint';

const RULE = '@typescript-eslint/no-restricted-imports';

/** 转义正则特殊字符（规则用 u 标志编译，不能多转义 @、-、/） */
const ESC = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const nodeBuiltins = `^(node:|(${builtinModules.map(ESC).join('|')})(/|$))`;
const NODE = { regex: nodeBuiltins, message: '这个包不能依赖 Node（1.4 依赖方向）。' };
const ELECTRON = { regex: '^electron(/|$)', message: '这个包不能依赖 Electron（1.4 依赖方向）。' };
const REACT = { regex: '^(react|react-dom)(/|$)', message: '这个包不能依赖 React（1.4 依赖方向）。' };

/** 除了列出的模块和相对路径，其他一律禁止 */
function onlyAllow(allowed, message) {
  const alternatives = allowed.map((m) => `${ESC(m)}(/|$)`).join('|');
  return { regex: `^(?!(${alternatives ? `${alternatives}|` : ''}\\.))`, message };
}

/** 只允许类型导入 */
function typeOnly(moduleName, message) {
  return { regex: `^${ESC(moduleName)}(/|$)`, allowTypeImports: true, message };
}

/** 依赖方向，导出给 T-ARC-1 的测试核对 */
export const dependencyRules = [
  {
    name: 'deps/template-sdk',
    files: ['packages/template-sdk/src/**/*.{ts,tsx}'],
    patterns: [
      onlyAllow(['zod', 'three'], 'template-sdk 只能依赖 zod 和 three 的类型（1.4）。'),
      typeOnly('three', 'template-sdk 只能导入 three 的类型（1.4）。'),
    ],
  },
  {
    name: 'deps/assets',
    files: ['packages/assets/src/**/*.{ts,tsx}'],
    patterns: [onlyAllow(['zod'], 'assets 只能依赖 zod（1.4）：不能用 React、Electron、Node 和 three 的运行时。')],
  },
  {
    name: 'deps/engine',
    files: ['packages/engine/src/**/*.{ts,tsx}'],
    patterns: [
      onlyAllow(
        ['three', '@allay/template-sdk', '@allay/assets'],
        'engine 只能依赖 three、template-sdk、assets（1.4）：不能用 React、Electron、Node、DOM。',
      ),
    ],
    globals: ['window', 'document'],
  },
  {
    name: 'deps/templates',
    files: ['packages/templates/**/*.{ts,tsx}'],
    patterns: [
      onlyAllow(['@allay/template-sdk'], '内置模板只能依赖 template-sdk 的类型（1.4），包括不能用 three 的运行时。'),
      typeOnly('@allay/template-sdk', '内置模板只能导入 template-sdk 的类型（1.4）。'),
    ],
    globals: ['window', 'document'],
  },
  {
    name: 'deps/ui',
    files: ['packages/ui/src/**/*.{ts,tsx}'],
    patterns: [
      { regex: '^@allay/(engine|mascot|desktop)(/|$)', message: 'ui 不能依赖 engine、mascot 和应用（1.4）。' },
      ELECTRON,
      NODE,
    ],
  },
  {
    name: 'deps/mascot',
    files: ['packages/mascot/src/**/*.{ts,tsx}'],
    patterns: [
      { regex: '^@allay/engine/.+', message: 'mascot 不能依赖 engine 的内部（1.4）。' },
      { regex: '^@allay/(desktop|assets)(/|$)', message: 'mascot 不能依赖这个包（1.4）。' },
      typeOnly('@allay/template-sdk', 'mascot 只能导入 template-sdk 的类型（1.4）。'),
      ELECTRON,
      NODE,
    ],
  },
  {
    name: 'deps/renderer',
    files: ['apps/desktop/src/renderer/**/*.{ts,tsx}'],
    patterns: [
      { ...ELECTRON, message: '渲染进程不能依赖 Electron，只能通过 window.allay（1.4）。' },
      { ...NODE, message: '渲染进程不能依赖 Node，只能通过 window.allay（1.4）。' },
      { regex: '(^|/)main(/|$)', message: '渲染进程不能导入主进程代码（1.4）。' },
      { regex: '(^|/)preload(/|$)', allowTypeImports: true, message: '渲染进程只能导入 preload 的类型（1.4）。' },
    ],
  },
  {
    name: 'deps/main',
    files: ['apps/desktop/src/main/**/*.ts'],
    patterns: [
      { ...REACT, message: '主进程不能依赖 React（1.4）。' },
      { regex: '^@allay/(engine|ui|mascot)(/|$)', message: '主进程只能依赖 assets 和 template-sdk（1.4）。' },
      { regex: '(^|/)renderer(/|$)', message: '主进程不能导入渲染进程代码。' },
    ],
  },
  {
    name: 'deps/shared',
    files: ['apps/desktop/src/shared/**/*.ts', 'apps/desktop/src/preload/**/*.ts'],
    patterns: [
      REACT,
      { regex: '^@allay/(engine|ui|mascot)(/|$)', message: '共享代码与 preload 不能依赖界面和引擎。' },
      { regex: '(^|/)(renderer|main)(/|$)', message: '共享代码与 preload 不能导入主进程或渲染进程代码。' },
    ],
  },
];

export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/out/**',
      '**/dist/**',
      'resources/**',
      'docs/**',
      'test-results/**',
      'playwright-report/**',
      // 其他会话放在仓库目录里的 git worktree（.git/info/exclude 已排除），不属于这份代码
      '.claude/**',
      // 故意违规的夹具，只由 T-ARC-1、T-DEV-4 的测试以虚拟路径检查
      'tests/fixtures/lint/**',
      // T-DEV-2 故意写错语法的模板夹具
      'tests/fixtures/templates/dev/syntax-error.js',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    linterOptions: { reportUnusedDisableDirectives: 'error' },
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/consistent-type-imports': ['error', { fixStyle: 'inline-type-imports' }],
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
    },
  },
  {
    files: ['**/*.tsx', 'apps/desktop/src/renderer/**/*.ts', 'packages/ui/src/**/*.ts', 'packages/mascot/src/**/*.ts'],
    plugins: { 'react-hooks': reactHooks },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'error',
    },
    languageOptions: { globals: globals.browser },
  },
  {
    files: ['scripts/**', 'tests/**', '*.config.{ts,js}', 'apps/desktop/*.config.ts', 'apps/desktop/src/main/**', 'apps/desktop/src/preload/**'],
    languageOptions: { globals: globals.node },
  },
  ...dependencyRules.map((rule) => ({
    name: rule.name,
    files: rule.files,
    rules: {
      [RULE]: ['error', { patterns: rule.patterns }],
      ...(rule.globals
        ? { 'no-restricted-globals': ['error', ...rule.globals.map((name) => ({ name, message: `${rule.name}：不能使用 DOM（1.4）。` }))] }
        : {}),
    },
  })),
);
