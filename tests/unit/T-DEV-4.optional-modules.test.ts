// T-DEV-4：可选模块可以整块拆除（docs/08-milestones.md MD；docs/code-editing-and-mcp-plan.md 3.1、3.2）。
// - 依赖方向：任何包都不得引用 packages/optional/**；可选模块只能引用 @allay/host-api。两个故意违规的夹具被 lint 拦下。
// - packages/optional 为空（只有说明）时这份测试所在的 pnpm check 照常通过；主程序的配置里没有任何地方点名可选模块，
//   所以目录被删掉也不影响（手工删目录跑过一次，见 docs/decisions.md MD-a）。
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { ESLint } from 'eslint';
import { describe, expect, it } from 'vitest';

const ROOT = resolve(import.meta.dirname, '../..');
const RULE = '@typescript-eslint/no-restricted-imports';
const eslint = new ESLint({ cwd: ROOT });

async function blockedAs(virtualPath: string, code: string): Promise<string[]> {
  const [result] = await eslint.lintText(code, { filePath: join(ROOT, virtualPath) });
  return (result?.messages ?? []).filter((m) => m.ruleId === RULE).map((m) => m.message);
}

describe('T-DEV-4 可选模块的依赖方向', () => {
  it('故意违规的夹具：核心包用相对路径引用可选模块，被拦下', async () => {
    const code = readFileSync(join(ROOT, 'tests/fixtures/lint/core-imports-optional.ts'), 'utf8');
    const messages = await blockedAs('packages/engine/src/__violation__.ts', code);
    expect(messages).toHaveLength(1);
    expect(messages[0]).toContain('可选模块');
  });

  it('故意违规的夹具：可选模块引用引擎，被拦下（引用 host-api 的那一行不算）', async () => {
    const code = readFileSync(join(ROOT, 'tests/fixtures/lint/optional-imports-core.ts'), 'utf8');
    const messages = await blockedAs('packages/optional/demo/src/index.ts', code);
    expect(messages).toHaveLength(1);
    expect(messages[0]).toContain('host-api');
  });

  const cases: [string, string, string, boolean][] = [
    ['渲染进程按包名引用可选模块', 'apps/desktop/src/renderer/x.ts', "import { activate } from '@allay/optional-code-editor';", false],
    ['主进程按相对路径引用可选模块', 'apps/desktop/src/main/x.ts', "import { x } from '../../../../packages/optional/mcp/src/index';", false],
    ['界面包引用可选模块', 'packages/ui/src/x.ts', "import { x } from '../../optional/code-editor/src/panel';", false],
    ['host-api 引用可选模块', 'packages/host-api/src/x.ts', "import type { X } from '@allay/optional-mcp';", false],
    ['脚本引用可选模块', 'scripts/x.ts', "import { x } from '../packages/optional/mcp/src/bridge';", false],
    ['测试引用可选模块', 'tests/unit/x.test.ts', "import { x } from '../../packages/optional/code-editor/src/index';", false],
    ['可选模块引用 host-api 的类型', 'packages/optional/demo/src/x.ts', "import type { EditorHost } from '@allay/host-api';", true],
    ['可选模块引用自己目录里的文件', 'packages/optional/demo/src/x.ts', "import { y } from './y';\nimport { z } from '../lib/z';", true],
    ['可选模块用自己的第三方依赖', 'packages/optional/demo/src/x.ts', "import { EditorView } from '@codemirror/view';", true],
    ['可选模块引用 template-sdk', 'packages/optional/demo/src/x.ts', "import type { SetupContext } from '@allay/template-sdk';", false],
    ['可选模块引用界面包', 'packages/optional/demo/src/x.ts', "import { Button } from '@allay/ui';", false],
    ['可选模块用相对路径够到引擎', 'packages/optional/demo/src/x.ts', "import { Engine } from '../../../engine/src/engine';", false],
    ['可选模块用相对路径够到 host-api 的源码', 'packages/optional/demo/src/x.ts', "import type { EditorHost } from '../../../host-api/src/index';", false],
    ['可选模块用相对路径够到应用', 'packages/optional/demo/src/x.ts', "import { x } from '../../../../apps/desktop/src/main/index';", false],
    ['host-api 引用 template-sdk 的类型', 'packages/host-api/src/x.ts', "import type { TemplateDiagnostic } from '@allay/template-sdk';", true],
    ['host-api 引用 template-sdk 的运行时', 'packages/host-api/src/x.ts', "import { diagnosticOf } from '@allay/template-sdk';", false],
    ['host-api 引用 zod', 'packages/host-api/src/x.ts', "import { z } from 'zod';", false],
    // 原有的规则没有被新的兜底规则顶掉
    ['引擎仍不能引用 React', 'packages/engine/src/x.ts', "import { useState } from 'react';", false],
    ['主进程仍能引用 template-sdk', 'apps/desktop/src/main/x.ts', "import { diagnosticOf } from '@allay/template-sdk';", true],
  ];
  it.each(cases)('%s', async (_name, path, code, allowed) => {
    const blocked = await blockedAs(path, code);
    expect(blocked.length === 0, blocked.join('; ')).toBe(allowed);
  });
});

describe('T-DEV-4 可选模块的目录可以为空或被删掉', () => {
  it('pnpm workspace 用通配符收可选模块：目录为空、不存在都是零个包', () => {
    const ws = readFileSync(join(ROOT, 'pnpm-workspace.yaml'), 'utf8');
    expect(ws).toMatch(/^\s*- packages\/optional\/\*\s*$/m);
  });

  it('现在 packages/optional 里没有任何模块（只有说明）', () => {
    const dir = join(ROOT, 'packages/optional');
    const entries = existsSync(dir) ? readdirSync(dir) : [];
    expect(entries.filter((e) => e !== 'README.md')).toEqual([]);
  });

  it('主程序的构建、类型检查、测试配置里没有点名可选模块', () => {
    // 只有依赖方向规则、workspace 配置、可选模块自己的说明和这份测试可以提到 packages/optional
    const files = [
      'package.json',
      'tsconfig.json',
      'tsconfig.base.json',
      'vitest.config.ts',
      'vitest.export.config.ts',
      'vitest.dist.config.ts',
      'playwright.config.ts',
      'playwright.engine.config.ts',
      'apps/desktop/package.json',
      'apps/desktop/electron.vite.config.ts',
      'apps/desktop/electron-builder.yml',
      'apps/desktop/tsconfig.node.json',
      'apps/desktop/tsconfig.web.json',
      'tests/engine/vite.config.ts',
    ];
    for (const f of files) {
      const text = readFileSync(join(ROOT, f), 'utf8');
      expect(/optional\//.test(text) || /@allay\/optional/.test(text), f).toBe(false);
    }
  });
});
