import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import mainEn from '../../apps/desktop/src/renderer/i18n/locales/en.json';
import mainZhCN from '../../apps/desktop/src/renderer/i18n/locales/zh-CN.json';
import studioEn from '../../apps/desktop/src/renderer/i18n/locales/studio/en.json';
import studioZhCN from '../../apps/desktop/src/renderer/i18n/locales/studio/zh-CN.json';
import { brandMessages } from '../../packages/ui/src/brand/messages';

// 主文案和开发模式、动画编辑器的文案（studio/）合起来就是界面的全部文案；两边的顶层键不得重名
const en = { ...mainEn, ...studioEn };
const zhCN = { ...mainZhCN, ...studioZhCN };

const ROOT = resolve(import.meta.dirname, '../..');

function keys(obj: unknown, prefix = ''): string[] {
  if (typeof obj !== 'object' || obj === null) return [prefix];
  return Object.entries(obj).flatMap(([k, v]) => keys(v, prefix ? `${prefix}.${k}` : k));
}

function values(obj: unknown): string[] {
  if (typeof obj === 'string') return [obj];
  if (typeof obj !== 'object' || obj === null) return [];
  return Object.values(obj).flatMap(values);
}

describe('i18n（6.9）', () => {
  it('studio 文案的顶层键不与主文案重名', () => {
    for (const k of Object.keys(studioEn)) expect(Object.keys(mainEn)).not.toContain(k);
  });
  it('两种语言的文案键完全一致', () => {
    expect(keys(zhCN).sort()).toEqual(keys(en).sort());
    expect(Object.keys(brandMessages['zh-CN']).sort()).toEqual(Object.keys(brandMessages.en).sort());
  });
  it('没有空文案', () => {
    for (const v of [...values(zhCN), ...values(en), ...values(brandMessages)]) expect(v.trim()).not.toBe('');
  });
  it('源码里用到的文案键都存在', () => {
    const files = walk(join(ROOT, 'apps/desktop/src/renderer')).filter((f) => /\.tsx?$/.test(f));
    const used = new Set<string>();
    for (const f of files) {
      for (const m of readFileSync(f, 'utf8').matchAll(/\bt\(\s*['"`]([\w.]+)['"`]/g)) used.add(m[1]!);
    }
    expect(used.size).toBeGreaterThan(5);
    const known = new Set([...keys(en), ...Object.keys(brandMessages.en).map((k) => `brand.${k}`)]);
    expect([...used].filter((k) => !known.has(k))).toEqual([]);
  });
  it('编辑器控件（packages/ui/src/editor）用到的文案键都在 editor. 下面', () => {
    const files = walk(join(ROOT, 'packages/ui/src/editor')).filter((f) => /\.tsx?$/.test(f));
    const used = new Set<string>();
    for (const f of files) for (const m of readFileSync(f, 'utf8').matchAll(/\beditor\.t\(\s*['"`]([\w.]+)['"`]/g)) used.add(`editor.${m[1]!}`);
    expect(used.size).toBeGreaterThan(10);
    const known = new Set(keys(en));
    expect([...used].filter((k) => !known.has(k))).toEqual([]);
  });
  it('非官方声明符合 9.5', () => {
    const official = 'NOT AN OFFICIAL MINECRAFT PRODUCT. NOT APPROVED BY OR ASSOCIATED WITH MOJANG OR MICROSOFT.';
    expect(brandMessages.en.disclaimer).toBe(official);
    expect(brandMessages['zh-CN'].disclaimer).toBe(`${official}\n本软件不是 Minecraft 官方产品，未经 Mojang 或 Microsoft 批准，也与它们无关。`);
  });
});

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (name === 'node_modules' || name === 'out') return [];
    return statSync(full).isDirectory() ? walk(full) : [full];
  });
}

/** 去掉注释，只看会出现在界面上的东西 */
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1')
    .replace(/<!--[\s\S]*?-->/g, '');
}

// 9.4：产品名和“悦灵”只出现在 packages/mascot 和 packages/ui/src/brand/
describe('品牌资产只在品牌目录里（9.4）', () => {
  const BRAND_DIRS = ['packages/mascot/', 'packages/ui/src/brand/'];
  const NAMES = /Allay Motion|悦灵/;

  it('界面源码和文案里不写死产品名', () => {
    const files = [...walk(join(ROOT, 'apps/desktop/src')), ...walk(join(ROOT, 'packages/ui/src'))]
      .map((f) => relative(ROOT, f).replace(/\\/g, '/'))
      .filter((f) => /\.(tsx?|json|html|css)$/.test(f))
      .filter((f) => !BRAND_DIRS.some((d) => f.startsWith(d)));
    expect(files.length).toBeGreaterThan(10);
    const offenders = files.filter((f) => NAMES.test(stripComments(readFileSync(join(ROOT, f), 'utf8'))));
    expect(offenders).toEqual([]);
  });
});
