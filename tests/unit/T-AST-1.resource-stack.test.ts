import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  computeResourceStamp,
  listMerged,
  moveLayer,
  readResource,
  reorderLayers,
  resolveLayer,
  ResourceStackError,
  setLayerEnabled,
  type ResourceLayer,
} from '../../packages/assets/src/index';
import { openBuiltinLayer, openFolderPack, openZipPack, type ClosableLayer } from '../../apps/desktop/src/main/resources';
import { packMcmeta, solidPng, tex, writeFiles, writeZip } from './helpers/resource-fixtures';

// T-AST-1：三个夹具资源包（各自覆盖不同贴图），测试叠加顺序、开关、重排。

let dir: string;
let builtin: ClosableLayer;
let A: ClosableLayer;
let B: ClosableLayer;
let C: ClosableLayer;

const COLORS = { builtin: '#808080', A: '#ff0000', B: '#00ff00', C: '#0000ff' } as const;

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), 'allay-t-ast-1-'));
  // A（文件夹）：stone、dirt；B（zip）：stone、cobblestone；C（文件夹）：dirt、sand
  writeFiles(join(dir, 'A'), { 'pack.mcmeta': packMcmeta('Pack A'), [tex('stone')]: solidPng(COLORS.A), [tex('dirt')]: solidPng(COLORS.A) });
  writeZip(join(dir, 'B.zip'), [
    { name: 'pack.mcmeta', data: packMcmeta('§aPack B', 34) },
    { name: 'assets/', data: '' },
    { name: tex('stone'), data: solidPng(COLORS.B), method: 'deflate' },
    { name: tex('cobblestone'), data: solidPng(COLORS.B) },
  ]);
  writeFiles(join(dir, 'C'), { [tex('dirt')]: solidPng(COLORS.C), [tex('sand')]: solidPng(COLORS.C) });
  // 内置层是通用的目录层：这里用夹具目录充当，提供全部五张贴图
  writeFiles(join(dir, 'builtin'), Object.fromEntries(IDS.map((id) => [tex(id), solidPng(COLORS.builtin)])));
  builtin = await openBuiltinLayer(join(dir, 'builtin'));
  A = await openFolderPack(join(dir, 'A'), 'pack:A');
  B = await openZipPack(join(dir, 'B.zip'), 'pack:B');
  C = await openFolderPack(join(dir, 'C'), 'pack:C');
});

afterAll(() => {
  for (const l of [builtin, A, B, C]) l?.close();
  rmSync(dir, { recursive: true, force: true });
});

const IDS = ['stone', 'dirt', 'cobblestone', 'sand', 'gravel'] as const;

function table(stack: readonly ResourceLayer[]): Record<string, string | null> {
  return Object.fromEntries(IDS.map((id) => [id, resolveLayer(stack, tex(id))?.id ?? null]));
}

describe('T-AST-1 资源栈的叠加、开关、重排', () => {
  it('读出包的元数据', () => {
    expect(A.description).toBe('Pack A');
    expect(A.packFormat).toBe(46);
    expect(B.description).toBe('Pack B');
    expect(B.packFormat).toBe(34);
    expect(C.description).toBeUndefined();
    expect(builtin.kind).toBe('builtin');
  });

  it('叠加顺序：上层优先，缺的退到下层，最后是 builtin', async () => {
    const stack = [builtin, A, B, C];
    expect(table(stack)).toEqual({ stone: 'pack:B', dirt: 'pack:C', cobblestone: 'pack:B', sand: 'pack:C', gravel: 'builtin' });
    const stone = await readResource(stack, tex('stone'));
    expect(stone?.layerId).toBe('pack:B');
    expect(Buffer.from(stone?.data ?? []).equals(Buffer.from(solidPng(COLORS.B)))).toBe(true);
  });

  it('开关：关掉 C 后 dirt 退回 A，sand 退回 builtin；builtin 不能关', () => {
    const stack = setLayerEnabled([builtin, A, B, C], 'pack:C', false);
    expect(table(stack)).toEqual({ stone: 'pack:B', dirt: 'pack:A', cobblestone: 'pack:B', sand: 'builtin', gravel: 'builtin' });
    const all = setLayerEnabled(setLayerEnabled(stack, 'pack:A', false), 'pack:B', false);
    expect(table(all)).toEqual({ stone: 'builtin', dirt: 'builtin', cobblestone: 'builtin', sand: 'builtin', gravel: 'builtin' });
    expect(() => setLayerEnabled(stack, 'builtin', false)).toThrow(ResourceStackError);
  });

  it('重排：把 A 移到最上面；按给定顺序重排', () => {
    const top = moveLayer([builtin, A, B, C], 'pack:A', 3);
    expect(top.map((l) => l.id)).toEqual(['builtin', 'pack:B', 'pack:C', 'pack:A']);
    expect(table(top)).toEqual({ stone: 'pack:A', dirt: 'pack:A', cobblestone: 'pack:B', sand: 'pack:C', gravel: 'builtin' });
    const re = reorderLayers([builtin, A, B, C], ['pack:C', 'pack:B', 'pack:A']);
    expect(table(re)).toEqual({ stone: 'pack:A', dirt: 'pack:A', cobblestone: 'pack:B', sand: 'pack:C', gravel: 'builtin' });
    // 不能移到 builtin 下面，builtin 也不能移动
    expect(moveLayer([builtin, A, B, C], 'pack:C', -5).map((l) => l.id)).toEqual(['builtin', 'pack:C', 'pack:A', 'pack:B']);
    expect(() => moveLayer([builtin, A], 'builtin', 1)).toThrow(ResourceStackError);
  });

  it('resourceStamp 随顺序、开关变化，同样的状态得到同样的值', () => {
    const base = computeResourceStamp([builtin, A, B, C]);
    expect(computeResourceStamp([builtin, A, B, C])).toBe(base);
    expect(computeResourceStamp(setLayerEnabled([builtin, A, B, C], 'pack:A', false))).not.toBe(base);
    expect(computeResourceStamp(moveLayer([builtin, A, B, C], 'pack:A', 3))).not.toBe(base);
    expect(computeResourceStamp([builtin, A, B, { ...C, revision: `${C.revision}x` }])).not.toBe(base);
    expect(base).toMatch(/^[0-9a-f]{16}$/);
  });

  it('内置目录不存在时是空层，资源栈照常工作', async () => {
    const empty = await openBuiltinLayer(join(dir, 'no-such-dir'));
    expect(empty.revision).toBe('empty');
    expect(table([empty, A, B, C])).toEqual({ stone: 'pack:B', dirt: 'pack:C', cobblestone: 'pack:B', sand: 'pack:C', gravel: null });
    expect(await readResource([empty], tex('gravel'))).toBeNull();
  });

  it('合并列表，非法路径直接解析不到', () => {
    const merged = listMerged([builtin, A, B, C], 'assets/minecraft/textures/block/s');
    expect(merged).toContain(tex('sand'));
    expect(merged).toContain(tex('stone'));
    expect(resolveLayer([builtin, A], '../outside.png')).toBeNull();
    expect(resolveLayer([builtin, A], 'assets\\minecraft\\x.png')).toBeNull();
  });
});
