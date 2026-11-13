// T-TPL-7：派生模板——覆盖默认值、隐藏参数、引用自带图片。装载结果符合 docs/04-templates.md 4.7。
// 引擎里真的画出自带图片的那一半在 e2e（tests/e2e/m3.spec.ts）。
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { TemplateService } from '../../apps/desktop/src/main/templates/service';
import { DeriveError, effectiveManifest, parseManifest, resolveDerived, sanitizeParams, type TemplateManifest } from '../../packages/template-sdk/src/index';
import { solidPng } from './helpers/resource-fixtures';
import { BASE_CODE, baseManifest, basePackage, buildBuiltins, derivedManifest, derivedPackage, makeService, writePackage } from './helpers/template-fixtures';

const parse = (raw: unknown): TemplateManifest => {
  const r = parseManifest(raw);
  if (!r.ok) throw new Error(JSON.stringify(r.issues));
  return r.manifest;
};

describe('T-TPL-7 派生模板的解析（template-sdk）', () => {
  const base = parse(baseManifest());

  it('覆盖默认值经参数校验清洗：越界钳制、类型不对回到基模板的默认值、不认识的键丢弃', () => {
    const r = resolveDerived(parse(derivedManifest()), base);
    const byKey = Object.fromEntries(r.params.map((p) => [p.key, p.default]));
    expect(byKey).toEqual({ logo: 'asset:logo.png', size: 10, mode: 'a', seed: 1 });
    expect(r.params.map((p) => p.key)).toEqual(['logo', 'size', 'mode', 'seed']);
    expect(r.codeFrom).toEqual({ id: 'user.test.base', version: '1.2.0' });
  });

  it('隐藏的参数不显示、取覆盖后的默认值；不认识的隐藏键忽略', () => {
    const r = resolveDerived(parse(derivedManifest()), base);
    expect(r.hidden).toEqual(['size']);
    expect(sanitizeParams(r.params, {})).toMatchObject({ size: 10, logo: 'asset:logo.png' });
  });

  it('生效 manifest 带基模板的参数定义和时间段，不再有 extends', () => {
    const m = effectiveManifest(resolveDerived(parse(derivedManifest()), base));
    expect(m.extends).toBeUndefined();
    expect(m.overrides).toBeUndefined();
    expect(m.id).toBe('user.test.derived');
    expect(parseManifest(m).ok).toBe(true);
  });

  it('只允许派生一层；基模板版本须满足范围', () => {
    const derived = parse(derivedManifest());
    expect(() => resolveDerived(derived, parse(derivedManifest({ id: 'user.test.base', version: '1.5.0', extends: { id: 'allay.x.y', version: '*' } })))).toThrow(DeriveError);
    expect(() => resolveDerived(derived, parse(baseManifest({ version: '2.0.0' })))).toThrow(/needs/);
  });
});

describe('T-TPL-7 派生模板的安装与装载（主进程）', () => {
  let root: string;
  let svc: TemplateService;

  beforeAll(async () => {
    root = mkdtempSync(join(tmpdir(), 'allay-tpl7-'));
    await buildBuiltins(join(root, 'builtin'));
    svc = await makeService(join(root, 'user'), join(root, 'builtin'));
    for (const pkg of [basePackage({}, { 'assets/logo.png': solidPng('#0000ff') }), derivedPackage({}, { 'assets/img/extra.png': solidPng('#ffff00') })]) {
      const r = await svc.stage(writePackage(join(root, 'in', `${Math.random()}.allaytpl`), pkg));
      if (!('ok' in r) || !r.ok) throw new Error(JSON.stringify(r));
      const c = await svc.commit(r.stagingId, { warnings: [] });
      if (!c.ok) throw new Error(JSON.stringify(c));
    }
  }, 60_000);

  afterAll(() => rmSync(root, { recursive: true, force: true }));

  it('read 返回基模板的代码和套上覆盖的参数定义', async () => {
    const b = await svc.read('user.test.derived', '1.0.0');
    expect(b).not.toBeNull();
    expect(b!.code).toBe(BASE_CODE);
    expect(b!.entry).toMatchObject({ kind: 'derived', baseMissing: false });
    expect(b!.resolved.hidden).toEqual(['size']);
    expect(b!.resolved.params.find((p) => p.key === 'logo')?.default).toBe('asset:logo.png');
  });

  it('自带图片：asset: 先找派生模板自己的，再找基模板的；路径不能穿越', async () => {
    const own = await svc.readAsset({ id: 'user.test.derived', version: '1.0.0' }, 'logo.png');
    expect(Buffer.from(own!).equals(Buffer.from(solidPng('#ff0000')))).toBe(true);
    expect(await svc.readAsset({ id: 'user.test.derived', version: '1.0.0' }, 'img/extra.png')).not.toBeNull();
    const fromBase = await svc.readAsset({ id: 'user.test.derived', version: '1.0.0' }, 'base-only.png');
    expect(Buffer.from(fromBase!).equals(Buffer.from(solidPng('#00ff00')))).toBe(true);
    // 基模板自己的 logo 是蓝色，不受派生模板影响
    const baseLogo = await svc.readAsset({ id: 'user.test.base', version: '1.2.0' }, 'logo.png');
    expect(Buffer.from(baseLogo!).equals(Buffer.from(solidPng('#0000ff')))).toBe(true);
    for (const bad of ['../manifest.json', '../../base/1.2.0/template.js', '/etc/passwd', 'C:\\x.png', 'img/../logo.png', '']) {
      expect(await svc.readAsset({ id: 'user.test.derived', version: '1.0.0' }, bad), bad).toBeNull();
    }
    expect(await svc.readAsset({ id: 'user.nobody.x', version: '1.0.0' }, 'logo.png')).toBeNull();
  });

  it('另存为派生模板：基于内置 T1，覆盖默认值、隐藏参数', async () => {
    const r = await svc.saveDerived({ base: { id: 'allay.builtin.block-wipe', version: '1.0.0' }, name: '蓝钻擦除 Blue', defaults: { cols: 16, blocks: [{ id: 'minecraft:diamond_block', weight: 1 }], nope: 1, inDuration: 99 }, hidden: ['placeSound', 'breakSound', 'nope'] });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.entry.id).toMatch(/^user\.[0-9a-f]{6}\.blue$/);
    const b = await svc.read(r.entry.id, '1.0.0');
    const defaults = Object.fromEntries(b!.resolved.params.map((p) => [p.key, p.default]));
    expect(defaults).toMatchObject({ cols: 16, inDuration: 2, style: '3d' });
    expect(b!.resolved.hidden).toEqual(['placeSound', 'breakSound']);
    expect(b!.resolved.timeline?.segments.map((s) => s.param)).toEqual(['inDuration', 'hold', 'outDuration']);
    expect(b!.entry.manifest.extends).toEqual({ id: 'allay.builtin.block-wipe', version: '^1.0.0' });
  });

  it('删除基模板后，派生模板保留但标记为“基模板缺失”，不能装载', async () => {
    expect(await svc.remove('user.test.base', '1.2.0')).toBe(true);
    const entry = svc.list().find((e) => e.id === 'user.test.derived');
    expect(entry).toMatchObject({ baseMissing: true });
    expect(await svc.read('user.test.derived', '1.0.0')).toBeNull();
    // 重新装上基模板后恢复
    const r = await svc.stage(writePackage(join(root, 'in', 'again.allaytpl'), basePackage()));
    if (!('ok' in r) || !r.ok) throw new Error('stage failed');
    await svc.commit(r.stagingId, { warnings: [] });
    expect(svc.list().find((e) => e.id === 'user.test.derived')).toMatchObject({ baseMissing: false });
  });
});
