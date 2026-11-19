// Minecraft 版本检索与资源包格式匹配（docs/03-assets.md 3.12）。纯逻辑，不读文件、不联网。
//
// 版本从三处来：Mojang 版本清单（只在用户点了“获取版本列表”时取）、本机 versions/<id>/ 目录、下载缓存。
// 每个版本的资源包格式号优先取客户端 jar 根目录的 version.json（pack_version.resource），
// 读不到时查下面的对照表；资源包的格式号来自 pack.mcmeta。
import { z } from 'zod';

/** 格式号：1.21.9 起是“主.次”两段，旧版只有整数。比较时按 major 再 minor */
export interface PackFormat {
  major: number;
  minor: number;
}

export interface PackFormatRange {
  min: PackFormat;
  max: PackFormat;
}

export function formatToString(f: PackFormat): string {
  return f.minor === 0 ? String(f.major) : `${f.major}.${f.minor}`;
}

export function compareFormat(a: PackFormat, b: PackFormat): number {
  return a.major - b.major || a.minor - b.minor;
}

const Int = z.number().int().nonnegative();
/** 整数，或 [主, 次] */
const FormatValue = z.union([Int.transform((major) => ({ major, minor: 0 })), z.tuple([Int, Int]).transform(([major, minor]) => ({ major, minor })), z.tuple([Int]).transform(([major]) => ({ major, minor: 0 }))]);
/** supported_formats：整数、[最小, 最大]，或 { min_inclusive, max_inclusive } */
const SupportedFormats = z.union([
  Int.transform((n) => ({ min: n, max: n })),
  z.tuple([Int, Int]).transform(([min, max]) => ({ min, max })),
  z.looseObject({ min_inclusive: Int, max_inclusive: Int }).transform((o) => ({ min: o.min_inclusive, max: o.max_inclusive })),
]);

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text.trimStart()) as unknown;
  } catch {
    return undefined;
  }
}

function obj(v: unknown): Record<string, unknown> | undefined {
  return typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : undefined;
}

/**
 * pack.mcmeta 声明的格式范围。规则（按游戏的读法）：
 * - 1.21.9 起：min_format、max_format（整数或 [主, 次]）；
 * - 1.20.2 起：pack_format 加可选的 supported_formats（范围）；
 * - 更早：只有 pack_format。
 * 字段都缺或类型不对时返回 null。
 */
export function parsePackFormatRange(text: string): PackFormatRange | null {
  const pack = obj(obj(parseJson(text))?.pack);
  if (!pack) return null;
  const minF = FormatValue.safeParse(pack.min_format);
  const maxF = FormatValue.safeParse(pack.max_format);
  if (minF.success || maxF.success) {
    const min = minF.success ? minF.data : maxF.data!;
    const max = maxF.success ? maxF.data : { major: min.major, minor: Number.MAX_SAFE_INTEGER };
    return compareFormat(min, max) <= 0 ? { min, max } : { min: max, max: min };
  }
  const pf = Int.safeParse(pack.pack_format);
  const sf = SupportedFormats.safeParse(pack.supported_formats);
  if (sf.success) {
    const lo = Math.min(sf.data.min, sf.data.max, pf.success ? pf.data : Infinity);
    const hi = Math.max(sf.data.min, sf.data.max, pf.success ? pf.data : -Infinity);
    return { min: { major: lo, minor: 0 }, max: { major: hi, minor: Number.MAX_SAFE_INTEGER } };
  }
  if (pf.success) return { min: { major: pf.data, minor: 0 }, max: { major: pf.data, minor: Number.MAX_SAFE_INTEGER } };
  return null;
}

export interface JarVersionInfo {
  id: string;
  name?: string;
  /** 这个版本的资源包格式号；jar 里没写时为 undefined */
  resourceFormat?: PackFormat;
}

/**
 * 客户端 jar 根目录的 version.json（1.14 起有）。pack_version 的写法：
 * 整数（1.14–1.16）、{ resource, data }（1.17 起）、{ resource_major, resource_minor, ... }（1.21.9 起）。
 */
export function parseJarVersionJson(text: string): JarVersionInfo | null {
  const root = obj(parseJson(text));
  if (!root || typeof root.id !== 'string') return null;
  const out: JarVersionInfo = { id: root.id.slice(0, 64) };
  if (typeof root.name === 'string') out.name = root.name.slice(0, 64);
  const pv = root.pack_version;
  const asInt = Int.safeParse(pv);
  if (asInt.success) out.resourceFormat = { major: asInt.data, minor: 0 };
  const o = obj(pv);
  if (o) {
    const major = Int.safeParse(o.resource_major);
    const minor = Int.safeParse(o.resource_minor);
    const plain = Int.safeParse(o.resource);
    if (major.success) out.resourceFormat = { major: major.data, minor: minor.success ? minor.data : 0 };
    else if (plain.success) out.resourceFormat = { major: plain.data, minor: 0 };
  }
  return out;
}

/**
 * 正式版 → 资源包格式号的对照表，只在 jar 里读不到 version.json 时用（1.14 之前的版本、jar 打不开时的展示）。
 * 按公开资料整理，没有联网逐条复核（decisions.md“2026-11 反馈：素材与音效”）；较新的版本一律以 jar 为准。
 */
const FORMAT_TABLE: readonly [first: string, last: string, format: number][] = [
  ['1.6.1', '1.8.9', 1],
  ['1.9', '1.10.2', 2],
  ['1.11', '1.12.2', 3],
  ['1.13', '1.14.4', 4],
  ['1.15', '1.16.1', 5],
  ['1.16.2', '1.16.5', 6],
  ['1.17', '1.17.1', 7],
  ['1.18', '1.18.2', 8],
  ['1.19', '1.19.2', 9],
  ['1.19.3', '1.19.3', 12],
  ['1.19.4', '1.19.4', 13],
  ['1.20', '1.20.1', 15],
  ['1.20.2', '1.20.2', 18],
  ['1.20.3', '1.20.4', 22],
  ['1.20.5', '1.20.6', 32],
  ['1.21', '1.21.1', 34],
  ['1.21.2', '1.21.3', 42],
  ['1.21.4', '1.21.4', 46],
  ['1.21.5', '1.21.5', 55],
  ['1.21.6', '1.21.6', 63],
  ['1.21.7', '1.21.8', 64],
];

/** 只认纯数字的正式版号（1.21.4、26.3）；快照、预发布返回 null */
export function parseReleaseNumber(id: string): number[] | null {
  if (!/^\d+(\.\d+){1,3}$/.test(id)) return null;
  return id.split('.').map(Number);
}

function cmpNumbers(a: readonly number[], b: readonly number[]): number {
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const d = (a[i] ?? 0) - (b[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}

/** 对照表里查正式版的格式号；查不到（快照、表外的新版本）返回 null */
export function knownResourceFormat(versionId: string): PackFormat | null {
  const v = parseReleaseNumber(versionId);
  if (!v) return null;
  for (const [first, last, format] of FORMAT_TABLE) {
    if (cmpNumbers(v, parseReleaseNumber(first)!) >= 0 && cmpNumbers(v, parseReleaseNumber(last)!) <= 0) return { major: format, minor: 0 };
  }
  return null;
}

/** 格式号对应的正式版范围（展示“为 1.21.4 制作”）；对照表外返回 null */
export function releasesForFormat(format: PackFormat): string | null {
  const rows = FORMAT_TABLE.filter((r) => r[2] === format.major);
  if (rows.length === 0) return null;
  const [first, last] = [rows[0]![0], rows[rows.length - 1]![1]];
  return first === last ? first : `${first}–${last}`;
}

/** 资源包与原版基底的匹配：ok 在范围内；older 包比基底旧；newer 包比基底新；unknown 有一边不知道 */
export type PackCompat = 'ok' | 'older' | 'newer' | 'unknown';

export function packCompat(range: PackFormatRange | null, base: PackFormat | null): PackCompat {
  if (!range || !base) return 'unknown';
  if (compareFormat(base, range.min) < 0) return 'newer';
  if (compareFormat(base, range.max) > 0) return 'older';
  return 'ok';
}

// ---------------------------------------------------------------------------
// 版本列表的排序与筛选

export type VersionType = 'release' | 'snapshot' | 'old';

export function versionType(type: string): VersionType {
  return type === 'release' ? 'release' : type === 'snapshot' ? 'snapshot' : 'old';
}

export interface VersionSortable {
  versionId: string;
  releaseTime?: string | null;
}

/**
 * 新的在前：先按发布时间（版本 JSON 和版本清单的 releaseTime）；没有发布时间时按纯数字版本号；
 * 都比不出来时按 id 的字典序倒序，保证结果稳定。
 */
export function compareVersionsDesc(a: VersionSortable, b: VersionSortable): number {
  const ta = a.releaseTime ? Date.parse(a.releaseTime) : NaN;
  const tb = b.releaseTime ? Date.parse(b.releaseTime) : NaN;
  if (!Number.isNaN(ta) && !Number.isNaN(tb) && ta !== tb) return tb - ta;
  const na = parseReleaseNumber(a.versionId);
  const nb = parseReleaseNumber(b.versionId);
  if (na && nb) {
    const d = cmpNumbers(nb, na);
    if (d !== 0) return d;
  }
  return a.versionId < b.versionId ? 1 : a.versionId > b.versionId ? -1 : 0;
}

/** 搜索：忽略大小写，空格分开的每个词都要出现在版本号或附加文字（启动器名、路径）里 */
export function matchesVersionQuery(query: string, ...fields: (string | null | undefined)[]): boolean {
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return true;
  const hay = fields.filter(Boolean).join(' ').toLowerCase();
  return words.every((w) => hay.includes(w));
}
