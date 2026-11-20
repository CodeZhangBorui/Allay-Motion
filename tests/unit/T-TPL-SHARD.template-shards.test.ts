// 内置模板验收测试的分片与挑选（tests/engine/shard.ts，docs/template-catalog.md 4.3）。
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseShard, selectionFromEnv, selectTemplateIds } from '../engine/shard';

const IDS = Array.from({ length: 100 }, (_, i) => `allay.builtin.t${String(i).padStart(3, '0')}`);

describe('T-TPL-SHARD 内置模板验收测试的分片', () => {
  it('不设环境变量：全部，按 id 排序', () => {
    expect(selectTemplateIds(['b.y', 'a.x'], selectionFromEnv({}))).toEqual(['a.x', 'b.y']);
    expect(selectTemplateIds(IDS, { shard: '', only: '' })).toEqual(IDS);
  });

  it('n 份合起来正好是全部，互不重叠，大小相差不超过 1', () => {
    for (const total of [1, 2, 4, 7, 16]) {
      const parts = Array.from({ length: total }, (_, i) => selectTemplateIds(IDS, { shard: `${i + 1}/${total}` }));
      expect(parts.flat().sort()).toEqual(IDS);
      expect(new Set(parts.flat()).size).toBe(IDS.length);
      const sizes = parts.map((p) => p.length);
      expect(Math.max(...sizes) - Math.min(...sizes)).toBeLessThanOrEqual(1);
    }
  });

  it('模板比份数少时，多出来的份是空的，不报错', () => {
    const six = IDS.slice(0, 6);
    expect(selectTemplateIds(six, { shard: '8/8' })).toEqual([]);
    expect(selectTemplateIds(six, { shard: '1/8' })).toEqual([six[0]]);
  });

  it('只跑指定的模板：完整 id 或最后一段都行；再分片时先挑后分', () => {
    const ids = ['allay.builtin.block-wipe', 'allay.builtin.block-fall', 'allay.builtin.pixel-dissolve'];
    expect(selectTemplateIds(ids, { only: 'block-wipe, allay.builtin.pixel-dissolve' })).toEqual(['allay.builtin.block-wipe', 'allay.builtin.pixel-dissolve']);
    expect(selectTemplateIds(ids, { only: 'block-wipe,pixel-dissolve', shard: '2/2' })).toEqual(['allay.builtin.pixel-dissolve']);
    // 最后一段要整段相等：wipe 不等于 block-wipe
    expect(() => selectTemplateIds(ids, { only: 'wipe' })).toThrow(/unknown templates: wipe/);
  });

  it('写错的分片直接报错，不悄悄跑全部', () => {
    for (const bad of ['0/4', '5/4', '2', 'a/b', '1/0', '-1/3']) expect(() => parseShard(bad), bad).toThrow(/ALLAY_TPL_SHARD/);
    expect(parseShard(' 3/4 ')).toEqual({ index: 3, total: 4 });
    expect(() => selectTemplateIds(IDS, { shard: 'nope' })).toThrow();
  });
});

describe('T-TPL-SHARD CI 的分片配置（.github/workflows/ci.yml）', () => {
  const yml = readFileSync(join(import.meta.dirname, '../../.github/workflows/ci.yml'), 'utf8');

  it('check 作业跑第 1 份，templates 作业的矩阵跑其余几份：合起来每一份正好一次', () => {
    const fixed = [...yml.matchAll(/ALLAY_TPL_SHARD:\s*(\d+)\/(\d+)/g)].map((m) => ({ index: Number(m[1]), total: Number(m[2]) }));
    const matrixTotal = /ALLAY_TPL_SHARD:\s*\$\{\{\s*matrix\.shard\s*\}\}\/(\d+)/.exec(yml);
    const matrix = /shard:\s*\[([\d,\s]+)\]/.exec(yml);
    expect(fixed).toHaveLength(1);
    expect(matrixTotal).not.toBeNull();
    expect(matrix).not.toBeNull();
    const total = fixed[0]!.total;
    expect(Number(matrixTotal![1])).toBe(total);
    const all = [fixed[0]!.index, ...matrix![1]!.split(',').map((s) => Number(s.trim()))].sort((a, b) => a - b);
    expect(all).toEqual(Array.from({ length: total }, (_, i) => i + 1));
    // 用这套份数挑出来的模板合起来是全部
    const picked = all.flatMap((i) => selectTemplateIds(IDS, { shard: `${i}/${total}` }));
    expect(picked.sort()).toEqual(IDS);
  });

  it('templates 作业跑的是只含模板测试的脚本，脚本里就是 test:engine 的同一套构建和配置', () => {
    const pkg = JSON.parse(readFileSync(join(import.meta.dirname, '../../package.json'), 'utf8')) as { scripts: Record<string, string> };
    expect(yml).toContain('run: pnpm test:engine:templates');
    const [build, run] = pkg.scripts['test:engine']!.split(' && ');
    expect(pkg.scripts['test:engine:templates']).toBe(`${build} && ${run} tests/engine/templates.spec.ts`);
  });
});
