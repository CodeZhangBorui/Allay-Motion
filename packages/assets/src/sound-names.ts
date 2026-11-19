// 音效的显示名与分类（docs/03-assets.md 3.8、decisions.md“2026-11 反馈：素材与音效”）。
//
// 名称不随仓库分发任何翻译表：运行时从资源栈里的语言文件（原版 jar 的 en_us.json、资源索引里的 zh_cn.json，
// 资源包可以覆盖）读字幕（sounds.json 的 subtitle 键）和方块、实体、物品、生物群系、唱片的名字，拼出显示名。
// 中文的叫法因此与游戏内字幕一致，也就是 Minecraft Wiki 中文版“声音事件”表里用的字幕文本。

/** 语言文件：键 → 文本。解析失败时为空表 */
export type LangTable = ReadonlyMap<string, string>;

const MAX_LANG_ENTRIES = 200_000;

export function parseLangJson(text: string): Map<string, string> {
  const out = new Map<string, string>();
  let root: unknown;
  try {
    root = JSON.parse(text.trimStart());
  } catch {
    return out;
  }
  if (typeof root !== 'object' || root === null || Array.isArray(root)) return out;
  for (const [k, v] of Object.entries(root as Record<string, unknown>)) {
    if (out.size >= MAX_LANG_ENTRIES) break;
    if (typeof v === 'string' && k.length <= 256) out.set(k, v.slice(0, 200));
  }
  return out;
}

/** 多层语言文件合并（从下往上，上层同名键覆盖下层），与游戏相同 */
export function mergeLangTables(bottomToTop: readonly LangTable[]): Map<string, string> {
  const out = new Map<string, string>();
  for (const t of bottomToTop) for (const [k, v] of t) out.set(k, v);
  return out;
}

/** 选择器里的分类。按事件 ID 路径的第一段；认不出时看第一个变体的文件路径（sounds/ 之后的第一段），再不行归“其他” */
export const SOUND_CATEGORIES = ['ambient', 'block', 'enchant', 'entity', 'event', 'item', 'music', 'music_disc', 'particle', 'ui', 'weather', 'other'] as const;
export type SoundCategory = (typeof SOUND_CATEGORIES)[number];

const CATEGORY_ALIASES: Readonly<Record<string, SoundCategory>> = {
  ambient: 'ambient',
  block: 'block',
  blocks: 'block',
  dig: 'block',
  step: 'block',
  enchant: 'enchant',
  entity: 'entity',
  mob: 'entity',
  event: 'event',
  item: 'item',
  items: 'item',
  music: 'music',
  music_disc: 'music_disc',
  record: 'music_disc',
  records: 'music_disc',
  particle: 'particle',
  ui: 'ui',
  gui: 'ui',
  random: 'ui',
  weather: 'weather',
};

function firstSegment(s: string, sep: RegExp): string {
  return s.split(sep)[0] ?? '';
}

/**
 * 分类规则：
 * 1. 事件 ID 的路径（冒号之后）按“.”或“/”切开，第一段在别名表里就用它（资源包新增的 mypack:music.boss 归“音乐”）；
 * 2. 否则看第一个变体的音效名（mypack:music/boss 去掉命名空间），第一段在别名表里就用它；
 * 3. 都不认识归 other。
 */
export function soundCategory(eventId: string, firstFile?: string | null): SoundCategory {
  const path = eventId.slice(eventId.indexOf(':') + 1);
  const a = CATEGORY_ALIASES[firstSegment(path, /[./]/)];
  if (a) return a;
  if (firstFile) {
    const fp = firstFile.slice(firstFile.indexOf(':') + 1);
    const b = CATEGORY_ALIASES[firstSegment(fp, /\//)];
    if (b) return b;
  }
  return 'other';
}

/** 分类、前缀用的两套界面文字（属于本应用的界面文案，不是从游戏或 Wiki 来的） */
const LABELS = {
  'zh-CN': {
    music: '音乐',
    music_disc: '唱片',
    ambient: '环境音',
    sep: '：',
    paren: (a: string, b: string) => `${a}（${b}）`,
    // 游戏里没有字幕的几类方块动作（摔落、脚步等），以及不对应生物群系的几段音乐
    actions: { fall: '摔落', step: '脚步', hit: '敲击', break: '破坏', place: '放置', loop: '循环' } as Readonly<Record<string, string>>,
    musics: { creative: '创造模式', credits: '制作人员名单', dragon: '末影龙', end: '末地', game: '游戏中', menu: '主菜单', under_water: '水下', nether: '下界' } as Readonly<Record<string, string>>,
  },
  en: {
    music: 'Music',
    music_disc: 'Disc',
    ambient: 'Ambience',
    sep: ': ',
    paren: (a: string, b: string) => `${a} (${b})`,
    actions: { fall: 'fall', step: 'step', hit: 'hit', break: 'break', place: 'place', loop: 'loop' } as Readonly<Record<string, string>>,
    musics: { creative: 'Creative', credits: 'Credits', dragon: 'Ender Dragon', end: 'The End', game: 'In game', menu: 'Main menu', under_water: 'Underwater', nether: 'Nether' } as Readonly<Record<string, string>>,
  },
} as const;
export type SoundNameLocale = keyof typeof LABELS;

function subjectName(lang: LangTable, kind: string, key: string): string | null {
  const tries: string[] = [];
  if (kind === 'block') tries.push(`block.minecraft.${key}`);
  else if (kind === 'entity') tries.push(`entity.minecraft.${key}`);
  else if (kind === 'item') tries.push(`item.minecraft.${key}`, `block.minecraft.${key}`);
  else if (kind === 'biome') tries.push(`biome.minecraft.${key}`);
  for (const k of tries) {
    const v = lang.get(k);
    if (v) return v;
  }
  return null;
}

/**
 * 推导一个音效事件的显示名；推导不出时返回 null（界面显示 ID）。
 * - 有字幕且语言文件里有：用字幕。字幕是共用的（例如 block.stone.place 用 subtitles.block.generic.place“方块被放置”）
 *   时，后面括注主体（方块、实体、物品）的名字：“方块被放置（石头）”。
 * - 没有字幕：music.* 用生物群系名（不对应生物群系的创造模式、主菜单等用本应用自己的几个词），music_disc.* 用唱片名
 *   （jukebox_song.minecraft.*，旧版用唱片物品的描述），ambient.<生物群系>.* 用生物群系名；都加上“音乐：”“唱片：”“环境音：”的前缀。
 *   block.<方块>.<动作> 里游戏不给字幕的几种动作（fall、step、hit 等）：“方块名（摔落）”。
 * 只处理 minecraft 命名空间的主体名；其他命名空间只用字幕。
 */
export function deriveSoundName(eventId: string, subtitleKey: string | undefined, lang: LangTable, locale: SoundNameLocale): string | null {
  const L = LABELS[locale];
  const colon = eventId.indexOf(':');
  const ns = eventId.slice(0, colon);
  const parts = eventId.slice(colon + 1).split('.');
  const [kind = '', second = ''] = parts;
  const vanillaNs = ns === 'minecraft';
  if (subtitleKey) {
    const sub = lang.get(subtitleKey);
    if (sub) {
      const subParts = subtitleKey.split('.');
      // subtitles.<kind>.<subject>.<action>：主体与事件的第二段不同，说明是共用字幕
      const shared = subParts[2] !== second;
      if (shared && vanillaNs && (kind === 'block' || kind === 'entity' || kind === 'item')) {
        const subj = subjectName(lang, kind, second);
        if (subj && !sub.includes(subj)) return L.paren(sub, subj);
      }
      return sub;
    }
  }
  if (!vanillaNs) return null;
  if (kind === 'music_disc' && second) {
    const song = lang.get(`jukebox_song.minecraft.${second}`) ?? lang.get(`item.minecraft.music_disc_${second}.desc`);
    return song ? `${L.music_disc}${L.sep}${song}` : null;
  }
  if (kind === 'music') {
    const last = parts[parts.length - 1] ?? '';
    const biome = parts.length >= 3 ? subjectName(lang, 'biome', last) : null;
    const label = biome ?? (parts.length === 2 ? (L.musics[second] ?? null) : null);
    return label ? `${L.music}${L.sep}${label}` : null;
  }
  if (kind === 'block' && parts.length === 3) {
    const action = L.actions[parts[2]!];
    const subj = action ? subjectName(lang, 'block', second) : null;
    if (subj && action) return L.paren(subj, action);
  }
  if (kind === 'ambient' && second) {
    const biome = subjectName(lang, 'biome', second);
    return biome ? `${L.ambient}${L.sep}${biome}${parts.length > 2 ? ` · ${parts.slice(2).join('.')}` : ''}` : null;
  }
  return null;
}
