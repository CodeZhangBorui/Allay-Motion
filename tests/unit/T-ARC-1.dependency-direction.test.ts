import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { ESLint } from 'eslint';
import { describe, expect, it } from 'vitest';

// T-ARC-1：依赖方向。正常代码通过 lint；故意违规的夹具（引擎里导入 React）被拦下。

const ROOT = resolve(import.meta.dirname, '../..');
const RULE = '@typescript-eslint/no-restricted-imports';
const eslint = new ESLint({ cwd: ROOT });

async function lintAs(virtualPath: string, code: string) {
  const [result] = await eslint.lintText(code, { filePath: join(ROOT, virtualPath) });
  return (result?.messages ?? []).filter((m) => m.ruleId === RULE);
}

describe('T-ARC-1 依赖方向', () => {
  // 整仓 lint 的耗时随仓库变大：GitHub 的机器上 17 个模板时就要 17 秒，38 个模板时在开发机上忙的时候超过了默认的 30 秒。
  // 这是 v0.3.0 发版前的最小处理（给够时限）；发版后要改成不随仓库大小变慢的做法（例如只 lint 依赖方向规则管到的入口）
  it('正常代码通过 lint', async () => {
    const results = await eslint.lintFiles(['apps/desktop/src', 'packages', 'scripts', 'tests']);
    const errors = results.flatMap((r) => r.messages.filter((m) => m.severity === 2).map((m) => `${r.filePath}:${m.line} ${m.ruleId} ${m.message}`));
    expect(errors).toEqual([]);
    // 确实检查到了各个包
    const linted = results.map((r) => r.filePath.replace(/\\/g, '/'));
    for (const dir of ['packages/engine/src', 'packages/template-sdk/src', 'packages/ui/src', 'apps/desktop/src/main', 'apps/desktop/src/renderer']) {
      expect(linted.some((f) => f.includes(dir)), dir).toBe(true);
    }
  }, 120_000);

  it('故意违规的夹具：引擎里导入 React，被拦下', async () => {
    const code = readFileSync(join(ROOT, 'tests/fixtures/lint/engine-imports-react.ts'), 'utf8');
    const messages = await lintAs('packages/engine/src/__violation__.ts', code);
    expect(messages).toHaveLength(1);
    expect(messages[0]?.message).toContain('engine');
  });

  // 1.4 表格里其余的方向
  const cases: [string, string, string, boolean][] = [
    ['engine 导入 Electron', 'packages/engine/src/x.ts', "import { app } from 'electron';", false],
    ['engine 导入 Node', 'packages/engine/src/x.ts', "import { readFile } from 'node:fs/promises';", false],
    ['engine 导入 three 与 template-sdk', 'packages/engine/src/x.ts', "import * as THREE from 'three';\nimport type { X } from '@allay/template-sdk';", true],
    ['engine 使用 DOM 全局', 'packages/engine/src/x.ts', 'export const d = document.title;', false],
    ['template-sdk 导入 three 的类型', 'packages/template-sdk/src/x.ts', "import type { Object3D } from 'three';", true],
    ['template-sdk 导入 three 的运行时', 'packages/template-sdk/src/x.ts', "import { Object3D } from 'three';", false],
    ['template-sdk 导入 zod', 'packages/template-sdk/src/x.ts', "import { z } from 'zod';", true],
    ['template-sdk 导入 assets', 'packages/template-sdk/src/x.ts', "import { x } from '@allay/assets';", false],
    ['assets 导入 three', 'packages/assets/src/x.ts', "import { Texture } from 'three';", false],
    ['assets 导入 Node', 'packages/assets/src/x.ts', "import { join } from 'path';", false],
    ['模板导入 template-sdk 的类型', 'packages/templates/block-wipe/src/x.ts', "import type { TemplateModule } from '@allay/template-sdk';", true],
    ['模板导入 template-sdk 的运行时', 'packages/templates/block-wipe/src/x.ts', "import { defineTemplate } from '@allay/template-sdk';", false],
    ['模板导入 three 的运行时', 'packages/templates/block-wipe/src/x.ts', "import * as THREE from 'three';", false],
    ['模板导入本目录的文件', 'packages/templates/block-wipe/src/x.ts', "import { arrangeCells } from './arrangement';", true],
    ['模板导入共用的 _lib', 'packages/templates/block-wipe/src/x.ts', "import { progress } from '../../_lib/src/timing';", true],
    ['模板导入另一个模板的文件', 'packages/templates/block-wipe/src/x.ts', "import { arrangeCells } from '../../block-fall/src/arrangement';", false],
    ['_lib 导入 template-sdk 的运行时', 'packages/templates/_lib/src/x.ts', "import { sanitizeParams } from '@allay/template-sdk';", false],
    ['ui 导入 engine', 'packages/ui/src/x.ts', "import { x } from '@allay/engine';", false],
    ['ui 导入 Electron', 'packages/ui/src/x.ts', "import { ipcRenderer } from 'electron';", false],
    ['ui 导入 Base UI', 'packages/ui/src/x.ts', "import { Button } from '@base-ui/react/button';", true],
    ['mascot 导入 engine 内部', 'packages/mascot/src/x.ts', "import { x } from '@allay/engine/src/pipeline';", false],
    ['mascot 导入 template-sdk 运行时', 'packages/mascot/src/x.ts', "import { x } from '@allay/template-sdk';", false],
    ['渲染进程导入 Electron', 'apps/desktop/src/renderer/x.ts', "import { ipcRenderer } from 'electron';", false],
    ['渲染进程导入 Node', 'apps/desktop/src/renderer/x.ts', "import { readFileSync } from 'fs';", false],
    ['渲染进程导入 preload 的类型', 'apps/desktop/src/renderer/x.ts', "import type { AllayApi } from '../preload/api';", true],
    ['渲染进程导入 preload 的运行时', 'apps/desktop/src/renderer/x.ts', "import { x } from '../preload/index';", false],
    ['主进程导入 React', 'apps/desktop/src/main/x.ts', "import { useState } from 'react';", false],
    ['主进程导入 engine', 'apps/desktop/src/main/x.ts', "import { x } from '@allay/engine';", false],
    ['主进程导入 template-sdk', 'apps/desktop/src/main/x.ts', "import { x } from '@allay/template-sdk';", true],
  ];
  it.each(cases)('%s', async (_name, path, code, allowed) => {
    const [result] = await eslint.lintText(code, { filePath: join(ROOT, path) });
    const blocked = (result?.messages ?? []).filter((m) => m.ruleId === RULE || m.ruleId === 'no-restricted-globals');
    expect(blocked.length === 0, blocked.map((m) => m.message).join('; ')).toBe(allowed);
  });
});
