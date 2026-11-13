import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { detectMinecraft, openVanillaLayer } from '../../apps/desktop/src/main/resources';
import { findMissing, requiredTextures } from '../../packages/assets/src/index';
import { catalogJarEntries, makeCatalogGame } from './helpers/resource-fixtures';

// 覆盖率检查（decisions.md M2a、M2b）：对测试脚本生成的假原版层全覆盖。
// 对本机真实 jar 的检查是手动冒烟脚本 scripts/smoke-vanilla.ts，不进 pnpm check。

let dir: string;
beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'allay-coverage-'));
});
afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe('覆盖率检查：假原版层', () => {
  it('方块目录、物品目录、界面贴图引用的贴图全部能从假原版层解析', async () => {
    const required = requiredTextures();
    expect(required.length).toBeGreaterThan(150);
    const game = join(dir, '.minecraft');
    makeCatalogGame(game, '9.9.9', '2030-01-01T00:00:00+00:00', catalogJarEntries(required.map((r) => ({ id: r.id, path: r.anyOf[0]! }))));
    const install = await detectMinecraft({ platform: 'win32', appData: dir, home: dir }, null);
    expect(install?.versionId).toBe('9.9.9');
    const layer = await openVanillaLayer(install!);
    try {
      expect(findMissing(required, layer.has).map((r) => r.id)).toEqual([]);
    } finally {
      layer.close();
    }
  });
});
