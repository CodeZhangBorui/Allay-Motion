// 动画文档 → 一份普通的模板（manifest + template.js）（docs/animation-editor.md 第 4 节）。
// 预览、导出、“转为模板”都用这里的产物：template.js 是“文档常量 + 解释器原文 + 默认导出”，
// 只用公开的模板接口，与内置模板、用户模板走同一条装载路径（硬性规则 5），在引擎 Worker 里运行（规则 3）。
import { MANIFEST_FORMAT_VERSION, parseManifest, type TemplateManifest } from '@allay/template-sdk';
import runtimeSource from './runtime.template.js?raw';
import { DOC_PARAM, isParamRef, serializeAnimation, type AnimationDoc, type AnimParam } from './schema';

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

/**
 * 编辑时的预览模板（第 9 项）：代码与文档无关（每份文档都一样），文档从隐藏参数 DOC_PARAM 里读（JSON 文本）。
 * 这样改文档只改参数值，预览走 setParams（只重跑 setup），不重新分析、装载代码。转为模板时仍用 animationTemplateCode（文档嵌在代码里）。
 */
export function draftTemplateCode(): string {
  return [
    GENERATED_MARKER,
    '// Preview of an animation being edited: the document comes from a hidden parameter.',
    "/** @type {import('./template-api').TemplateModule} */",
    '',
    runtimeSource.trim(),
    '',
    'export default {',
    '  setup(ctx) {',
    `    const text = ctx.params[${JSON.stringify(DOC_PARAM)}];`,
    "    if (typeof text !== 'string' || text === '') throw new Error('no animation document');",
    '    return createAnimation(ctx, JSON.parse(text));',
    '  },',
    '};',
    '',
  ].join('\n');
}

/** 编辑时的预览 manifest：转为模板的那份加上隐藏的文档参数 */
export function draftManifest(doc: AnimationDoc, ref: { id: string; version: string }): TemplateManifest {
  const json = animationManifestJson(doc, ref);
  const params = [...((json.params as unknown[]) ?? []), { key: DOC_PARAM, label: { 'zh-CN': '动画文档', en: 'Animation document' }, type: 'text', default: '', multiline: true }];
  const parsed = parseManifest({ ...json, params });
  if (!parsed.ok) throw new Error(`generated manifest is invalid: ${parsed.issues.map((i) => `${i.path}: ${i.message}`).join('; ')}`);
  return parsed.manifest;
}

/** 动画的参数 → manifest 的参数定义（4.4）。类型一一对应；数值参数缺省用滑块 */
export function manifestParamOf(p: AnimParam): Record<string, unknown> {
  const base = { key: p.key, label: p.label, ...(p.group ? { group: p.group } : {}) };
  switch (p.type) {
    case 'number':
      return { ...base, type: 'number', default: p.default, min: p.min, max: p.max, ...(p.step ? { step: p.step } : {}), ...(p.unit ? { unit: p.unit } : {}) };
    case 'duration':
      return { ...base, type: 'duration', default: p.default, min: p.min, max: p.max };
    case 'text':
      return { ...base, type: 'text', default: p.default, maxLength: 500, ...(p.multiline ? { multiline: true } : {}) };
    case 'texture':
      return { ...base, type: 'texture', default: p.default, allowFile: true };
    default:
      return { ...base, type: p.type, default: p.default };
  }
}

/**
 * 没有绑定成参数、但用了非默认字体的文字图层：引擎只在 setup 之前载入 font 参数（含默认值）里出现的字体（4.5），
 * 所以每种这样的字体自动加一个 font 参数（键 autoFont1、autoFont2…，放在“字体”分组里），字体才能载入。
 * 模板用户也可以在属性面板里换它，但图层用的是文档里写的字体，换了不影响画面——这是载入字体的代价，见 decisions。
 */
export function autoFontParams(doc: AnimationDoc): Record<string, unknown>[] {
  const families = new Set<string>();
  for (const l of doc.layers) {
    if (l.type !== 'text' || !l.font || isParamRef(l.font)) continue;
    if (l.font.family !== 'minecraft:default' && l.font.family !== 'system:sans') families.add(l.font.family);
  }
  const used = new Set(doc.params.map((p) => p.key));
  const out: Record<string, unknown>[] = [];
  let n = 0;
  for (const family of [...families].sort()) {
    let key: string;
    do key = `autoFont${++n}`;
    while (used.has(key));
    out.push({ key, label: { 'zh-CN': `字体 ${n}`, en: `Font ${n}` }, group: 'fonts', type: 'font', default: { family } });
  }
  return out;
}

/** 生成 manifest 的原始 JSON（写进 manifest.json 的就是它） */
export function animationManifestJson(doc: AnimationDoc, ref: { id: string; version: string }, extra: { description?: string; author?: string } = {}): Record<string, unknown> {
  const params = doc.params.map(manifestParamOf);
  const auto = autoFontParams(doc);
  // 时长绑定到参数：时间轴上画成一段（4.3 timeline.segments），模板用户可以直接拖
  const durationKey = isParamRef(doc.duration) ? doc.duration.$param : null;
  return {
    formatVersion: MANIFEST_FORMAT_VERSION,
    id: ref.id,
    version: ref.version,
    name: doc.name,
    ...(extra.description ? { description: extra.description } : {}),
    ...(extra.author ? { author: extra.author } : {}),
    category: doc.category,
    tags: ['animation'],
    ...(auto.length > 0 ? { groups: [{ key: 'fonts', label: { 'zh-CN': '字体', en: 'Fonts' }, collapsed: true }] } : {}),
    params: [...params, ...auto],
    ...(durationKey ? { timeline: { segments: [{ param: durationKey }] } } : {}),
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
