// 预设（docs/04-templates.md 4.7）：某个模板的一组参数值。只存与默认值不同的参数；
// 加载时缺的用默认值补、多的丢弃（经参数校验清洗），模板升级后照常可用。
import { z } from 'zod';
import { TemplateIdSchema, VersionSchema, type ParamDef } from './manifest';
import { PRESET_MIGRATIONS, migrate } from './migrate';
import { diffFromDefaults, sanitizeParams, type SanitizeOptions } from './params';
import type { ParamValue, ParamValues } from './runtime';

const ParamValueJson: z.ZodType<ParamValue> = z.lazy(() =>
  z.union([z.number(), z.string(), z.boolean(), z.null(), z.array(ParamValueJson), z.record(z.string(), ParamValueJson)]),
);

export const PresetSchema = z.looseObject({
  formatVersion: z.literal(1),
  template: z.strictObject({ id: TemplateIdSchema, version: VersionSchema }),
  name: z.string().min(1).max(100),
  params: z.record(z.string().max(64), ParamValueJson),
  createdAt: z.iso.datetime(),
});
export type Preset = z.infer<typeof PresetSchema>;

export type PresetParseResult = { ok: true; preset: Preset } | { ok: false; error: string };

export function parsePreset(raw: unknown): PresetParseResult {
  const m = migrate(raw, PRESET_MIGRATIONS);
  if (!m.ok) return { ok: false, error: m.error };
  const p = PresetSchema.safeParse(m.doc);
  if (!p.success) return { ok: false, error: p.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ') };
  return { ok: true, preset: p.data };
}

/** 新建预设：只存与默认值不同的参数 */
export function createPreset(
  template: { id: string; version: string },
  name: string,
  defs: readonly ParamDef[],
  values: Readonly<Record<string, unknown>>,
  createdAt: Date,
  options: SanitizeOptions = {},
): Preset {
  return { formatVersion: 1, template: { id: template.id, version: template.version }, name, params: diffFromDefaults(defs, values, options), createdAt: createdAt.toISOString() };
}

/** 把预设套到（可能已经升级过的）模板上：缺的补默认值，多的丢弃，类型不对的回到默认值 */
export function applyPreset(defs: readonly ParamDef[], preset: Pick<Preset, 'params'>, options: SanitizeOptions = {}): ParamValues {
  return sanitizeParams(defs, preset.params, options);
}
