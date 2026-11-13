// 三层资源栈的纯逻辑（docs/03-assets.md 3.2）：叠加顺序、开关、重排、resourceStamp。
// 各层的读取实现在主进程（apps/desktop/src/main/resources/），这里只依赖接口。
import { z } from 'zod';
import { isSafeRelativePath } from './ids';

export type LayerKind = 'builtin' | 'vanilla' | 'pack';

export interface ResourceLayer {
  id: string;
  kind: LayerKind;
  name: string;
  description?: string;
  /** pack.png */
  icon?: Uint8Array;
  packFormat?: number;
  enabled: boolean;
  /**
   * 这一层内容的版本标记（文件修改时间、大小等拼成的字符串），参与 resourceStamp。
   * 规格的接口里没有这个字段；加上它是为了让 stamp 能反映“同一个包的文件改了”。
   */
  revision: string;
  /** 旧版（1.12 及更早）命名的资源包，列出但提示大部分贴图不会生效（3.5） */
  legacyFormat?: boolean;
  /** 读取时被跳过的条目等提示，展示在资源面板里 */
  warnings?: readonly string[];
  /** 例如 "assets/minecraft/textures/block/stone.png" */
  has(path: string): boolean;
  read(path: string): Promise<Uint8Array | null>;
  /** 以 prefix 开头的全部文件路径，排序后返回 */
  list(prefix: string): string[];
}

/**
 * 资源栈：从下到上排列的层，下标 0 是 builtin。
 * 层对象应当是普通对象（方法写成闭包），这样开关时可以用展开语法复制。
 */
export type ResourceStack = readonly ResourceLayer[];

export class ResourceStackError extends Error {
  override name = 'ResourceStackError';
}

/** 校验栈的形状：恰好一个 builtin，在最底下且启用；id 不重复 */
export function assertValidStack(stack: ResourceStack): void {
  const builtins = stack.filter((l) => l.kind === 'builtin');
  if (builtins.length !== 1 || stack[0]?.kind !== 'builtin') throw new ResourceStackError('builtin 层必须恰好一个且在最底下');
  if (!stack[0].enabled) throw new ResourceStackError('builtin 层不能关闭');
  const ids = new Set<string>();
  for (const l of stack) {
    if (ids.has(l.id)) throw new ResourceStackError(`层 id 重复：${l.id}`);
    ids.add(l.id);
  }
}

/** 第一个启用且包含该文件的层（从最上层往下找）；都没有时返回 null */
export function resolveLayer(stack: ResourceStack, path: string): ResourceLayer | null {
  if (!isSafeRelativePath(path)) return null;
  for (let i = stack.length - 1; i >= 0; i--) {
    const layer = stack[i];
    if (layer?.enabled && layer.has(path)) return layer;
  }
  return null;
}

export interface ResolvedResource {
  layerId: string;
  data: Uint8Array;
}

/**
 * 读取资源。胜出的层读不出来（文件在扫描后被删、zip 条目损坏）时继续往下找，
 * 这样用户的包坏了也能退回内置层。
 */
export async function readResource(stack: ResourceStack, path: string): Promise<ResolvedResource | null> {
  if (!isSafeRelativePath(path)) return null;
  for (let i = stack.length - 1; i >= 0; i--) {
    const layer = stack[i];
    if (!layer?.enabled || !layer.has(path)) continue;
    const data = await layer.read(path).catch(() => null);
    if (data) return { layerId: layer.id, data };
  }
  return null;
}

/** 从上到下所有包含该文件的启用层（sounds.json、字体定义这类要合并的文件用） */
export function layersWith(stack: ResourceStack, path: string): ResourceLayer[] {
  const out: ResourceLayer[] = [];
  for (let i = stack.length - 1; i >= 0; i--) {
    const layer = stack[i];
    if (layer?.enabled && layer.has(path)) out.push(layer);
  }
  return out;
}

/** 启用层里以 prefix 开头的文件，合并去重后排序 */
export function listMerged(stack: ResourceStack, prefix: string): string[] {
  const set = new Set<string>();
  for (const layer of stack) if (layer.enabled) for (const p of layer.list(prefix)) set.add(p);
  return [...set].sort();
}

/** 开关某一层。builtin 不能关闭 */
export function setLayerEnabled(stack: ResourceStack, id: string, enabled: boolean): ResourceLayer[] {
  return stack.map((l) => {
    if (l.id !== id) return l;
    if (l.kind === 'builtin' && !enabled) throw new ResourceStackError('builtin 层不能关闭');
    return l.enabled === enabled ? l : { ...l, enabled };
  });
}

/**
 * 把某层移到新的位置（下标从下往上数）。builtin 不能移动，其他层也不能移到它下面：
 * 目标下标会被夹到 [1, length - 1]。
 */
export function moveLayer(stack: ResourceStack, id: string, toIndex: number): ResourceLayer[] {
  const from = stack.findIndex((l) => l.id === id);
  if (from < 0) throw new ResourceStackError(`没有这一层：${id}`);
  const layer = stack[from];
  if (!layer || layer.kind === 'builtin') throw new ResourceStackError('builtin 层不能移动');
  const rest = stack.filter((_, i) => i !== from);
  const to = Math.min(Math.max(Math.trunc(toIndex), 1), rest.length);
  return [...rest.slice(0, to), layer, ...rest.slice(to)];
}

/** 按给定的 id 顺序（从下往上，不含 builtin）重排；没列出的层保持原来的相对顺序，放在最上面 */
export function reorderLayers(stack: ResourceStack, orderBottomToTop: readonly string[]): ResourceLayer[] {
  const builtin = stack.filter((l) => l.kind === 'builtin');
  const others = stack.filter((l) => l.kind !== 'builtin');
  const rank = new Map(orderBottomToTop.map((id, i) => [id, i]));
  const listed = others.filter((l) => rank.has(l.id)).sort((a, b) => (rank.get(a.id) ?? 0) - (rank.get(b.id) ?? 0));
  const unlisted = others.filter((l) => !rank.has(l.id));
  return [...builtin, ...listed, ...unlisted];
}

// ---------------------------------------------------------------------------
// resourceStamp

/** FNV-1a 64 位，按 UTF-16 码元逐字节喂入。不需要密码学强度，只要稳定 */
export function fnv1a64(text: string): string {
  let h = 0xcbf29ce484222325n;
  const prime = 0x100000001b3n;
  const mask = 0xffffffffffffffffn;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    h = ((h ^ BigInt(c & 0xff)) * prime) & mask;
    h = ((h ^ BigInt(c >> 8)) * prime) & mask;
  }
  return h.toString(16).padStart(16, '0');
}

/**
 * 对（各层 id、内容版本、启用状态、顺序）的哈希（3.2）。它变了，引擎缓存和缩略图缓存一起失效。
 */
export function computeResourceStamp(stack: ResourceStack): string {
  return fnv1a64(JSON.stringify(stack.map((l) => [l.id, l.revision, l.enabled])));
}

// ---------------------------------------------------------------------------
// 设置里保存的资源栈配置（资源栈是应用级设置，1.9）。M2b 接进 settings.json。

export const PackSourceSchema = z.discriminatedUnion('kind', [
  /** userData/packs/<内容哈希>.zip */
  z.strictObject({ kind: z.literal('zip'), file: z.string().regex(/^[0-9a-f]{64}\.zip$/) }),
  /** 文件夹只记路径 */
  z.strictObject({ kind: z.literal('folder'), path: z.string().min(1) }),
]);
export type PackSource = z.infer<typeof PackSourceSchema>;

export const ResourceStackSettingsSchema = z.strictObject({
  vanilla: z.strictObject({
    /** 用户是否同意使用本机游戏文件；null 表示还没问过 */
    consent: z.boolean().nullable(),
    enabled: z.boolean(),
    /** 用户上次手动选过的游戏目录 */
    dir: z.string().min(1).nullable(),
  }),
  /** 从下往上 */
  packs: z.array(z.strictObject({ id: z.string().min(1), name: z.string(), source: PackSourceSchema, enabled: z.boolean() })),
});
export type ResourceStackSettings = z.infer<typeof ResourceStackSettingsSchema>;

export const DEFAULT_RESOURCE_STACK_SETTINGS: ResourceStackSettings = {
  vanilla: { consent: null, enabled: true, dir: null },
  packs: [],
};

/** 把打开的各层按设置排好：builtin、vanilla（若有）、各个包（按设置的顺序和开关）。打不开的包不在 layersById 里，直接跳过 */
export function buildStack(
  builtin: ResourceLayer,
  vanilla: ResourceLayer | null,
  packsById: ReadonlyMap<string, ResourceLayer>,
  settings: ResourceStackSettings,
): ResourceLayer[] {
  const stack: ResourceLayer[] = [{ ...builtin, enabled: true }];
  if (vanilla && settings.vanilla.consent === true) stack.push({ ...vanilla, enabled: settings.vanilla.enabled });
  for (const p of settings.packs) {
    const layer = packsById.get(p.id);
    if (layer) stack.push({ ...layer, enabled: p.enabled });
  }
  assertValidStack(stack);
  return stack;
}
