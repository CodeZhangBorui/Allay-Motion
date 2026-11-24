// 官网精选展示模板：构建时由 virtual:allay-builtin-templates 只打入固定 5 个模板（build/plugins.ts）。
// 官网与桌面版完全解耦，不引用 apps/desktop 的任何类型或源码。
import { localize, parseManifest, type TemplateManifest } from '@allay/template-sdk';
import builtin from 'virtual:allay-builtin-templates';

export interface SiteTemplateEntry {
  id: string;
  version: string;
  manifest: TemplateManifest;
}

export interface SiteTemplateBundle {
  entry: SiteTemplateEntry;
  code: string;
}

function load(): SiteTemplateBundle[] {
  const out: SiteTemplateBundle[] = [];
  for (const raw of builtin) {
    const parsed = parseManifest(raw.manifest);
    if (!parsed.ok) throw new Error(`invalid showcase manifest: ${parsed.issues.map((i) => i.message).join('; ')}`);
    const manifest = parsed.manifest;
    out.push({
      entry: { id: manifest.id, version: manifest.version, manifest },
      code: raw.code,
    });
  }
  return out;
}

let cache: SiteTemplateBundle[] | null = null;
function all(): SiteTemplateBundle[] {
  cache ??= load();
  return cache;
}

export function showcaseEntries(): SiteTemplateEntry[] {
  return all().map((b) => b.entry);
}

export function showcaseBundle(id: string): SiteTemplateBundle | null {
  return all().find((x) => x.entry.id === id) ?? null;
}

/** 模板的默认时长：timeline 各段默认值之和；不知道时为 null */
export function defaultDuration(manifest: TemplateManifest): number | null {
  const segments = manifest.timeline?.segments ?? [];
  if (segments.length === 0) return null;
  let total = 0;
  for (const s of segments) {
    const def = (manifest.params ?? []).find((p) => p.key === s.param);
    if (!def || typeof def.default !== 'number') return null;
    total += def.default;
  }
  return total;
}

/** 剪辑点所在的时刻（进入段加停留段的一半）；不知道时为 null */
export function defaultCutTime(manifest: TemplateManifest): number | null {
  const segments = manifest.timeline?.segments ?? [];
  const value = (i: number) => {
    const def = (manifest.params ?? []).find((p) => p.key === segments[i]?.param);
    return def && typeof def.default === 'number' ? def.default : null;
  };
  const enter = value(0);
  const hold = value(1);
  return enter === null || hold === null ? null : enter + hold / 2;
}

export function templateName(manifest: TemplateManifest, locale: string): string {
  return localize(manifest.name, locale);
}
