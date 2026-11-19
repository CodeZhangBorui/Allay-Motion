// 资源包与原版基底的匹配说明（docs/03-assets.md 3.12）：一句话，写明包是为哪个版本做的，和基底对不上时提示。
import type { TFunction } from 'i18next';

interface PackFormatInfo {
  formats?: { min: string; max: string } | null;
  madeFor?: string | null;
  compat?: 'ok' | 'older' | 'newer' | 'unknown';
}

/** 没有格式信息时为 null；warn 为真表示与基底不匹配 */
export function compatText(t: TFunction, p: PackFormatInfo, base: string | null): { text: string; warn: boolean } | null {
  if (!p.formats) return null;
  const format = p.formats.min === p.formats.max ? p.formats.min : `${p.formats.min}–${p.formats.max}`;
  const meta = p.madeFor ? t('resources.compat.madeFor', { version: p.madeFor, format }) : t('resources.compat.formatOnly', { format });
  if (p.compat === 'older' || p.compat === 'newer') return { text: t(`resources.compat.${p.compat}`, { meta, base: base ?? '' }), warn: true };
  if (p.compat === 'ok') return { text: t('resources.compat.ok', { meta }), warn: false };
  return { text: meta, warn: false };
}
