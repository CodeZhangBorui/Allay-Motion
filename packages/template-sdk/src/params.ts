// 参数值的校验与清洗（docs/04-templates.md 4.4）：类型不对的回到默认值，越界的钳制，多余的键丢弃，缺的补默认值。
// 引擎（装载时）和界面（属性面板、预设、工程）共用这一份。纯函数，不抛错。
import { COLOR_RE, EASING_NAMES, FILE_REF_RE, isAssetRef, isFontFamily, isResourceId, localize, type ParamDef, type ParamDefOf } from './manifest';
import type { ParamValue, ParamValues } from './runtime';

/** text 参数的多语言默认值按这个语言取；缺省英文 */
export interface SanitizeOptions {
  locale?: string;
}

const SEED_MAX = 2_147_483_647;
const BLOCK_WEIGHT_MAX = 1000;

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));

/** 参数的默认值（text 的多语言默认值按 locale 取一次） */
export function defaultValue(def: ParamDef, options: SanitizeOptions = {}): ParamValue {
  if (def.type === 'text') return truncate(localize(def.default, options.locale ?? 'en'), def.maxLength);
  if (def.type === 'blockList') return def.default.map((e) => ({ id: e.id, weight: e.weight }));
  if (def.type === 'easing') return typeof def.default === 'string' ? def.default : [...def.default];
  if (def.type === 'color') return def.default.toUpperCase();
  if (def.type === 'font') return fontDefault(def);
  return def.default;
}

const FONT_FLAGS = ['bold', 'italic', 'underline', 'strikethrough', 'shadow'] as const;
const OUTLINE_RE = /^#[0-9a-fA-F]{6}$/;

/** font 参数的默认值，补全成完整的对象（样式缺省为关，描边为 null） */
function fontDefault(def: ParamDefOf<'font'>): { [key: string]: ParamValue } {
  const d = def.default;
  return {
    family: d.family,
    bold: d.bold ?? false,
    italic: d.italic ?? false,
    underline: d.underline ?? false,
    strikethrough: d.strikethrough ?? false,
    shadow: d.shadow ?? false,
    outline: d.outline ? d.outline.toUpperCase() : null,
  };
}

/** font 参数值的清洗：不是对象回到默认；逐个字段检查，坏的字段取默认值的那一项 */
function sanitizeFont(def: ParamDefOf<'font'>, value: unknown): { [key: string]: ParamValue } {
  const d = fontDefault(def);
  if (!value || typeof value !== 'object' || Array.isArray(value)) return d;
  const v = value as Record<string, unknown>;
  const out: { [key: string]: ParamValue } = { family: typeof v.family === 'string' && isFontFamily(v.family) ? v.family : d.family! };
  for (const k of FONT_FLAGS) out[k] = typeof v[k] === 'boolean' ? v[k] : d[k]!;
  out.outline = v.outline === null ? null : typeof v.outline === 'string' && OUTLINE_RE.test(v.outline) ? v.outline.toUpperCase() : d.outline!;
  return out;
}

function truncate(text: string, maxLength: number | undefined): string {
  if (maxLength === undefined) return text;
  const chars = [...text];
  return chars.length > maxLength ? chars.slice(0, maxLength).join('') : text;
}

/** 单个参数值的清洗：返回合法的值 */
export function sanitizeValue(def: ParamDef, value: unknown, options: SanitizeOptions = {}): ParamValue {
  const fallback = () => defaultValue(def, options);
  switch (def.type) {
    case 'number':
    case 'duration':
      return isNum(value) ? clamp(value, def.min, def.max) : fallback();
    case 'integer':
      // 带小数的数字取整后再钳制（类型仍是数字）
      return isNum(value) ? clamp(Math.round(value), def.min, def.max) : fallback();
    case 'seed':
      return isNum(value) ? clamp(Math.round(value), 0, SEED_MAX) : fallback();
    case 'angle': {
      if (!isNum(value)) return fallback();
      // 角度没有上下限：折回 [0, 360)
      const a = ((value % 360) + 360) % 360;
      return a === 360 ? 0 : a;
    }
    case 'boolean':
      return typeof value === 'boolean' ? value : fallback();
    case 'enum':
      return typeof value === 'string' && def.options.some((o) => o.value === value) ? value : fallback();
    case 'color': {
      if (typeof value !== 'string' || !COLOR_RE.test(value)) return fallback();
      const upper = value.toUpperCase();
      // 不允许 alpha 时去掉 alpha 通道
      return !def.alpha && upper.length === 9 ? upper.slice(0, 7) : upper;
    }
    case 'text':
      return typeof value === 'string' ? truncate(value, def.maxLength) : fallback();
    case 'block':
    case 'item':
      return typeof value === 'string' && isResourceId(value) ? value : fallback();
    case 'sound':
      if (value === null) return null;
      return typeof value === 'string' && isResourceId(value) ? value : fallback();
    case 'texture': {
      if (typeof value !== 'string' || value.length > 256) return fallback();
      if (value === '' || isResourceId(value) || isAssetRef(value)) return value;
      return def.allowFile && FILE_REF_RE.test(value) ? value : fallback();
    }
    case 'easing': {
      if (typeof value === 'string') return (EASING_NAMES as readonly string[]).includes(value) ? value : fallback();
      if (Array.isArray(value) && value.length === 4 && value.every(isNum)) {
        const [x1, y1, x2, y2] = value as [number, number, number, number];
        return [clamp(x1, 0, 1), y1, clamp(x2, 0, 1), y2];
      }
      return fallback();
    }
    case 'font':
      return sanitizeFont(def, value);
    case 'blockList': {
      if (!Array.isArray(value)) return fallback();
      const max = def.max ?? 64;
      const out: { id: string; weight: number }[] = [];
      for (const entry of value) {
        // 形状不对的条目丢掉
        if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue;
        const { id, weight } = entry as { id?: unknown; weight?: unknown };
        if (typeof id !== 'string' || !isResourceId(id)) continue;
        out.push({ id, weight: isNum(weight) ? clamp(weight, 0, BLOCK_WEIGHT_MAX) : 1 });
        if (out.length >= max) break;
      }
      // 空列表或权重全为 0 都没法用，回到默认
      return out.length > 0 && out.some((e) => e.weight > 0) ? out : fallback();
    }
  }
}

/** 整组参数的清洗：只保留定义过的键，逐个清洗，缺的补默认值 */
export function sanitizeParams(defs: readonly ParamDef[], values: Readonly<Record<string, unknown>> | null | undefined, options: SanitizeOptions = {}): ParamValues {
  const out: ParamValues = {};
  const src = values && typeof values === 'object' && !Array.isArray(values) ? values : {};
  for (const def of defs) {
    out[def.key] = Object.hasOwn(src, def.key) ? sanitizeValue(def, src[def.key], options) : defaultValue(def, options);
  }
  return out;
}

/** 全部参数的默认值 */
export function defaultParams(defs: readonly ParamDef[], options: SanitizeOptions = {}): ParamValues {
  return sanitizeParams(defs, {}, options);
}

/** 两个参数值是否相同（按 JSON 结构比较） */
export function sameValue(a: ParamValue | undefined, b: ParamValue | undefined): boolean {
  if (a === b) return true;
  if (a === null || b === null || a === undefined || b === undefined || typeof a !== 'object' || typeof b !== 'object') return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((x, i) => sameValue(x, b[i]));
  const ka = Object.keys(a);
  const kb = Object.keys(b);
  const ob = b as Record<string, ParamValue>;
  return ka.length === kb.length && ka.every((k) => Object.hasOwn(ob, k) && sameValue((a as Record<string, ParamValue>)[k], ob[k]));
}

/**
 * 只留下与默认值不同的参数（预设、工程文件只存这些，4.7、1.9）。
 * text 参数与任一语言的默认值相同都算“没改”。
 */
export function diffFromDefaults(defs: readonly ParamDef[], values: Readonly<Record<string, unknown>>, options: SanitizeOptions = {}): ParamValues {
  const clean = sanitizeParams(defs, values, options);
  const out: ParamValues = {};
  for (const def of defs) {
    const v = clean[def.key];
    if (def.type === 'text' && typeof def.default !== 'string') {
      const defaults = Object.values(def.default).map((t) => truncate(t ?? '', def.maxLength));
      if (defaults.includes(v as string)) continue;
    } else if (sameValue(v, defaultValue(def, options))) continue;
    out[def.key] = v!;
  }
  return out;
}

/** 模板的种子：第一个 seed 类型参数的值（4.4：模板有 seed 参数时 ctx.random 以它为种子） */
export function seedOf(defs: readonly ParamDef[], values: Readonly<ParamValues>): number | null {
  const def = defs.find((d) => d.type === 'seed');
  if (!def) return null;
  const v = values[def.key];
  return isNum(v) ? v : null;
}
