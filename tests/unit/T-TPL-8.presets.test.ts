// T-TPL-8：预设保存后再加载；模板升级增删参数后加载旧预设（docs/04-templates.md 4.7、4.11）。
// 判定：参数一致；多余的丢弃、缺的补默认值。端到端的往返（界面 → 主进程 → 界面）在 tests/e2e/m3.spec.ts。
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PresetStore } from '../../apps/desktop/src/main/templates/preset-store';
import { applyPreset, createPreset, localizePresetParams, parseManifest, parsePreset, sanitizeParams, type ParamDef } from '../../packages/template-sdk/src/index';
import { log } from './helpers/template-fixtures';

const T1 = (() => {
  const r = parseManifest(JSON.parse(readFileSync(join(import.meta.dirname, '../../packages/templates/block-wipe/manifest.json'), 'utf8')));
  if (!r.ok) throw new Error('T1 manifest invalid');
  return r.manifest;
})();
const defs = T1.params!;

let root: string;
let store: PresetStore;
beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'allay-tpl8-'));
  store = new PresetStore(root, log, () => new Date('2026-11-13T08:00:00Z'));
});
afterAll(() => rmSync(root, { recursive: true, force: true }));

const current = sanitizeParams(defs, { cols: 16, inPattern: 'diagonal', blocks: [{ id: 'minecraft:gold_block', weight: 2 }], easing: [0.2, 0, 0.3, 1.4], seed: 42 });

describe('T-TPL-8 预设', () => {
  it('只存与默认值不同的参数；保存后再加载，参数一致', async () => {
    const preset = createPreset({ id: T1.id, version: T1.version }, '蓝钻中心扩散', defs, current, new Date('2026-11-13T08:00:00Z'));
    expect(Object.keys(preset.params).sort()).toEqual(['blocks', 'cols', 'easing', 'inPattern', 'seed']);
    const saved = await store.save({ template: preset.template, name: preset.name, params: preset.params });
    const listed = await store.list();
    expect(listed).toHaveLength(1);
    expect(listed[0]).toEqual(saved);
    expect(applyPreset(defs, listed[0]!)).toEqual(current);
    // 文件格式（4.7）
    const raw = JSON.parse(readFileSync(join(root, 'presets', `${saved.id}.allaypreset`), 'utf8'));
    expect(raw).toEqual({ formatVersion: 1, template: { id: T1.id, version: '1.0.0' }, name: '蓝钻中心扩散', params: preset.params, createdAt: '2026-11-13T08:00:00.000Z' });
  });

  it('模板升级（删一个参数、加一个参数、改一个参数的类型和范围）后加载旧预设：多余的丢弃，缺的补默认值，不合法的回到默认值', () => {
    const old = createPreset({ id: T1.id, version: T1.version }, 'old', defs, { ...current, jitter: 0.4, volume: 0.9 }, new Date());
    const upgraded: ParamDef[] = defs
      .filter((d) => d.key !== 'jitter')
      .map((d): ParamDef => (d.key === 'cols' ? { ...d, max: 12 } : d.key === 'volume' ? { key: 'volume', type: 'enum', label: 'v', default: 'mid', options: [{ value: 'low', label: 'l' }, { value: 'mid', label: 'm' }] } : d))
      .concat([{ key: 'shadow', type: 'boolean', label: 's', default: true }]);
    const loaded = applyPreset(upgraded, old);
    expect(Object.keys(loaded).sort()).toEqual(upgraded.map((d) => d.key).sort());
    expect(loaded).not.toHaveProperty('jitter');
    expect(loaded.shadow).toBe(true);
    expect(loaded.cols).toBe(12);
    expect(loaded.volume).toBe('mid');
    expect(loaded.inPattern).toBe('diagonal');
    expect(loaded.seed).toBe(42);
  });

  it('导入：合法的另存一份，坏的给出原因；删除', async () => {
    const good = join(root, 'good.allaypreset');
    writeFileSync(good, JSON.stringify({ formatVersion: 1, template: { id: T1.id, version: '1.0.0' }, name: 'x', params: { cols: 8 }, createdAt: '2026-11-13T08:00:00Z' }));
    const r = await store.importFrom(good);
    expect(r).toMatchObject({ ok: true, entry: { name: 'x', params: { cols: 8 } } });
    for (const [content, why] of [
      ['{ nope', /JSON/],
      [JSON.stringify({ formatVersion: 2, template: { id: T1.id, version: '1.0.0' }, name: 'x', params: {}, createdAt: '2026-11-13T08:00:00Z' }), /format-too-new/],
      [JSON.stringify({ formatVersion: 1, template: { id: 'Bad', version: '1' }, name: '', params: {}, createdAt: 'yesterday' }), /template|name|createdAt/],
    ] as const) {
      const f = join(root, 'bad.allaypreset');
      writeFileSync(f, content);
      const res = await store.importFrom(f);
      expect(res.ok).toBe(false);
      if (!res.ok) expect(res.error).toMatch(why);
    }
    expect(await store.list()).toHaveLength(2);
    if (r.ok) expect(await store.remove(r.entry.id)).toBe(true);
    expect(await store.list()).toHaveLength(1);
    expect(await store.contents('0'.repeat(32))).toBeNull();
    await expect(store.remove('../settings')).rejects.toThrow();
  });

  it('parsePreset 走迁移框架：更高的格式版本拒绝', () => {
    expect(parsePreset({ formatVersion: 9 })).toEqual({ ok: false, error: 'format-too-new' });
  });

  it('模板自带的预设里，文字参数可以写成双语对象：套用时按界面语言取，缺一种语言时退回另一种；普通字符串照旧', () => {
    const manifest = (presets: unknown[]) => ({
      formatVersion: 1,
      id: 'test.bilingual-presets',
      version: '1.0.0',
      name: 'test',
      category: 'overlay',
      params: [
        { key: 'title', type: 'text', label: 'Title', default: { 'zh-CN': '第 1 天', en: 'Day 1' }, maxLength: 12 },
        { key: 'count', type: 'integer', label: 'Count', default: 1, min: 0, max: 9 },
      ],
      presets,
    });
    const r = parseManifest(
      manifest([
        { key: 'day-100', name: { 'zh-CN': '第 100 天', en: 'Day 100' }, params: { title: { 'zh-CN': '第 100 天', en: 'Day 100' }, count: 3 } },
        { key: 'zh-only', name: 'zh', params: { title: { 'zh-CN': '只有中文' } } },
        { key: 'plain', name: 'plain', params: { title: 'Plain text' } },
        { key: 'too-long', name: 'long', params: { title: { 'zh-CN': '一二三四五六七八九十甲乙丙丁', en: 'abcdefghijklmnop' } } },
      ]),
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const [day100, zhOnly, plain, tooLong] = r.manifest.presets!;
    const defs2 = r.manifest.params!;
    expect(applyPreset(defs2, day100!, { locale: 'zh-CN' })).toEqual({ title: '第 100 天', count: 3 });
    expect(applyPreset(defs2, day100!, { locale: 'en' })).toEqual({ title: 'Day 100', count: 3 });
    // 没给语言时按英文；只有一种语言时退回那一种
    expect(applyPreset(defs2, day100!).title).toBe('Day 100');
    expect(applyPreset(defs2, zhOnly!, { locale: 'en' }).title).toBe('只有中文');
    expect(applyPreset(defs2, plain!, { locale: 'zh-CN' }).title).toBe('Plain text');
    // 取出来之后照常清洗：超过 maxLength 的截断
    expect(applyPreset(defs2, tooLong!, { locale: 'zh-CN' }).title).toBe('一二三四五六七八九十甲乙');
    expect(localizePresetParams(defs2, day100!.params, 'zh-CN')).toEqual({ title: '第 100 天', count: 3 });

    // 写成对象但不是合法的多语言文字：manifest 校验不过，指出是哪个预设的哪个参数
    for (const bad of [{ fr: 'Jour 1' }, { en: 5 }, { 'zh-CN': '第 1 天', en: 'Day 1', ja: '1日目' }]) {
      const res = parseManifest(manifest([{ key: 'bad', name: 'bad', params: { title: bad } }]));
      expect(res.ok, JSON.stringify(bad)).toBe(false);
      if (!res.ok) expect(res.issues.map((i) => i.path)).toContain('presets.0.params.title');
    }
    // 其他类型的参数写成对象不归这条管：照旧交给清洗（回到默认值）
    expect(parseManifest(manifest([{ key: 'odd', name: 'odd', params: { count: { en: 1 } } }])).ok).toBe(true);

    // 用户自己存的预设不变：文字照旧存成当时界面语言下的普通字符串
    const saved = createPreset({ id: 'test.bilingual-presets', version: '1.0.0' }, 'mine', defs2, applyPreset(defs2, day100!, { locale: 'en' }), new Date('2026-11-22T00:00:00Z'), { locale: 'en' });
    expect(saved.params).toEqual({ title: 'Day 100', count: 3 });
  });
});
