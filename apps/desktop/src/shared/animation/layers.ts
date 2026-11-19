// 图层的文档操作（docs/animation-editor.md 10.8）：层级、成组、复制、排序、可见区间、隐藏 / 独显 / 锁定。
// 纯函数，界面和类型化命令共用。doc.layers 的顺序就是画的顺序（后面的画在前面）；层级只由 parent 表示。
import { ANIM_PROPS, PROP_DEFAULTS, type AnimationDoc, type Layer } from './schema';

export interface TreeEntry {
  layer: Layer;
  /** 在 doc.layers 里的位置 */
  index: number;
  depth: number;
}

/**
 * 图层面板、时间轴的显示顺序：最上面是画在最前面的（doc.layers 的末尾），子图层紧跟在父级下面、缩进一层。
 * 找不到的父级当作没有（schema 已经保证父级存在）。
 */
export function layerTree(doc: Pick<AnimationDoc, 'layers'>): TreeEntry[] {
  const children = new Map<string | undefined, number[]>();
  doc.layers.forEach((l, i) => {
    const p = l.parent !== undefined && doc.layers.some((x) => x.id === l.parent) ? l.parent : undefined;
    children.set(p, [...(children.get(p) ?? []), i]);
  });
  const out: TreeEntry[] = [];
  const walk = (parent: string | undefined, depth: number) => {
    for (const i of [...(children.get(parent) ?? [])].reverse()) {
      const layer = doc.layers[i]!;
      out.push({ layer, index: i, depth });
      if (depth < 32) walk(layer.id, depth + 1);
    }
  };
  walk(undefined, 0);
  return out;
}

/** 一个图层的全部子孙（不含自己） */
export function descendants(doc: Pick<AnimationDoc, 'layers'>, id: string): string[] {
  const out: string[] = [];
  const stack = [id];
  while (stack.length > 0) {
    const cur = stack.pop()!;
    for (const l of doc.layers) {
      if (l.parent === cur && !out.includes(l.id)) {
        out.push(l.id);
        stack.push(l.id);
      }
    }
  }
  return out;
}

/** 新的唯一图层 id：前缀加序号 */
export function uniqueLayerId(doc: Pick<AnimationDoc, 'layers'>, prefix: string, taken: ReadonlySet<string> = new Set()): string {
  const base = prefix.replace(/[^a-z0-9-]/g, '').slice(0, 24) || 'layer';
  const used = new Set([...doc.layers.map((l) => l.id), ...taken]);
  for (let i = 1; ; i++) {
    const id = `${base}-${i}`;
    if (!used.has(id)) return id;
  }
}

/** 改图层的开关（隐藏、独显、锁定）；给 false 就是去掉这个字段 */
export function setLayerFlags(doc: AnimationDoc, id: string, flags: { hidden?: boolean; solo?: boolean; locked?: boolean }): AnimationDoc | null {
  const i = doc.layers.findIndex((l) => l.id === id);
  if (i < 0) return null;
  const next = structuredClone(doc);
  const l = next.layers[i]! as Layer & Record<string, unknown>;
  for (const [k, v] of Object.entries(flags)) {
    if (v === undefined) continue;
    if (v) l[k] = true;
    else delete l[k];
  }
  return next;
}

export function renameLayer(doc: AnimationDoc, id: string, name: string): AnimationDoc | null {
  const i = doc.layers.findIndex((l) => l.id === id);
  const clean = name.trim().slice(0, 60);
  if (i < 0 || clean === '') return null;
  const next = structuredClone(doc);
  next.layers[i]!.name = clean;
  return next;
}

/** 改可见区间（夹在 [0, 时长]，from 不超过 to）；给 null 是去掉这一端（缺省是整段） */
export function setLayerInterval(doc: AnimationDoc, id: string, from: number | null | undefined, to: number | null | undefined, duration: number): AnimationDoc | null {
  const i = doc.layers.findIndex((l) => l.id === id);
  if (i < 0) return null;
  const next = structuredClone(doc);
  const l = next.layers[i]!;
  const c = (x: number) => Math.round(Math.min(duration, Math.max(0, x)) * 10000) / 10000;
  if (from === null) delete l.from;
  else if (from !== undefined) l.from = c(from);
  if (to === null) delete l.to;
  else if (to !== undefined) l.to = c(to);
  if (l.from !== undefined && l.to !== undefined && l.from > l.to) return null;
  return next;
}

/**
 * 把图层挪到 doc.layers 的第 to 位（画的顺序）。子孙跟着一起挪、保持相对顺序，挪到目标位置的下面（先画），
 * 这样组在面板里还是一块。
 */
export function moveLayer(doc: AnimationDoc, id: string, to: number): AnimationDoc | null {
  const i = doc.layers.findIndex((l) => l.id === id);
  if (i < 0) return null;
  const block = new Set([id, ...descendants(doc, id)]);
  const moving = doc.layers.filter((l) => block.has(l.id));
  const rest = doc.layers.filter((l) => !block.has(l.id));
  const at = Math.max(0, Math.min(rest.length, to));
  const next = structuredClone(doc);
  next.layers = structuredClone([...rest.slice(0, at), ...moving, ...rest.slice(at)]);
  return next;
}

/**
 * 挪到另一个图层的上面（above：画在它前面）或下面（below：画在它后面）。子孙跟着一起挪。
 * 按“去掉要挪的这一块之后”的位置算，挪动带子孙的组时也不会错位。
 */
export function moveLayerRelative(doc: AnimationDoc, id: string, neighbour: string, place: 'above' | 'below'): AnimationDoc | null {
  if (id === neighbour || !doc.layers.some((l) => l.id === id) || !doc.layers.some((l) => l.id === neighbour)) return null;
  const block = new Set([id, ...descendants(doc, id)]);
  if (block.has(neighbour)) return null;
  const rest = doc.layers.filter((l) => !block.has(l.id));
  const ni = rest.findIndex((l) => l.id === neighbour);
  return moveLayer(doc, id, place === 'above' ? ni + 1 : ni);
}

/** 设父级（null 是去掉）。父级不能是自己或自己的子孙 */
export function setParent(doc: AnimationDoc, id: string, parent: string | null): AnimationDoc | null {
  const i = doc.layers.findIndex((l) => l.id === id);
  if (i < 0) return null;
  if (parent !== null && (parent === id || !doc.layers.some((l) => l.id === parent) || descendants(doc, id).includes(parent))) return null;
  const next = structuredClone(doc);
  if (parent === null) delete next.layers[i]!.parent;
  else next.layers[i]!.parent = parent;
  return next;
}

/** 删图层：子图层改挂到被删图层的父级 */
export function removeLayer(doc: AnimationDoc, id: string): AnimationDoc | null {
  const target = doc.layers.find((l) => l.id === id);
  if (!target) return null;
  const next = structuredClone(doc);
  next.layers = next.layers.filter((l) => l.id !== id);
  for (const l of next.layers) {
    if (l.parent !== id) continue;
    if (target.parent === undefined) delete l.parent;
    else l.parent = target.parent;
  }
  return next;
}

/**
 * 复制图层（连同子孙）：新的 id、名字加后缀，放在原来那一块的上面；副本之间的父子关系跟着换成新 id，
 * 指向副本之外的父级不变。参数绑定原样保留（副本和原来的用同一个参数）。
 */
export function duplicateLayers(doc: AnimationDoc, ids: readonly string[], suffix: string): { doc: AnimationDoc; ids: string[] } | null {
  const roots = ids.filter((id) => doc.layers.some((l) => l.id === id) && !ids.some((other) => other !== id && descendants(doc, other).includes(id)));
  if (roots.length === 0) return null;
  let next = structuredClone(doc);
  const created: string[] = [];
  for (const root of roots) {
    const block = [root, ...descendants(next, root)];
    const map = new Map<string, string>();
    const taken = new Set<string>();
    for (const id of block) {
      const nid = uniqueLayerId(next, (next.layers.find((l) => l.id === id)!.id.replace(/-\d+$/, '') || 'layer'), taken);
      taken.add(nid);
      map.set(id, nid);
    }
    const copies = next.layers
      .filter((l) => map.has(l.id))
      .map((l) => {
        const c = structuredClone(l);
        c.id = map.get(l.id)!;
        if (l.id === root) c.name = `${l.name}${suffix}`.slice(0, 60);
        if (c.parent !== undefined && map.has(c.parent)) c.parent = map.get(c.parent)!;
        return c;
      });
    const lastIndex = Math.max(...next.layers.map((l, i) => (map.has(l.id) ? i : -1)));
    next = { ...next, layers: [...next.layers.slice(0, lastIndex + 1), ...copies, ...next.layers.slice(lastIndex + 1)] };
    created.push(map.get(root)!);
  }
  return { doc: next, ids: created };
}

/**
 * 成组：新建一个组，放在这些图层里最靠前（画在最上面）的那个的位置，把它们（只取最上层的，不重复拿子孙）挂到组下面。
 * 组的父级是这些图层原来共同的父级（不共同时为没有）。
 */
export function groupLayers(doc: AnimationDoc, ids: readonly string[], name: string): { doc: AnimationDoc; id: string } | null {
  const picked = ids.filter((id) => doc.layers.some((l) => l.id === id));
  const roots = picked.filter((id) => !picked.some((other) => other !== id && descendants(doc, other).includes(id)));
  if (roots.length === 0) return null;
  const parents = new Set(roots.map((id) => doc.layers.find((l) => l.id === id)!.parent));
  const commonParent = parents.size === 1 ? [...parents][0] : undefined;
  const gid = uniqueLayerId(doc, 'group');
  const top = Math.max(...roots.map((id) => doc.layers.findIndex((l) => l.id === id)));
  const group: Layer = { id: gid, name: name.trim().slice(0, 60) || 'Group', type: 'group', props: {}, ...(commonParent !== undefined ? { parent: commonParent } : {}) };
  const next = structuredClone(doc);
  for (const l of next.layers) if (roots.includes(l.id)) l.parent = gid;
  next.layers.splice(top + 1, 0, group);
  return { doc: next, id: gid };
}

/** 组自己的变换是不是默认值（解组时不能丢掉不是默认值的变换） */
export function hasOwnTransform(layer: Layer): boolean {
  return ANIM_PROPS.some((p) => {
    const tr = layer.props[p];
    return tr !== undefined && tr !== PROP_DEFAULTS[p];
  });
}

/**
 * 解组：子图层改挂到组的父级，删掉组。组自己有变换（不是默认值、或有关键帧）时拒绝（返回 null）：
 * 直接丢掉会让子图层跳到别处，把组的变换合并进每个子图层的关键帧又不一定做得到（旋转顺序不同），所以要用户先把组的变换归零。
 */
export function ungroup(doc: AnimationDoc, id: string): AnimationDoc | null {
  const g = doc.layers.find((l) => l.id === id);
  if (!g || g.type !== 'group' || hasOwnTransform(g)) return null;
  return removeLayer(doc, id);
}
