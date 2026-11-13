// 方块目录、物品目录、名称表、着色常量（docs/03-assets.md 3.7）。
// 数据在 ../data/*.json，这里只做校验和查询。目录只描述“哪个面用哪张贴图”，不读 Mojang 的模型 JSON。
import { z } from 'zod';
import blocksJson from '../data/blocks.json' with { type: 'json' };
import itemsJson from '../data/items.json' with { type: 'json' };
import namesJson from '../data/names.json' with { type: 'json' };
import tintsJson from '../data/tints.json' with { type: 'json' };
import { normalizeResourceId } from './ids';

export const TINT_KINDS = ['grass', 'foliage', 'foliage_spruce', 'foliage_birch', 'water'] as const;
export const TintKindSchema = z.enum(TINT_KINDS);
export type TintKind = z.infer<typeof TintKindSchema>;

export const RenderTypeSchema = z.enum(['opaque', 'cutout', 'translucent']);
export type RenderType = z.infer<typeof RenderTypeSchema>;

const TexRef = z.string().regex(/^([a-z0-9_.-]+:)?[a-z0-9_./-]+$/);

/** 各形状的贴图键。所有形状都可以另带 sideOverlay（叠在四个侧面上，3.7） */
const SHAPE_KEYS = {
  cube_all: ['all'],
  cube_column: ['end', 'side'],
  cube_bottom_top: ['top', 'side', 'bottom'],
  orientable: ['front', 'side', 'top'],
  cube: ['up', 'down', 'north', 'south', 'east', 'west'],
} as const;
export type BlockShape = keyof typeof SHAPE_KEYS;
export const BLOCK_SHAPES = Object.keys(SHAPE_KEYS) as BlockShape[];

export const BlockDefSchema = z
  .strictObject({
    shape: z.enum(BLOCK_SHAPES as [BlockShape, ...BlockShape[]]),
    tex: z.record(z.string(), TexRef),
    render: RenderTypeSchema.optional(),
    tint: z.record(z.string(), TintKindSchema).optional(),
  })
  .superRefine((def, ctx) => {
    const required: readonly string[] = SHAPE_KEYS[def.shape];
    const allowed = new Set<string>([...required, 'sideOverlay']);
    for (const key of required) {
      if (!(key in def.tex)) ctx.addIssue({ code: 'custom', message: `shape ${def.shape} 缺少贴图键 ${key}` });
    }
    for (const key of Object.keys(def.tex)) {
      if (!allowed.has(key)) ctx.addIssue({ code: 'custom', message: `shape ${def.shape} 不认识贴图键 ${key}` });
    }
    for (const key of Object.keys(def.tint ?? {})) {
      if (!(key in def.tex)) ctx.addIssue({ code: 'custom', message: `tint 引用了不存在的贴图键 ${key}` });
    }
  });
export type BlockDef = z.infer<typeof BlockDefSchema>;

export const ItemDefSchema = z.strictObject({ tex: TexRef });
export type ItemDef = z.infer<typeof ItemDefSchema>;

export const DisplayNameSchema = z.strictObject({ 'zh-CN': z.string().min(1), en: z.string().min(1) });
export type DisplayName = z.infer<typeof DisplayNameSchema>;

const CatalogId = z.string().regex(/^[a-z0-9_.-]+:[a-z0-9_./-]+$/);
export const BlockCatalogSchema = z.record(CatalogId, BlockDefSchema);
export const ItemCatalogSchema = z.record(CatalogId, ItemDefSchema);
export const NameTableSchema = z.record(CatalogId, DisplayNameSchema);
export const TintTableSchema = z.record(TintKindSchema, z.string().regex(/^#[0-9A-Fa-f]{6}$/));

export const BLOCKS: Readonly<Record<string, BlockDef>> = BlockCatalogSchema.parse(blocksJson);
export const ITEMS: Readonly<Record<string, ItemDef>> = ItemCatalogSchema.parse(itemsJson);
export const NAMES: Readonly<Record<string, DisplayName>> = NameTableSchema.parse(namesJson);
export const TINTS: Readonly<Record<TintKind, string>> = TintTableSchema.parse(tintsJson) as Record<TintKind, string>;

export const FACES = ['up', 'down', 'north', 'south', 'east', 'west'] as const;
export type Face = (typeof FACES)[number];

export interface FaceTexture {
  /** 贴图资源 ID（带命名空间） */
  texture: string;
  tint?: TintKind;
}

export interface ResolvedBlockFaces {
  faces: Record<Face, FaceTexture>;
  /** 叠在四个侧面上的贴图；没有时为 undefined */
  sideOverlay?: FaceTexture;
  render: RenderType;
}

function faceTex(def: BlockDef, key: string): FaceTexture {
  const tex = def.tex[key];
  if (tex === undefined) throw new Error(`missing texture key ${key}`);
  const texture = normalizeResourceId(tex);
  if (texture === null) throw new Error(`bad texture id ${tex}`);
  const tint = def.tint?.[key];
  return tint ? { texture, tint } : { texture };
}

/** 把目录条目展开成六个面。`orientable` 的正面朝北，底面与顶面相同（与原版的约定一致） */
export function resolveBlockFaces(def: BlockDef): ResolvedBlockFaces {
  const f = (key: string) => faceTex(def, key);
  let faces: Record<Face, FaceTexture>;
  switch (def.shape) {
    case 'cube_all': {
      const a = f('all');
      faces = { up: a, down: a, north: a, south: a, east: a, west: a };
      break;
    }
    case 'cube_column': {
      const end = f('end');
      const side = f('side');
      faces = { up: end, down: end, north: side, south: side, east: side, west: side };
      break;
    }
    case 'cube_bottom_top': {
      const side = f('side');
      faces = { up: f('top'), down: f('bottom'), north: side, south: side, east: side, west: side };
      break;
    }
    case 'orientable': {
      const side = f('side');
      const top = f('top');
      faces = { up: top, down: top, north: f('front'), south: side, east: side, west: side };
      break;
    }
    case 'cube':
      faces = { up: f('up'), down: f('down'), north: f('north'), south: f('south'), east: f('east'), west: f('west') };
      break;
  }
  const out: ResolvedBlockFaces = { faces, render: def.render ?? 'opaque' };
  if ('sideOverlay' in def.tex) out.sideOverlay = f('sideOverlay');
  return out;
}

export function getBlock(id: string): BlockDef | undefined {
  const key = normalizeResourceId(id);
  return key === null ? undefined : BLOCKS[key];
}

export function getItem(id: string): ItemDef | undefined {
  const key = normalizeResourceId(id);
  return key === null ? undefined : ITEMS[key];
}

export type Locale = keyof DisplayName;

/** 显示名；名称表里没有时退回 ID 本身 */
export function displayName(id: string, locale: Locale): string {
  const key = normalizeResourceId(id) ?? id;
  return NAMES[key]?.[locale] ?? key;
}

/** 选择器的搜索：按 ID 和两种语言的名字，不区分大小写 */
export function searchCatalog(query: string, ids: readonly string[]): string[] {
  const q = query.trim().toLowerCase();
  if (q === '') return [...ids];
  return ids.filter((id) => {
    const name = NAMES[id];
    return id.toLowerCase().includes(q) || (name !== undefined && (name.en.toLowerCase().includes(q) || name['zh-CN'].includes(q)));
  });
}

/** 着色常量，sRGB 编码的 0–1 分量（与贴图像素相乘，和游戏的做法一样） */
export function tintRgb(kind: TintKind): [number, number, number] {
  const hex = TINTS[kind];
  const n = Number.parseInt(hex.slice(1), 16);
  return [((n >> 16) & 0xff) / 255, ((n >> 8) & 0xff) / 255, (n & 0xff) / 255];
}

/** 方块目录引用的全部贴图 ID（去重、排序） */
export function blockTextureIds(): string[] {
  const set = new Set<string>();
  for (const def of Object.values(BLOCKS)) {
    for (const tex of Object.values(def.tex)) {
      const id = normalizeResourceId(tex);
      if (id) set.add(id);
    }
  }
  return [...set].sort();
}

/** 物品目录引用的全部贴图 ID（去重、排序） */
export function itemTextureIds(): string[] {
  const set = new Set<string>();
  for (const def of Object.values(ITEMS)) {
    const id = normalizeResourceId(def.tex);
    if (id) set.add(id);
  }
  return [...set].sort();
}
