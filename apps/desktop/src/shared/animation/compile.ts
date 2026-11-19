// 动画文档 → 一份普通的模板（manifest + template.js）（docs/animation-editor.md 第 4 节）。
// 预览、导出、“转为模板”都用这里的产物：template.js 是“文档常量 + 解释器原文 + 默认导出”，
// 只用公开的模板接口，与内置模板、用户模板走同一条装载路径（硬性规则 5），在引擎 Worker 里运行（规则 3）。
import { MANIFEST_FORMAT_VERSION, parseManifest, type TemplateManifest } from '@allay/template-sdk';
import runtimeSource from './runtime.template.js?raw';
import { serializeAnimation, type AnimationDoc } from './schema';

/** 生成的 template.js 第一行的标记：认出“这是从动画生成的” */
export const GENERATED_MARKER = '// @allay-animation';
/** 转成模板时放在模板文件夹里的动画原文（将来可以从模板回到动画编辑器） */
export const ANIMATION_FILE_NAME = 'animation.json';

/** 生成 template.js 的源码文本。文档以 JSON 字面量嵌入（JSON 是 JS 表达式的子集，不会注入代码） */
export function animationTemplateCode(doc: AnimationDoc): string {
  return [
    GENERATED_MARKER,
    '// Generated from an animation document. Edit the animation (animation.json), not this file.',
    "/** @type {import('./template-api').TemplateModule} */",
    `const ANIMATION = ${JSON.stringify(doc)};`,
    '',
    runtimeSource.trim(),
    '',
    'export default {',
    '  setup(ctx) {',
    '    return createAnimation(ctx, ANIMATION);',
    '  },',
    '};',
    '',
  ].join('\n');
}

/** 生成 manifest 的原始 JSON（写进 manifest.json 的就是它） */
export function animationManifestJson(doc: AnimationDoc, ref: { id: string; version: string }, extra: { description?: string; author?: string } = {}): Record<string, unknown> {
  return {
    formatVersion: MANIFEST_FORMAT_VERSION,
    id: ref.id,
    version: ref.version,
    name: doc.name,
    ...(extra.description ? { description: extra.description } : {}),
    ...(extra.author ? { author: extra.author } : {}),
    category: doc.category,
    tags: ['animation'],
    params: [],
  };
}

export function animationManifest(doc: AnimationDoc, ref: { id: string; version: string }): TemplateManifest {
  const parsed = parseManifest(animationManifestJson(doc, ref));
  if (!parsed.ok) throw new Error(`generated manifest is invalid: ${parsed.issues.map((i) => `${i.path}: ${i.message}`).join('; ')}`);
  return parsed.manifest;
}

/** 一个模板文件夹里的全部文本文件（转为模板时写盘的内容） */
export function animationTemplateFiles(doc: AnimationDoc, ref: { id: string; version: string }): Record<'manifest.json' | 'template.js' | typeof ANIMATION_FILE_NAME, string> {
  return {
    'manifest.json': `${JSON.stringify(animationManifestJson(doc, ref), null, 2)}\n`,
    'template.js': animationTemplateCode(doc),
    [ANIMATION_FILE_NAME]: serializeAnimation(doc),
  };
}
