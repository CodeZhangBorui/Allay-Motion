// T-GAL-1 至 T-GAL-5：模板库的纯逻辑（apps/desktop/src/renderer/features/gallery/library.ts；
// docs/decisions.md“模板库撑到一百个模板”）。分组、类别、搜索、排序、键盘移动。
import { describe, expect, it } from 'vitest';
import {
  gridRows,
  groupOf,
  indexById,
  inCategory,
  itemKey,
  LIBRARY_GROUPS,
  libraryView,
  moveInGrid,
  ownGroup,
  prepareItems,
  queryTerms,
  type GroupLabels,
  type LibraryFilter,
} from '../../apps/desktop/src/renderer/features/gallery/library';
import type { TemplateEntry } from '../../apps/desktop/src/shared/templates';
import type { TemplateManifest } from '../../packages/template-sdk/src/index';

const LABELS: GroupLabels = {
  blocks: ['方块', 'Blocks'],
  items: ['物品与实体', 'Items & entities'],
  ui: ['原版界面', 'Game UI'],
  particles: ['粒子与天气', 'Particles & weather'],
  text: ['文字与字幕', 'Text & captions'],
  channel: ['频道包装', 'Channel branding'],
  shader: ['像素与着色器', 'Pixel & shader'],
  seasonal: ['节日与主题', 'Seasonal'],
  other: ['其他', 'Other'],
};

function entry(id: string, over: Partial<TemplateManifest> & { source?: 'builtin' | 'user'; version?: string } = {}): TemplateEntry {
  const { source = 'builtin', version = '1.0.0', ...m } = over;
  const manifest = { formatVersion: 1, id, version, name: id, category: 'transition', params: [], ...m } as TemplateManifest;
  return { id, version, source, kind: manifest.extends ? 'derived' : 'script', manifest, baseMissing: false, trialWarnings: [], contentHash: '0123456789abcdef' };
}

const ALL: LibraryFilter = { tab: 'all', group: 'all', query: '' };

describe('T-GAL-1 分组：tags 里第一个组名；派生模板随基模板；都没有归“其他”', () => {
  it('第一个组名算数，后面的组名只是搜索词', () => {
    expect(ownGroup(['ui', 'text', 'chat'])).toBe('ui');
    expect(ownGroup(['loading', 'ui', 'text', 'blocks'])).toBe('ui');
    expect(ownGroup(['toast', 'advancement'])).toBeNull();
    expect(ownGroup(undefined)).toBeNull();
  });
  it('现有六个内置模板补上组名之后各在目录 1.1–1.8 的组里', async () => {
    const { readFileSync } = await import('node:fs');
    const { join, resolve } = await import('node:path');
    const root = resolve(import.meta.dirname, '../..');
    const expected: Record<string, string> = { 'block-wipe': 'blocks', 'block-fall': 'blocks', 'item-stinger': 'items', 'loading-screen': 'ui', 'advancement-toast': 'ui', 'pixel-dissolve': 'shader' };
    for (const [dir, group] of Object.entries(expected)) {
      const m = JSON.parse(readFileSync(join(root, 'packages/templates', dir, 'manifest.json'), 'utf8')) as { tags?: string[] };
      expect(ownGroup(m.tags), dir).toBe(group);
    }
  });
  it('派生模板没写 tags 时随基模板（基模板装了几个版本时看最新的）；基模板缺失、都没有组名时归“其他”', () => {
    const base1 = entry('user.x.base', { tags: ['text'], version: '1.0.0', source: 'user' });
    const base2 = entry('user.x.base', { tags: ['channel'], version: '1.2.0', source: 'user' });
    const derived = entry('user.x.mine', { source: 'user', extends: { id: 'user.x.base', version: '^1.0.0' } });
    const lone = entry('user.x.lone', { source: 'user', tags: ['fun'] });
    const orphan = entry('user.x.orphan', { source: 'user', extends: { id: 'user.x.gone', version: '^1.0.0' } });
    const byId = indexById([base1, base2, derived, lone, orphan]);
    expect(groupOf(derived, byId)).toBe('channel');
    expect(groupOf(lone, byId)).toBe('other');
    expect(groupOf(orphan, byId)).toBe('other');
    // 派生模板自己写了组名时用自己的
    expect(groupOf(entry('user.x.own', { tags: ['seasonal'], extends: { id: 'user.x.base', version: '^1.0.0' } }), byId)).toBe('seasonal');
  });
});

describe('T-GAL-2 类别：全部、转场、叠加、标题、我的', () => {
  const t = entry('a.t.t', { category: 'transition' });
  const o = entry('a.t.o', { category: 'overlay' });
  const ti = entry('a.t.ti', { category: 'title' });
  const mine = entry('user.x.m', { category: 'title', source: 'user' });
  it('每个标签只留自己的', () => {
    expect([t, o, ti, mine].filter((e) => inCategory(e, 'all'))).toHaveLength(4);
    expect([t, o, ti, mine].filter((e) => inCategory(e, 'transition'))).toEqual([t]);
    expect([t, o, ti, mine].filter((e) => inCategory(e, 'overlay'))).toEqual([o]);
    expect([t, o, ti, mine].filter((e) => inCategory(e, 'title'))).toEqual([ti, mine]);
    expect([t, o, ti, mine].filter((e) => inCategory(e, 'mine'))).toEqual([mine]);
  });
  it('视图：标题类别和分组一起筛，计数按类别算、分组之前', () => {
    const items = prepareItems([t, o, ti, entry('a.t.ti2', { category: 'title', tags: ['text'] })], 'zh-CN', LABELS);
    const v = libraryView(items, { tab: 'title', group: 'text', query: '' });
    expect(v.shown).toBe(1);
    expect(v.inCategory).toBe(2);
    expect(v.groupCounts.text).toBe(1);
    expect(v.groupCounts.other).toBe(1);
    expect(v.sections.map((s) => s.group)).toEqual(['text']);
  });
});

describe('T-GAL-3 搜索：两种语言的名称、说明、组名、id、tags 都能搜到', () => {
  const wipe = entry('allay.builtin.block-wipe', { name: { 'zh-CN': '方块擦除', en: 'Block wipe' }, description: { 'zh-CN': '一格格方块铺满画面', en: 'Blocks cover the frame' }, tags: ['blocks', 'wipe'] });
  const toast = entry('allay.builtin.advancement-toast', { category: 'overlay', name: { 'zh-CN': '进度提示', en: 'Advancement toast' }, tags: ['ui', 'toast'] });
  const subtitle = entry('allay.builtin.sound-subtitles', { category: 'overlay', name: { 'zh-CN': '声音字幕', en: 'Subtitles' }, tags: ['ui', 'text'] });
  const items = prepareItems([wipe, toast, subtitle], 'zh-CN', LABELS);
  const found = (query: string, f: Partial<LibraryFilter> = {}) =>
    libraryView(items, { ...ALL, ...f, query })
      .sections.flatMap((s) => s.items)
      .map((i) => i.entry.id);
  it('中文名、英文名、说明（两种语言）', () => {
    expect(found('擦除')).toEqual([wipe.id]);
    expect(found('block wipe')).toEqual([wipe.id]);
    expect(found('ADVANCEMENT')).toEqual([toast.id]);
    expect(found('铺满')).toEqual([wipe.id]);
    expect(found('cover the frame')).toEqual([wipe.id]);
  });
  it('组名（两种语言）、id、tags', () => {
    expect(found('原版界面')).toEqual([toast.id, subtitle.id]);
    expect(found('game ui')).toEqual([toast.id, subtitle.id]);
    expect(found('sound-subtitles')).toEqual([subtitle.id]);
    expect(found('toast')).toEqual([toast.id]);
  });
  it('全角字母数字按半角比；几个词都要出现；空白不算', () => {
    expect(queryTerms('  ＢＬＯＣＫ　Ｗipe ')).toEqual(['block', 'wipe']);
    expect(found('ＢＬＯＣＫ')).toEqual([wipe.id]);
    expect(found('方块 字幕')).toEqual([]);
    expect(found('   ')).toHaveLength(3);
  });
  it('没有结果时知道“别的类别、分组里有几个”', () => {
    const v = libraryView(items, { tab: 'transition', group: 'all', query: '字幕' });
    expect(v.shown).toBe(0);
    expect(v.anywhere).toBe(1);
    const none = libraryView(items, { ...ALL, query: 'zzz' });
    expect(none.shown).toBe(0);
    expect(none.anywhere).toBe(0);
  });
});

describe('T-GAL-4 排序：组的顺序，组内按当前语言的名称；搜索结果是完整列表的子序列', () => {
  const names: [string, string, string, string][] = [
    ['allay.builtin.b', '方块坠落', 'Block fall', 'blocks'],
    ['allay.builtin.a', '方块擦除', 'Block wipe', 'blocks'],
    ['allay.builtin.c', '爆炸', 'Explosion', 'blocks'],
    ['allay.builtin.d', 'Boss 栏', 'Boss bar', 'ui'],
    ['allay.builtin.e', '进度提示', 'Advancement toast', 'ui'],
    ['allay.builtin.f', '像素溶解', 'Pixel dissolve', 'shader'],
    ['allay.builtin.g', '物品飞掠', 'Item stinger', 'items'],
    ['user.x.h', '我的模板 10', 'Mine 10', ''],
    ['user.x.i', '我的模板 9', 'Mine 9', ''],
  ];
  const entries = names.map(([id, zh, en, g]) => entry(id, { name: { 'zh-CN': zh, en }, tags: g ? [g] : [], source: id.startsWith('user.') ? 'user' : 'builtin' }));
  const order = (locale: string, f: Partial<LibraryFilter> = {}) =>
    libraryView(prepareItems(entries, locale, LABELS), { ...ALL, ...f })
      .sections.flatMap((s) => s.items)
      .map((i) => i.name);
  it('中文：组按目录的顺序，组内按拼音（ICU 的 zh 规则：汉字在拉丁字母前面）；数字按大小', () => {
    expect(order('zh-CN')).toEqual(['爆炸', '方块擦除', '方块坠落', '物品飞掠', '进度提示', 'Boss 栏', '像素溶解', '我的模板 9', '我的模板 10']);
  });
  it('英文：同样的组，组内按英文名', () => {
    expect(order('en')).toEqual(['Block fall', 'Block wipe', 'Explosion', 'Item stinger', 'Advancement toast', 'Boss bar', 'Pixel dissolve', 'Mine 9', 'Mine 10']);
  });
  it('段落按组，组的顺序固定', () => {
    const v = libraryView(prepareItems(entries, 'zh-CN', LABELS), ALL);
    expect(v.sections.map((s) => s.group)).toEqual(['blocks', 'items', 'ui', 'shader', 'other']);
    expect(LIBRARY_GROUPS.at(-1)).toBe('other');
  });
  it('输入的顺序不影响结果；搜索结果是完整列表的子序列（打字时卡片不跳）', () => {
    const shuffled = [...entries].reverse();
    const a = libraryView(prepareItems(entries, 'zh-CN', LABELS), ALL);
    const b = libraryView(prepareItems(shuffled, 'zh-CN', LABELS), ALL);
    expect(b.sections.flatMap((s) => s.items.map((i) => i.key))).toEqual(a.sections.flatMap((s) => s.items.map((i) => i.key)));
    const full = order('zh-CN');
    for (const q of ['方块', 'b', '模板', 'o']) {
      const sub = order('zh-CN', { query: q });
      expect(sub.length).toBeGreaterThan(0);
      expect(full.filter((n) => sub.includes(n))).toEqual(sub);
    }
  });
  it('同名的按 id；同一个模板的几个版本新的在前', () => {
    const twins = [entry('a.z.b', { name: '同名' }), entry('a.z.a', { name: '同名' }), entry('a.z.a', { name: '同名', version: '1.10.0' })];
    const keys = libraryView(prepareItems(twins, 'zh-CN', LABELS), ALL).sections.flatMap((s) => s.items.map((i) => i.key));
    expect(keys).toEqual(['a.z.a@1.10.0', 'a.z.a@1.0.0', 'a.z.b@1.0.0']);
    expect(itemKey({ id: 'a.z.a', version: '1.0.0' })).toBe('a.z.a@1.0.0');
  });
});

describe('T-GAL-5 键盘：方向键在卡片之间移动', () => {
  // 两组：第一组 3 张（两行：a b / c），第二组 2 张（d e）
  const rows = gridRows(
    [
      { group: 'blocks', items: ['a', 'b', 'c'].map((key) => ({ key })) as never },
      { group: 'ui', items: ['d', 'e'].map((key) => ({ key })) as never },
    ],
    2,
  );
  it('每组从新的一行开始', () => {
    expect(rows).toEqual([['a', 'b'], ['c'], ['d', 'e']]);
  });
  it('左右按阅读顺序，跨行、跨组；到头停住', () => {
    expect(moveInGrid(rows, 'b', 'ArrowRight')).toBe('c');
    expect(moveInGrid(rows, 'c', 'ArrowRight')).toBe('d');
    expect(moveInGrid(rows, 'd', 'ArrowLeft')).toBe('c');
    expect(moveInGrid(rows, 'a', 'ArrowLeft')).toBe('a');
    expect(moveInGrid(rows, 'e', 'ArrowRight')).toBe('e');
  });
  it('上下到同一列；那一行短就落在它的最后一张', () => {
    expect(moveInGrid(rows, 'b', 'ArrowDown')).toBe('c');
    expect(moveInGrid(rows, 'c', 'ArrowDown')).toBe('d');
    expect(moveInGrid(rows, 'e', 'ArrowUp')).toBe('c');
    expect(moveInGrid(rows, 'a', 'ArrowUp')).toBe('a');
    expect(moveInGrid(rows, 'd', 'ArrowDown')).toBe('d');
  });
  it('Home、End、PageUp、PageDown；不在列表里的落到第一张；空列表为 null', () => {
    expect(moveInGrid(rows, 'd', 'Home')).toBe('a');
    expect(moveInGrid(rows, 'a', 'End')).toBe('e');
    expect(moveInGrid(rows, 'b', 'PageDown', 2)).toBe('e');
    expect(moveInGrid(rows, 'e', 'PageUp', 5)).toBe('b');
    expect(moveInGrid(rows, 'zzz', 'ArrowDown')).toBe('a');
    expect(moveInGrid(rows, null, 'ArrowRight')).toBe('a');
    expect(moveInGrid([], 'a', 'ArrowRight')).toBeNull();
  });
  it('不能选的卡片（基模板缺失）不停：沿同一个方向接着走；Tab 停靠点也不落在它上面', () => {
    const off = (k: string) => k === 'c' || k === 'a';
    expect(moveInGrid(rows, 'b', 'ArrowRight', 3, off)).toBe('d');
    expect(moveInGrid(rows, 'd', 'ArrowLeft', 3, off)).toBe('b');
    expect(moveInGrid(rows, 'b', 'ArrowDown', 3, off)).toBe('d');
    expect(moveInGrid(rows, 'b', 'ArrowLeft', 3, off), '前面都不能选：停在原地').toBe('b');
    expect(moveInGrid(rows, 'e', 'Home', 3, off)).toBe('b');
    expect(moveInGrid(rows, null, 'ArrowDown', 3, off), '没有当前的：第一张能选的').toBe('b');
    expect(moveInGrid(rows, 'b', 'End', 3, (k) => k !== 'b')).toBe('b');
    expect(moveInGrid(rows, 'b', 'ArrowRight', 3, () => true)).toBeNull();
  });
});
