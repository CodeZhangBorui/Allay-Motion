// 暴露为参数与音效轨的文档操作（docs/animation-editor.md 10.1、10.2）。纯函数，界面和类型化命令共用。
// 绑定的目标按“图层 id + 字段”寻址（不是数组下标）：图层排序、增删后照样指得对。
import { z } from 'zod';
import { keyIndexAt, setValueAt } from './edit';
import { resolveDoc } from './resolve';
import { ANIM_PROPS, BINDABLE_TYPES, isKeyed, isParamRef, LAYER_ID_RE, type AnimationDoc, type AnimParam, type AnimParamType, type AnimProp, type AnimSound, type BindingKind } from './schema';

/** 能绑定到参数的地方 */
export const BindTargetSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('duration') }),
  z.strictObject({ kind: z.literal('field'), layer: z.string().regex(LAYER_ID_RE), field: z.enum(['block', 'item', 'text', 'color', 'font', 'size', 'width', 'height']) }),
  /** 常量属性（没有关键帧的） */
  z.strictObject({ kind: z.literal('prop'), layer: z.string().regex(LAYER_ID_RE), prop: z.enum(ANIM_PROPS) }),
  /** 某个关键帧的值 */
  z.strictObject({ kind: z.literal('key'), layer: z.string().regex(LAYER_ID_RE), prop: z.enum(ANIM_PROPS), t: z.number().min(0).max(30) }),
  z.strictObject({ kind: z.literal('sound'), sound: z.string().regex(LAYER_ID_RE) }),
]);
export type BindTarget = z.infer<typeof BindTargetSchema>;

const FIELD_KIND: Record<string, BindingKind> = { block: 'block', item: 'item', text: 'text', color: 'color', font: 'font', size: 'number', width: 'number', height: 'number' };

export function targetKind(target: BindTarget): BindingKind {
  switch (target.kind) {
    case 'duration':
      return 'duration';
    case 'field':
      return FIELD_KIND[target.field]!;
    case 'sound':
      return 'sound';
    default:
      return 'number';
  }
}

/** 这个目标能绑定到哪些类型的参数 */
export function compatibleTypes(target: BindTarget): readonly AnimParamType[] {
  return BINDABLE_TYPES[targetKind(target)];
}

/** 目标处现在的值（原样：可能是参数引用）；目标不存在时为 undefined */
export function readTarget(doc: AnimationDoc, target: BindTarget): unknown {
  if (target.kind === 'duration') return doc.duration;
  if (target.kind === 'sound') return doc.sounds.find((s) => s.id === target.sound)?.sound;
  const layer = doc.layers.find((l) => l.id === target.layer);
  if (!layer) return undefined;
  if (target.kind === 'field') return (layer as Record<string, unknown>)[target.field];
  const track = layer.props[target.prop];
  if (target.kind === 'prop') return isKeyed(track) ? undefined : (track ?? undefined);
  const i = keyIndexAt(track, target.t);
  return i >= 0 && isKeyed(track) ? track.keys[i]!.v : undefined;
}

/** 在文档的副本上写目标处的值（原样写入：参数引用或字面值）；写不进去时返回 null */
export function writeTarget(doc: AnimationDoc, target: BindTarget, value: unknown): AnimationDoc | null {
  const next = structuredClone(doc);
  if (target.kind === 'duration') {
    (next as { duration: unknown }).duration = value;
    return next;
  }
  if (target.kind === 'sound') {
    const s = next.sounds.find((x) => x.id === target.sound);
    if (!s) return null;
    (s as { sound: unknown }).sound = value;
    return next;
  }
  const layer = next.layers.find((l) => l.id === target.layer);
  if (!layer) return null;
  if (target.kind === 'field') {
    if (!(target.field in layer) && !(target.field === 'font' && layer.type === 'text')) return null;
    (layer as Record<string, unknown>)[target.field] = value;
    return next;
  }
  const track = layer.props[target.prop];
  if (target.kind === 'prop') {
    if (isKeyed(track)) return null;
    (layer.props as Record<string, unknown>)[target.prop] = value;
    return next;
  }
  if (!isKeyed(track)) return null;
  const i = keyIndexAt(track, target.t);
  if (i < 0) return null;
  (track.keys[i] as { v: unknown }).v = value;
  return next;
}

/** 目标处解析过的值（绑定时是参数的默认值），用来新建参数时当默认值、解除绑定时写回字面值 */
export function resolvedTarget(doc: AnimationDoc, target: BindTarget): unknown {
  const raw = readTarget(doc, target);
  if (!isParamRef(raw)) return raw;
  return doc.params.find((p) => p.key === raw.$param)?.default;
}

/** 新参数的键的起点：按目标取（方块就是 block、关键帧的值是 yKey），不按名称取（名称可能是中文） */
export function defaultKeyBase(target: BindTarget): string {
  switch (target.kind) {
    case 'duration':
      return 'duration';
    case 'sound':
      return 'sound';
    case 'field':
      return target.field;
    case 'prop':
      return target.prop;
    case 'key':
      return `${target.prop}Key`;
  }
}

/** 新参数的键：从 base 起，重名时加数字 */
export function uniqueParamKey(doc: AnimationDoc, base: string): string {
  const clean = base.replace(/[^a-zA-Z0-9]/g, '').replace(/^[^a-z]+/, '') || 'param';
  const head = clean[0]!.toLowerCase() + clean.slice(1);
  const used = new Set(doc.params.map((p) => p.key));
  if (!used.has(head)) return head;
  for (let i = 2; ; i++) if (!used.has(`${head}${i}`)) return `${head}${i}`;
}

/**
 * 从目标现在的值新建一个参数并把目标绑定上去（“暴露为参数”）。数值参数的范围取默认值附近的合理区间，
 * 用户之后可以在参数表里改。
 */
export function exposeAsParam(doc: AnimationDoc, target: BindTarget, label: string, keyBase: string): { doc: AnimationDoc; key: string } | null {
  const value = resolvedTarget(doc, target);
  // 文字图层可以不写字体（游戏默认字体），其余目标必须有值
  if (value === undefined && !(target.kind === 'field' && target.field === 'font')) return null;
  const key = uniqueParamKey(doc, keyBase);
  const kind = targetKind(target);
  let param: AnimParam;
  switch (kind) {
    case 'number': {
      const v = typeof value === 'number' ? value : 0;
      const span = Math.max(1, Math.abs(v) * 2);
      param = { key, label, type: 'number', default: v, min: Math.min(v, v - span), max: Math.max(v, v + span) };
      break;
    }
    case 'duration': {
      const v = typeof value === 'number' ? value : 1;
      param = { key, label, type: 'duration', default: v, min: Math.min(v, 0.1), max: Math.max(v, 30) };
      break;
    }
    case 'font':
      // 文字图层没写字体时就是游戏默认字体
      param = { key, label, type: 'font', default: (value as Extract<AnimParam, { type: 'font' }>['default'] | undefined) ?? { family: 'minecraft:default' } };
      break;
    default:
      param = { key, label, type: kind, default: value } as AnimParam;
  }
  const bound = writeTarget({ ...doc, params: [...doc.params, param] }, target, { $param: key });
  return bound ? { doc: bound, key } : null;
}

/** 绑定到已有的参数（类型要对得上） */
export function bindTo(doc: AnimationDoc, target: BindTarget, key: string): AnimationDoc | null {
  const p = doc.params.find((x) => x.key === key);
  if (!p || !compatibleTypes(target).includes(p.type)) return null;
  return writeTarget(doc, target, { $param: key });
}

/** 解除绑定：目标处写回参数现在的默认值 */
export function unbind(doc: AnimationDoc, target: BindTarget): AnimationDoc | null {
  const raw = readTarget(doc, target);
  if (!isParamRef(raw)) return null;
  return writeTarget(doc, target, resolvedTarget(doc, target));
}

/** 删参数：所有绑定到它的地方写回它的默认值 */
export function removeParam(doc: AnimationDoc, key: string): AnimationDoc {
  const p = doc.params.find((x) => x.key === key);
  if (!p) return doc;
  const sub = (x: unknown): unknown => {
    if (isParamRef(x)) return x.$param === key ? structuredClone(p.default) : x;
    if (Array.isArray(x)) return x.map(sub);
    if (typeof x === 'object' && x !== null) return Object.fromEntries(Object.entries(x).map(([k, v]) => [k, sub(v)]));
    return x;
  };
  const { params, ...rest } = doc;
  return { ...(sub(rest) as Omit<AnimationDoc, 'params'>), params: params.filter((x) => x.key !== key) };
}

/** 改参数（键、类型不能改；改了默认值时数值参数的范围跟着放宽到包住它） */
export function updateParam(doc: AnimationDoc, key: string, patch: Partial<Omit<AnimParam, 'key' | 'type'>>): AnimationDoc | null {
  const i = doc.params.findIndex((x) => x.key === key);
  if (i < 0) return null;
  const next = structuredClone(doc);
  const merged = { ...next.params[i]!, ...patch } as AnimParam;
  if ((merged.type === 'number' || merged.type === 'duration') && 'default' in patch) {
    merged.min = Math.min(merged.min, merged.default);
    merged.max = Math.max(merged.max, merged.default);
  }
  next.params[i] = merged;
  return next;
}

/** 文档里绑定到这个参数的地方有几处（参数表里显示“用在 N 处”） */
export function paramUsage(doc: AnimationDoc, key: string): number {
  let n = 0;
  const walk = (x: unknown) => {
    if (isParamRef(x)) {
      if (x.$param === key) n++;
      return;
    }
    if (Array.isArray(x)) x.forEach(walk);
    else if (typeof x === 'object' && x !== null) Object.values(x).forEach(walk);
  };
  const { params: _p, ...rest } = doc;
  walk(rest);
  return n;
}

// ---- 音效轨 ----

export function nextSoundId(doc: AnimationDoc): string {
  const used = new Set(doc.sounds.map((s) => s.id));
  for (let i = 1; ; i++) if (!used.has(`sound-${i}`)) return `sound-${i}`;
}

export const SoundPatchSchema = z.strictObject({
  at: z.number().min(0).max(30).optional(),
  sound: z.string().max(256).optional(),
  gain: z.number().min(0).max(2).optional(),
  rate: z.number().min(0.5).max(2).nullable().optional(),
  position: z.strictObject({ x: z.number().min(-64).max(64), y: z.number().min(-64).max(64), z: z.number().min(-64).max(64) }).nullable().optional(),
});
export type SoundPatch = z.infer<typeof SoundPatchSchema>;

/** 改一个音效；rate / position 给 null 是去掉 */
export function updateSound(doc: AnimationDoc, id: string, patch: SoundPatch): AnimationDoc | null {
  const i = doc.sounds.findIndex((s) => s.id === id);
  if (i < 0) return null;
  const next = structuredClone(doc);
  const s = { ...next.sounds[i]! } as AnimSound & Record<string, unknown>;
  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined) continue;
    if (v === null) delete s[k];
    else s[k] = v;
  }
  next.sounds[i] = s;
  next.sounds.sort((a, b) => a.at - b.at);
  return next;
}

/** 编辑器里的当前值：解析过参数（默认值）的文档 */
export function previewDoc(doc: AnimationDoc) {
  return resolveDoc(doc);
}

export function isAnimProp(x: string): x is AnimProp {
  return (ANIM_PROPS as readonly string[]).includes(x);
}

/**
 * 在 t 时刻把图层的几个属性设成这些值（预览里拖动、缩放、旋转用）：绑定到参数的常量或关键帧值改参数的默认值，
 * 有关键帧的自动落关键帧（同检查器），常量直接改。一次返回一份新文档（一步撤销）。
 */
export function setPropValues(doc: AnimationDoc, layerId: string, values: Partial<Record<AnimProp, number>>, t: number): AnimationDoc | null {
  let next = structuredClone(doc);
  const layer = next.layers.find((l) => l.id === layerId);
  if (!layer) return null;
  for (const [prop, value] of Object.entries(values) as [AnimProp, number][]) {
    if (!Number.isFinite(value)) continue;
    const track = layer.props[prop];
    if (isParamRef(track)) {
      next = updateParam(next, track.$param, { default: value } as never) ?? next;
      continue;
    }
    const i = keyIndexAt(track, t);
    if (i >= 0 && isKeyed(track) && isParamRef(track.keys[i]!.v)) {
      next = updateParam(next, (track.keys[i]!.v as { $param: string }).$param, { default: value } as never) ?? next;
      continue;
    }
    const l = next.layers.find((x) => x.id === layerId)!;
    l.props[prop] = setValueAt(l.props[prop], t, value);
  }
  return next;
}
