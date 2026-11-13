// 格式版本与迁移框架（docs/04-templates.md 4.3）：读到更高的 formatVersion 拒绝并提示升级应用；
// 读到更低的版本按“n → n+1”的迁移函数链升到当前版本，再做 schema 校验。
// 现在只有格式版本 1，迁移表是空的；框架本身由 T-TPL-1 用假的迁移链测试。

/** 第 n 项把 formatVersion = n 的 JSON 变成 n + 1 的 */
export type MigrationStep = (doc: Record<string, unknown>) => Record<string, unknown>;

export interface Migrations {
  current: number;
  /** from → 把 from 版本升到 from + 1 的函数 */
  steps: Readonly<Record<number, MigrationStep>>;
}

export type MigrationResult =
  | { ok: true; doc: Record<string, unknown>; migratedFrom: number | null }
  | { ok: false; error: 'not-an-object' | 'missing-format-version' | 'format-too-new' | 'no-migration'; version?: number };

export function migrate(raw: unknown, migrations: Migrations): MigrationResult {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { ok: false, error: 'not-an-object' };
  let doc = raw as Record<string, unknown>;
  const fv = doc.formatVersion;
  if (typeof fv !== 'number' || !Number.isInteger(fv) || fv < 1) return { ok: false, error: 'missing-format-version' };
  if (fv > migrations.current) return { ok: false, error: 'format-too-new', version: fv };
  if (fv === migrations.current) return { ok: true, doc, migratedFrom: null };
  for (let v = fv; v < migrations.current; v++) {
    const step = migrations.steps[v];
    if (!step) return { ok: false, error: 'no-migration', version: v };
    doc = { ...step(JSON.parse(JSON.stringify(doc)) as Record<string, unknown>), formatVersion: v + 1 };
  }
  return { ok: true, doc, migratedFrom: fv };
}

/** manifest 的迁移表（当前版本 1，没有更早的版本） */
export const MANIFEST_MIGRATIONS: Migrations = { current: 1, steps: {} };
/** 预设的迁移表 */
export const PRESET_MIGRATIONS: Migrations = { current: 1, steps: {} };
