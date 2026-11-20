// 把文档里绑定到参数的值换成参数的取值（docs/animation-editor.md 3.4）。
// 编辑器里用参数的默认值求值（画曲线、显示当前值、实时预览）；Worker 里 runtime.template.js 的 resolveAnimation
// 用 ctx.params 做同样的事。两份写法不同、规则相同，T-ANIM-11 核对两者的结果一致。
//
// 规则：
// - {"$param": 键} 换成参数的值（模板用户在属性面板里取的值；没有就是参数的默认值）。
// - 整段时长绑定到 duration 参数时，所有时刻按“取值 ÷ 默认值”等比伸缩：关键帧的 t、图层的 from / to、音效的 at、剪辑点。
import type { AnimationDoc, AnimParam, ParamRef } from './schema';
import { isParamRef } from './schema';

/** 去掉类型里的参数引用：绑定的值换成它的取值之后的形状 */
// 映射类型作用在数组、元组上时保留它们的形状（贝塞尔缓动的四元组仍是四元组）
export type Unref<T> = T extends ParamRef ? never : T extends object ? { [K in keyof T]: Unref<T[K]> } : T;
export type ResolvedDoc = Unref<Omit<AnimationDoc, 'params'>> & { params: AnimationDoc['params'] };
export type ResolvedLayer = ResolvedDoc['layers'][number];

export type ParamValueMap = Readonly<Record<string, unknown>>;

/** 参数的默认值表 */
export function paramDefaults(doc: Pick<AnimationDoc, 'params'>): Record<string, unknown> {
  return Object.fromEntries(doc.params.map((p) => [p.key, p.default]));
}

/** 一个参数的取值：values 里有、类型大致对得上就用它，否则用默认值（类型由 manifest 的校验保证，这里只兜底） */
function valueOf(p: AnimParam, values: ParamValueMap): unknown {
  const v = values[p.key];
  if (v === undefined || v === null) return p.default;
  switch (p.type) {
    case 'number':
    case 'duration':
      return typeof v === 'number' && Number.isFinite(v) ? Math.min(p.max, Math.max(p.min, v)) : p.default;
    case 'font':
      return typeof v === 'object' && !Array.isArray(v) && typeof (v as { family?: unknown }).family === 'string' ? v : p.default;
    default:
      return typeof v === 'string' && v !== '' ? v : p.default;
  }
}

export function resolveDoc(doc: AnimationDoc, values: ParamValueMap = {}): ResolvedDoc {
  const params = new Map(doc.params.map((p) => [p.key, p]));
  const sub = (x: unknown): unknown => {
    if (isParamRef(x)) {
      const p = params.get(x.$param);
      return p ? valueOf(p, values) : undefined;
    }
    if (Array.isArray(x)) return x.map(sub);
    if (typeof x === 'object' && x !== null) return Object.fromEntries(Object.entries(x).map(([k, v]) => [k, sub(v)]));
    return x;
  };
  const { params: _p, ...rest } = doc;
  const out = sub(rest) as Omit<ResolvedDoc, 'params'>;
  // 时长绑定到参数：所有时刻等比伸缩
  let scale = 1;
  if (isParamRef(doc.duration)) {
    const p = params.get(doc.duration.$param);
    if (p && p.type === 'duration' && p.default > 0) scale = (out.duration as number) / p.default;
  }
  if (scale !== 1) {
    const st = (t: number) => t * scale;
    out.cutTime = out.cutTime === null ? null : st(out.cutTime);
    for (const s of out.sounds) s.at = st(s.at);
    for (const l of out.layers) {
      if (l.from !== undefined) l.from = st(l.from);
      if (l.to !== undefined) l.to = st(l.to);
      for (const track of Object.values(l.props)) if (track !== undefined && typeof track === 'object') for (const k of track.keys) k.t = st(k.t);
    }
  }
  return { ...out, params: doc.params };
}

/** 整段时长（绑定时取参数的默认值） */
export function docDuration(doc: Pick<AnimationDoc, 'duration' | 'params'>): number {
  if (!isParamRef(doc.duration)) return doc.duration;
  const key = doc.duration.$param;
  const p = doc.params.find((x) => x.key === key);
  return p && p.type === 'duration' ? p.default : 1;
}
