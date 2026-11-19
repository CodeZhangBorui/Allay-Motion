// 实时预览的“代码 ↔ 时刻”映射（docs/animation-editor.md 9.3）。完全从动画文档的结构推出来：
// 某一时刻哪些图层可见、每条属性轨道处在哪两个关键帧之间、用的哪个缓动——这些都是文档本身的数据，
// 不需要在 Worker 里埋运行时探针（画面仍是时间的纯函数，硬性规则 2）。
// 文本位置来自一个记录位置的 JSON 解析（用户自己排版的文本也能定位），不依赖 serializeAnimation 的格式。
import type { ResolvedDoc } from './resolve';
import { bindingSites, isKeyed, offsetToLineColumn, type AnimationDoc } from './schema';

export interface JsonSpan {
  /** 值开始、结束的偏移（结束不含） */
  start: number;
  end: number;
}

/** 解析 JSON，记下每个值的位置：键是路径（"layers.0.props.y.keys.1"），根是 ""。不合法时为 null */
export function locateJson(text: string): Map<string, JsonSpan> | null {
  const out = new Map<string, JsonSpan>();
  let i = 0;
  const ws = () => {
    while (i < text.length && (text[i] === ' ' || text[i] === '\t' || text[i] === '\n' || text[i] === '\r')) i++;
  };
  const fail = (): never => {
    throw new Error('bad json');
  };
  const str = (): string => {
    const start = i;
    i++;
    while (i < text.length && text[i] !== '"') i += text[i] === '\\' ? 2 : 1;
    if (text[i] !== '"') fail();
    i++;
    return JSON.parse(text.slice(start, i)) as string;
  };
  const value = (path: string): void => {
    ws();
    const start = i;
    const c = text[i];
    if (c === '{') {
      i++;
      ws();
      if (text[i] !== '}') {
        for (;;) {
          ws();
          if (text[i] !== '"') fail();
          const keyStart = i;
          const key = str();
          ws();
          if (text[i] !== ':') fail();
          i++;
          const child = path ? `${path}.${key}` : key;
          value(child);
          // 对象的成员从键名开始算（点在键名上也算点到了这个成员）
          out.set(child, { start: keyStart, end: i });
          ws();
          if (text[i] === ',') {
            i++;
            continue;
          }
          if (text[i] === '}') break;
          fail();
        }
      }
      i++;
    } else if (c === '[') {
      i++;
      ws();
      let n = 0;
      if (text[i] !== ']') {
        for (;;) {
          value(path ? `${path}.${n}` : String(n));
          n++;
          ws();
          if (text[i] === ',') {
            i++;
            continue;
          }
          if (text[i] === ']') break;
          fail();
        }
      }
      i++;
    } else if (c === '"') str();
    else {
      const m = /^(-?(0|[1-9]\d*)(\.\d+)?([eE][+-]?\d+)?|true|false|null)/.exec(text.slice(i));
      if (!m) fail();
      i += m![0].length;
    }
    out.set(path, { start, end: i });
  };
  try {
    value('');
    ws();
    return i === text.length ? out : null;
  } catch {
    return null;
  }
}

export type LiveMarkKind = 'layer' | 'segment' | 'hold' | 'edge' | 'param';

/** 一处“这一刻在生效”的代码：从 line 到 endLine（含），带说明 */
export interface LiveMark {
  kind: LiveMarkKind;
  line: number;
  endLine: number;
  /** 例如“方块 · y · backOut（0–0.6 s）” */
  label: string;
}

const lineOf = (text: string, offset: number) => offsetToLineColumn(text, offset).line;

const easeLabel = (e: unknown): string => (e === undefined ? 'linear' : Array.isArray(e) ? `bezier(${e.join(', ')})` : String(e));

/**
 * t 时刻在生效的代码：每个可见图层的开头一行；每条有关键帧的属性所处的区间（前后两个关键帧，标出缓动）；
 * 在第一个关键帧之前或最后一个之后时标出那个关键帧（edge）。常量属性不标。
 */
export function liveMarks(doc: ResolvedDoc, text: string, t: number, spans = locateJson(text), raw?: AnimationDoc): LiveMark[] {
  if (!spans) return [];
  const marks: LiveMark[] = [];
  if (raw) marks.push(...bindingMarks(raw, doc, text, t, spans));
  doc.layers.forEach((layer, li) => {
    const from = layer.from ?? 0;
    const to = layer.to ?? Infinity;
    if (t < from || t >= to) return;
    const ls = spans.get(`layers.${li}`);
    if (!ls) return;
    marks.push({ kind: 'layer', line: lineOf(text, ls.start), endLine: lineOf(text, ls.start), label: layer.name });
    // 复制器（第三轮）：可见时标出整个 repeat，说明写份数和错开
    const rs = layer.repeat ? spans.get(`layers.${li}.repeat`) : undefined;
    if (rs && layer.repeat) {
      const n = layer.repeat.mode === 'grid' ? layer.repeat.cols * layer.repeat.rows : layer.repeat.count;
      marks.push({ kind: 'param', line: lineOf(text, rs.start), endLine: lineOf(text, rs.end), label: `${layer.name} · repeat ×${n}${layer.repeat.stagger > 0 ? ` · +${layer.repeat.stagger}s` : ''}` });
    }
    // 路径（第三轮）：可见时标出整个 path
    const ps = layer.path ? spans.get(`layers.${li}.path`) : undefined;
    if (ps && layer.path) {
      marks.push({ kind: 'param', line: lineOf(text, ps.start), endLine: lineOf(text, ps.end), label: `${layer.name} · path ×${layer.path.points.length}${layer.path.closed ? ' · closed' : ''}${layer.path.orient ? ' · orient' : ''}` });
    }
    for (const [prop, track] of Object.entries(layer.props)) {
      if (track === undefined || typeof track === 'number') continue;
      const keys = track.keys;
      const at = (k: number) => spans.get(`layers.${li}.props.${prop}.keys.${k}`);
      if (t < keys[0]!.t || t >= keys[keys.length - 1]!.t || keys.length === 1) {
        const k = t < keys[0]!.t ? 0 : keys.length - 1;
        const s = at(k);
        if (s) marks.push({ kind: 'edge', line: lineOf(text, s.start), endLine: lineOf(text, s.end), label: `${layer.name} · ${prop} = ${keys[k]!.v}` });
        continue;
      }
      let k = 0;
      while (k < keys.length - 2 && t >= keys[k + 1]!.t) k++;
      const a = at(k);
      const b = at(k + 1);
      if (!a || !b) continue;
      const hold = keys[k]!.ease === 'hold';
      marks.push({
        kind: hold ? 'hold' : 'segment',
        line: lineOf(text, a.start),
        endLine: lineOf(text, b.end),
        label: `${layer.name} · ${prop} · ${easeLabel(keys[k]!.ease)}（${keys[k]!.t}–${keys[k + 1]!.t} s）`,
      });
    }
  });
  return marks;
}

/**
 * 在代码里点某处：它生效的时刻。关键帧 → 它的 t；图层里别处 → 可见区间的开头（没有就是它第一个关键帧）；
 * 音效 → 它的 at；时长、剪辑点 → 那个时刻。认不出时为 null（不跳）。
 */
export function timeAtOffset(doc: ResolvedDoc, text: string, offset: number, spans = locateJson(text)): number | null {
  if (!spans) return null;
  let best: { path: string; size: number } | null = null;
  for (const [path, s] of spans) {
    if (offset < s.start || offset > s.end) continue;
    const size = s.end - s.start;
    if (!best || size < best.size) best = { path, size };
  }
  if (!best) return null;
  const parts = best.path.split('.');
  // 从最深处往上找第一个有意义的节点
  for (let n = parts.length; n > 0; n--) {
    const p = parts.slice(0, n);
    if (p[0] === 'layers' && p.length >= 1) {
      const li = Number(p[1]);
      const layer = doc.layers[li];
      if (!layer) return null;
      if (p[2] === 'props' && p[4] === 'keys' && p[5] !== undefined) {
        const track = layer.props[p[3] as keyof typeof layer.props];
        const key = isKeyed(track) ? track.keys[Number(p[5])] : undefined;
        if (key) return key.t;
        continue;
      }
      if (p.length > 4) continue;
      if (p[2] === 'props' && p[3]) {
        const track = layer.props[p[3] as keyof typeof layer.props];
        if (isKeyed(track)) return track.keys[0]!.t;
      }
      if (p[2] === 'to' && layer.to !== undefined) return Math.max(0, layer.to - 1e-3);
      if (p.length <= 3) {
        if (layer.from !== undefined) return layer.from;
        const first = Object.values(layer.props).flatMap((tr) => (isKeyed(tr) ? [tr.keys[0]!.t] : []));
        return first.length > 0 ? Math.min(...first) : 0;
      }
    }
    if (p[0] === 'sounds' && p[1] !== undefined) {
      const s = doc.sounds[Number(p[1])];
      if (s) return s.at;
    }
    if (p.length === 1 && p[0] === 'cutTime' && doc.cutTime !== null) return doc.cutTime;
    if (p.length === 1 && p[0] === 'duration') return doc.duration;
  }
  return null;
}

/** 值的简短写法（实时预览的说明里用） */
function short(v: unknown): string {
  if (typeof v === 'number') return String(Math.round(v * 1000) / 1000);
  if (typeof v === 'string') return v.length > 32 ? `${v.slice(0, 31)}…` : v;
  if (typeof v === 'object' && v !== null && 'family' in v) return String((v as { family: unknown }).family);
  return JSON.stringify(v) ?? '';
}

/**
 * 这一刻在生效的参数绑定（第三轮第 12 项）：可见图层里绑定到参数的值、整段时长、音效。每处绑定标两段：
 * 用到参数的那个值，和参数表里这个参数的定义；说明里写“图层 · 字段 ← 参数键 = 取值”。
 * 关键帧的值只在它所在的区间（前后两个关键帧之一）正在生效时标。
 */
export function bindingMarks(raw: AnimationDoc, resolved: ResolvedDoc, text: string, t: number, spans: Map<string, JsonSpan>): LiveMark[] {
  const out: LiveMark[] = [];
  const paramLine = new Map<string, { line: number; endLine: number }>();
  raw.params.forEach((p, i) => {
    const s = spans.get(`params.${i}`);
    if (s) paramLine.set(p.key, { line: lineOf(text, s.start), endLine: lineOf(text, s.end) });
  });
  for (const site of bindingSites(raw)) {
    const [head, li, , prop, , ki] = site.path;
    let where: string;
    if (head === 'layers' && typeof li === 'number') {
      const layer = resolved.layers[li];
      if (!layer) continue;
      if (t < (layer.from ?? 0) || t >= (layer.to ?? Infinity)) continue;
      if (typeof ki === 'number' && typeof prop === 'string') {
        // 关键帧的值：只在它两侧的区间生效时标
        const keys = (layer.props as Record<string, { keys?: { t: number }[] } | number | undefined>)[prop];
        const list = typeof keys === 'object' && keys !== null && Array.isArray(keys.keys) ? keys.keys : [];
        const prev = list[ki - 1]?.t ?? -Infinity;
        const next = list[ki + 1]?.t ?? Infinity;
        if (t < prev || t > next) continue;
      }
      where = `${layer.name} · ${site.path.slice(2).filter((x) => typeof x === 'string' && x !== 'props' && x !== 'keys' && x !== 'v').join('.')}`;
    } else if (head === 'sounds' && typeof li === 'number') where = `sound ${li + 1}`;
    else where = String(head);
    const span = spans.get(site.path.join('.'));
    if (!span) continue;
    const value = resolved.params.find((p) => p.key === site.value.$param)?.default;
    const label = `${where} ← ${site.value.$param} = ${short(value)}`;
    out.push({ kind: 'param', line: lineOf(text, span.start), endLine: lineOf(text, span.end), label });
    const def = paramLine.get(site.value.$param);
    if (def) out.push({ kind: 'param', line: def.line, endLine: def.endLine, label });
  }
  return out;
}
