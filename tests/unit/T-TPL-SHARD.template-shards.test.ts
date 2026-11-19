// 内置模板验收测试的分片与挑选（tests/engine/shard.ts，docs/template-catalog.md 4.3）。
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
