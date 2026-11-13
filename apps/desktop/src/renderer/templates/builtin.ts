// M1 的模板来源：只有一个写死的临时方块擦除模板。它走和用户模板相同的装载路径：
// 源码文本 + manifest 交给引擎的 load（AGENTS.md 硬性规则 5）。M3 换成从 resources/templates/ 读模板包。
import manifestJson from '@allay/template-m1-block-wipe/manifest.json';
import code from '@allay/template-m1-block-wipe/template.js?raw';
import { TemplateManifestSchema, type TemplateManifest } from '@allay/template-sdk';

export interface TemplateSource {
  manifest: TemplateManifest;
  /** 模板的 ESM 源码文本 */
  code: string;
}

export const M1_BLOCK_WIPE: TemplateSource = {
  manifest: TemplateManifestSchema.parse(manifestJson),
  code,
};

/** 按界面语言取 manifest 里的多语言文字 */
export function localized(value: TemplateManifest['name'], language: string): string {
  if (typeof value === 'string') return value;
  return (language.startsWith('zh') ? value['zh-CN'] : value.en) ?? value.en ?? value['zh-CN'] ?? '';
}
