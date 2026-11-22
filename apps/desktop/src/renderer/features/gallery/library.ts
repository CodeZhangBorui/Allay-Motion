// 模板库的纯逻辑（docs/06-ui-design.md 6.4“左面板：模板库”；docs/decisions.md“模板库撑到一百个模板”）：
// 类别、分组、搜索、排序和卡片之间的键盘移动。界面（GalleryPanel.tsx）只把这里的结果画出来。
import { compareVersionStrings, localize, type LocalizedString } from '@allay/template-sdk';
import type { TemplateEntry } from '../../../shared/templates';

/** manifest 的 tags 里表示所属组的词（docs/template-catalog.md 1.0、第 2 节）；这个顺序就是模板库里组的顺序，和目录的 A–H 一致 */
export const TEMPLATE_GROUPS = ['blocks', 'items', 'ui', 'particles', 'text', 'channel', 'shader', 'seasonal'] as const;
export type TemplateGroup = (typeof TEMPLATE_GROUPS)[number];
/** 模板库里的组：八个之外再加一个“其他”（tags 里没有组名的模板，多半是用户自己的） */
export type LibraryGroup = TemplateGroup | 'other';
export const LIBRARY_GROUPS: readonly LibraryGroup[] = [...TEMPLATE_GROUPS, 'other'];

/** 类别标签：全部、三个类别（manifest 的 category）、我的（用户模板） */
export const CATEGORY_TABS = ['all', 'transition', 'overlay', 'title', 'mine'] as const;
export type CategoryTab = (typeof CATEGORY_TABS)[number];
export type GroupFilter = LibraryGroup | 'all';

const GROUP_SET: ReadonlySet<string> = new Set(TEMPLATE_GROUPS);

export function isLibraryGroup(value: string): value is LibraryGroup {
  return value === 'other' || GROUP_SET.has(value);
}

/** tags 里的第一个组名；没有时为 null */
export function ownGroup(tags: readonly string[] | undefined): TemplateGroup | null {
  for (const t of tags ?? []) if (GROUP_SET.has(t)) return t as TemplateGroup;
  return null;
}

/** 按 id 找模板（同一个 id 装了几个版本时取最新的）：派生模板找基模板用 */
export function indexById(entries: readonly TemplateEntry[]): Map<string, TemplateEntry> {
  const out = new Map<string, TemplateEntry>();
  for (const e of entries) {
    const had = out.get(e.id);
    if (!had || compareVersionStrings(e.version, had.version) > 0) out.set(e.id, e);
  }
  return out;
}

/**
 * 模板所在的组，一个模板只在一个组里：manifest 的 tags 里第一个组名。派生模板（“另存为模板”存出来的，manifest 里没有 tags）
 * 自己没写组时随它的基模板；都没有时归“其他”。tags 里排在后面的组名（例如界面类模板也写了 text）只当普通的搜索词。
 */
export function groupOf(entry: TemplateEntry, byId: ReadonlyMap<string, TemplateEntry>): LibraryGroup {
  let e: TemplateEntry | undefined = entry;
  for (let depth = 0; e && depth < 4; depth++) {
    const g = ownGroup(e.manifest.tags);
    if (g) return g;
    const base: string | undefined = e.manifest.extends?.id;
    e = base && base !== e.id ? byId.get(base) : undefined;
  }
  return 'other';
}

export function inCategory(entry: TemplateEntry, tab: CategoryTab): boolean {
  if (tab === 'all') return true;
  if (tab === 'mine') return entry.source === 'user';
  return entry.manifest.category === tab;
}

// ---- 搜索 ----

/** 比较用的写法：Unicode 兼容规整（全角字母数字变半角）再转小写 */
export function normalizeText(text: string): string {
  return text.normalize('NFKC').toLowerCase();
}

/** 搜索框里的文字按空白切成几个词，每个词都要出现（“方块 擦除”） */
export function queryTerms(query: string): string[] {
  return normalizeText(query)
    .split(/\s+/u)
    .filter((t) => t.length > 0);
}

function bothLanguages(value: LocalizedString | undefined): string[] {
  if (value === undefined) return [];
  if (typeof value === 'string') return [value];
  return [value['zh-CN'], value.en].filter((v): v is string => v !== undefined);
}

/** 每个组在两种语言里的名字（来自文案文件），搜组名用 */
export type GroupLabels = Readonly<Record<LibraryGroup, readonly string[]>>;

/** 一个模板能被搜到的文字：两种语言的名称和说明、所在组两种语言的名字、id、tags */
export function searchText(entry: TemplateEntry, group: LibraryGroup, labels: GroupLabels): string {
  const m = entry.manifest;
  return normalizeText([...bothLanguages(m.name), ...bothLanguages(m.description), ...labels[group], entry.id, ...(m.tags ?? [])].join('\n'));
}

export function matchesTerms(text: string, terms: readonly string[]): boolean {
  return terms.every((t) => text.includes(t));
}

// ---- 排序与视图 ----

export interface LibraryItem {
  entry: TemplateEntry;
  /** id@version */
  key: string;
  group: LibraryGroup;
  /** 当前语言的名称 */
  name: string;
  /** searchText 的结果 */
  text: string;
}

export function itemKey(entry: { id: string; version: string }): string {
  return `${entry.id}@${entry.version}`;
}

/**
 * 排序：先按组（TEMPLATE_GROUPS 的顺序，“其他”最后），组内按当前语言的名称（Intl.Collator：中文按拼音，数字按大小），
 * 同名的按 id，同一个模板的几个版本新的在前。不按“相关度”排：搜索结果永远是完整列表里的一个子序列，打字时卡片不会跳来跳去，
 * 同一个模板总在同一个位置（docs/decisions.md“模板库撑到一百个模板”）。
 */
export function compareItems(a: LibraryItem, b: LibraryItem, collator: Intl.Collator): number {
  const ga = LIBRARY_GROUPS.indexOf(a.group);
  const gb = LIBRARY_GROUPS.indexOf(b.group);
  if (ga !== gb) return ga - gb;
  const byName = collator.compare(a.name, b.name);
  if (byName !== 0) return byName;
  if (a.entry.id !== b.entry.id) return a.entry.id < b.entry.id ? -1 : 1;
  return compareVersionStrings(b.entry.version, a.entry.version);
}

/** 模板列表 → 排好序的条目（每次列表或语言变了算一遍；筛选只在这个结果上做） */
export function prepareItems(entries: readonly TemplateEntry[], locale: string, labels: GroupLabels): LibraryItem[] {
  const byId = indexById(entries);
  const collator = new Intl.Collator(locale, { numeric: true, sensitivity: 'base' });
  return entries
    .map((entry) => {
      const group = groupOf(entry, byId);
      return { entry, key: itemKey(entry), group, name: localize(entry.manifest.name, locale), text: searchText(entry, group, labels) };
    })
    .sort((a, b) => compareItems(a, b, collator));
}

export interface LibraryFilter {
  tab: CategoryTab;
  group: GroupFilter;
  query: string;
}

export interface LibrarySection {
  group: LibraryGroup;
  items: LibraryItem[];
}

export interface LibraryView {
  /** 按组分好的结果（只有非空的组，按组的顺序） */
  sections: LibrarySection[];
  /** 结果数 */
  shown: number;
  /** 各组的数量：在当前类别和搜索之下、分组筛选之前（分组筛选的菜单里显示） */
  groupCounts: Record<LibraryGroup, number>;
  /** 当前类别和搜索之下的总数（分组筛选“全部分组”那一项） */
  inCategory: number;
  /** 只看搜索、不管类别和分组时有几个结果（没有结果时提示“全部模板里有 n 个”） */
  anywhere: number;
}

export function emptyGroupCounts(): Record<LibraryGroup, number> {
  return Object.fromEntries(LIBRARY_GROUPS.map((g) => [g, 0])) as Record<LibraryGroup, number>;
}

export function libraryView(items: readonly LibraryItem[], filter: LibraryFilter): LibraryView {
  const terms = queryTerms(filter.query);
  const groupCounts = emptyGroupCounts();
  const byGroup = new Map<LibraryGroup, LibraryItem[]>();
  let anywhere = 0;
  let inCat = 0;
  for (const item of items) {
    if (terms.length > 0 && !matchesTerms(item.text, terms)) continue;
    anywhere++;
    if (!inCategory(item.entry, filter.tab)) continue;
    inCat++;
    groupCounts[item.group]++;
    if (filter.group !== 'all' && item.group !== filter.group) continue;
    let list = byGroup.get(item.group);
    if (!list) byGroup.set(item.group, (list = []));
    list.push(item);
  }
  const sections = LIBRARY_GROUPS.filter((g) => byGroup.has(g)).map((g) => ({ group: g, items: byGroup.get(g)! }));
  return { sections, shown: sections.reduce((n, s) => n + s.items.length, 0), groupCounts, inCategory: inCat, anywhere };
}

// ---- 键盘：方向键在卡片之间移动 ----

/** 卡片排成的行：每个组从新的一行开始，一行 columns 张（与网格的画法一致） */
export function gridRows(sections: readonly LibrarySection[], columns: number): string[][] {
  const cols = Math.max(1, Math.floor(columns));
  const rows: string[][] = [];
  for (const s of sections) for (let i = 0; i < s.items.length; i += cols) rows.push(s.items.slice(i, i + cols).map((it) => it.key));
  return rows;
}

export type GridKey = 'ArrowLeft' | 'ArrowRight' | 'ArrowUp' | 'ArrowDown' | 'Home' | 'End' | 'PageUp' | 'PageDown';
export const GRID_KEYS: ReadonlySet<string> = new Set<GridKey>(['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End', 'PageUp', 'PageDown']);

/**
 * 从 current 按一个键移到哪张卡片：左右按阅读顺序走（行尾接下一行，跨组）；上下到上一行、下一行的同一列（那一行短就落在它的最后一张）；
 * Home、End 到第一张、最后一张；PageUp、PageDown 一次走 pageRows 行。到头了停在原地。current 不在列表里时落到第一张。
 * skip 为真的卡片（不能选的，例如基模板缺失）不停：沿同一个方向接着走，走不动就停在原地。
 */
export function moveInGrid(rows: readonly (readonly string[])[], current: string | null, key: GridKey, pageRows = 3, skip: (key: string) => boolean = () => false): string | null {
  const flat = rows.flat();
  const usable = flat.filter((k) => !skip(k));
  if (usable.length === 0) return null;
  if (current === null || !flat.includes(current)) return usable[0]!;
  if (key === 'Home') return usable[0]!;
  if (key === 'End') return usable[usable.length - 1]!;
  // 一步步走：落在跳过的卡片上就从那里按同一个键再走，直到走到能停的、或者走不动了
  let at = current;
  for (let guard = 0; guard <= flat.length; guard++) {
    const next = step(rows, flat, at, key, pageRows);
    if (next === at) return skip(current) ? usable[0]! : current;
    if (!skip(next)) return next;
    at = next;
  }
  return current;
}

/** 走一步（不管能不能停） */
function step(rows: readonly (readonly string[])[], flat: readonly string[], current: string, key: GridKey, pageRows: number): string {
  const r = rows.findIndex((row) => row.includes(current));
  if (r < 0) return flat[0]!;
  const c = rows[r]!.indexOf(current);
  const at = (row: number) => rows[row]![Math.min(c, rows[row]!.length - 1)]!;
  const i = flat.indexOf(current);
  switch (key) {
    case 'ArrowLeft':
      return flat[Math.max(0, i - 1)]!;
    case 'ArrowRight':
      return flat[Math.min(flat.length - 1, i + 1)]!;
    case 'ArrowUp':
      return at(Math.max(0, r - 1));
    case 'ArrowDown':
      return at(Math.min(rows.length - 1, r + 1));
    case 'Home':
      return flat[0]!;
    case 'End':
      return flat[flat.length - 1]!;
    case 'PageUp':
      return at(Math.max(0, r - Math.max(1, pageRows)));
    case 'PageDown':
      return at(Math.min(rows.length - 1, r + Math.max(1, pageRows)));
  }
}
