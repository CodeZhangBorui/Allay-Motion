// 模板 manifest 里出现的音效事件，以及“下载原版资源时一并取回”的音效清单（docs/decisions.md M6b、“内置模板扩到 100 个”）。
//
// 清单 = 基础表 SOUND_EVENTS ∪ 全部内置模板 manifest 里 sound 参数的默认值和自带预设里的音效值。
// 它在运行时从内置模板的 manifest 推出来，不是一份提交的生成文件：新模板只要在自己的 manifest 里写默认音效，
// 就会被一并取回，不用改公共的表。
import { SOUND_EVENTS } from '@allay/assets';
import type { TemplateManifest } from '@allay/template-sdk';

/** 带命名空间的音效事件 ID（和游戏的资源定位符一样：小写、数字、下划线、点、连字符，路径里还可以有斜杠） */
export const SOUND_EVENT_ID_RE = /^[a-z0-9_.-]+:[a-z0-9_./-]+$/;

/** 一次最多带多少个额外的事件：防止一份坏掉的 manifest 让下载去取成千上万个文件 */
export const MAX_PREFETCH_EVENTS = 1024;

export function isSoundEventId(value: unknown): value is string {
  return typeof value === 'string' && value.length <= 256 && SOUND_EVENT_ID_RE.test(value);
}

/**
 * 一个模板 manifest 里出现的音效事件：sound 参数的默认值，加上自带预设里给 sound 参数的值。
 * null（“无”）和不合法的值跳过；按出现顺序去重。
 */
export function manifestSoundEvents(manifest: Pick<TemplateManifest, 'params' | 'presets'>): string[] {
  const out = new Set<string>();
  const soundKeys = new Set<string>();
  for (const p of manifest.params ?? []) {
    if (p.type !== 'sound') continue;
    soundKeys.add(p.key);
    if (isSoundEventId(p.default)) out.add(p.default);
  }
  for (const preset of manifest.presets ?? []) {
    for (const [key, value] of Object.entries(preset.params)) {
      if (soundKeys.has(key) && isSoundEventId(value)) out.add(value);
    }
  }
  return [...out];
}

/**
 * 下载原版资源时一并取回的音效事件：基础表在前，随后是各模板里出现的（去重，保持顺序）。
 * 只该传内置模板的 manifest：用户装的模板不参与，免得一个导入的模板决定下载时取什么。
 */
export function prefetchSoundEvents(manifests: readonly Pick<TemplateManifest, 'params' | 'presets'>[]): string[] {
  const out = new Set<string>(SOUND_EVENTS);
  for (const m of manifests) {
    for (const id of manifestSoundEvents(m)) {
      if (out.size >= SOUND_EVENTS.length + MAX_PREFETCH_EVENTS) return [...out];
      out.add(id);
    }
  }
  return [...out];
}
