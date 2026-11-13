// 最小的 semver：模板版本号（manifest.version）和版本范围（派生模板的 extends.version、minAppVersion）。
// 只支持模板用得到的写法：精确版本、^、~、>=、>、<=、<、=、*、x 通配，以及用空格连接的多个条件（同时满足）。
// 不引入 semver 包：template-sdk 只能依赖 zod（1.4）。

export interface SemVer {
  major: number;
  minor: number;
  patch: number;
  /** 预发布标识（- 之后的部分按 . 分开）；正式版为空数组 */
  pre: string[];
}

const VERSION_RE = /^v?(0|[1-9]\d{0,8})\.(0|[1-9]\d{0,8})\.(0|[1-9]\d{0,8})(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;

/** 解析版本号；不合法时返回 null */
export function parseVersion(text: string): SemVer | null {
  const m = VERSION_RE.exec(text.trim());
  if (!m) return null;
  return { major: Number(m[1]), minor: Number(m[2]), patch: Number(m[3]), pre: m[4] ? m[4].split('.') : [] };
}

export function isValidVersion(text: string): boolean {
  return parseVersion(text) !== null;
}

function comparePre(a: string[], b: string[]): number {
  if (a.length === 0 && b.length === 0) return 0;
  if (a.length === 0) return 1;
  if (b.length === 0) return -1;
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const x = a[i];
    const y = b[i];
    if (x === undefined) return -1;
    if (y === undefined) return 1;
    const xn = /^\d+$/.test(x);
    const yn = /^\d+$/.test(y);
    if (xn && yn) {
      const d = Number(x) - Number(y);
      if (d !== 0) return Math.sign(d);
    } else if (xn !== yn) {
      return xn ? -1 : 1;
    } else if (x !== y) {
      return x < y ? -1 : 1;
    }
  }
  return 0;
}

export function compareVersions(a: SemVer, b: SemVer): number {
  return Math.sign(a.major - b.major) || Math.sign(a.minor - b.minor) || Math.sign(a.patch - b.patch) || comparePre(a.pre, b.pre);
}

/** 比较两个版本号字符串；不合法的排在最前 */
export function compareVersionStrings(a: string, b: string): number {
  const x = parseVersion(a);
  const y = parseVersion(b);
  if (!x || !y) return x ? 1 : y ? -1 : a < b ? -1 : a > b ? 1 : 0;
  return compareVersions(x, y);
}

type Comparator = { op: '>=' | '>' | '<=' | '<' | '='; v: SemVer };

/** 部分版本（"1"、"1.2"、"1.x"、"*"）：缺的部分是通配 */
function parsePartial(text: string): { major: number | null; minor: number | null; patch: number | null; pre: string[] } | null {
  if (text === '*' || text === 'x' || text === 'X' || text === '') return { major: null, minor: null, patch: null, pre: [] };
  const full = parseVersion(text);
  if (full) return full;
  const m = /^v?(\d{1,9}|[xX*])(?:\.(\d{1,9}|[xX*]))?(?:\.(\d{1,9}|[xX*]))?$/.exec(text);
  if (!m) return null;
  const num = (s: string | undefined) => (s === undefined || /^[xX*]$/.test(s) ? null : Number(s));
  const major = num(m[1]);
  const minor = major === null ? null : num(m[2]);
  const patch = minor === null ? null : num(m[3]);
  return { major, minor, patch, pre: [] };
}

const v = (major: number, minor: number, patch: number, pre: string[] = []): SemVer => ({ major, minor, patch, pre });

function comparatorsFor(token: string): Comparator[] | null {
  const m = /^(\^|~|>=|<=|>|<|=)?(.*)$/.exec(token);
  if (!m) return null;
  const op = m[1] ?? '';
  const p = parsePartial(m[2]!);
  if (!p) return null;
  const { major, minor, patch, pre } = p;
  if (major === null) return op === '<' || op === '>' ? [{ op: '<', v: v(0, 0, 0, ['0']) }] : [];
  const lo = v(major, minor ?? 0, patch ?? 0, pre);
  switch (op) {
    case '^': {
      let hi: SemVer;
      if (major > 0 || minor === null) hi = v(major + 1, 0, 0, ['0']);
      else if (minor > 0 || patch === null) hi = v(0, minor + 1, 0, ['0']);
      else hi = v(0, 0, patch + 1, ['0']);
      return [{ op: '>=', v: lo }, { op: '<', v: hi }];
    }
    case '~': {
      const hi = minor === null ? v(major + 1, 0, 0, ['0']) : v(major, minor + 1, 0, ['0']);
      return [{ op: '>=', v: lo }, { op: '<', v: hi }];
    }
    case '>=':
    case '<':
      return [{ op, v: lo }];
    case '>':
      if (minor === null) return [{ op: '>=', v: v(major + 1, 0, 0) }];
      if (patch === null) return [{ op: '>=', v: v(major, minor + 1, 0) }];
      return [{ op: '>', v: lo }];
    case '<=':
      if (minor === null) return [{ op: '<', v: v(major + 1, 0, 0, ['0']) }];
      if (patch === null) return [{ op: '<', v: v(major, minor + 1, 0, ['0']) }];
      return [{ op: '<=', v: lo }];
    default:
      // 精确版本，或带通配的部分版本（"1.x" 等于 ~1 的范围）
      if (minor === null) return [{ op: '>=', v: lo }, { op: '<', v: v(major + 1, 0, 0, ['0']) }];
      if (patch === null) return [{ op: '>=', v: lo }, { op: '<', v: v(major, minor + 1, 0, ['0']) }];
      return [{ op: '=', v: lo }];
  }
}

function parseRange(range: string): Comparator[] | null {
  const tokens = range.trim().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return [];
  if (tokens.length > 8) return null;
  const out: Comparator[] = [];
  for (const t of tokens) {
    const c = comparatorsFor(t);
    if (!c) return null;
    out.push(...c);
  }
  return out;
}

export function isValidRange(range: string): boolean {
  return range.length <= 64 && parseRange(range) !== null;
}

/** 版本是否满足范围。预发布版只有在范围里写了同一个 major.minor.patch 的预发布时才匹配（与 npm 相同） */
export function satisfies(version: string, range: string): boolean {
  const ver = parseVersion(version);
  const comps = parseRange(range);
  if (!ver || !comps) return false;
  for (const { op, v: c } of comps) {
    const d = compareVersions(ver, c);
    const ok = op === '>=' ? d >= 0 : op === '>' ? d > 0 : op === '<=' ? d <= 0 : op === '<' ? d < 0 : d === 0;
    if (!ok) return false;
  }
  if (ver.pre.length > 0) {
    return comps.some(({ v: c }) => c.pre.length > 0 && c.pre[0] !== '0' && c.major === ver.major && c.minor === ver.minor && c.patch === ver.patch);
  }
  return true;
}
