// 自建动画与工程的衔接（docs/animation-editor.md 第 5 节）。
// 动画文档放在工程当前模板（TemplateSource.animation）上：每次修改都是换一个新的 TemplateSource，
// 所以撤销重做、“已修改”、保存、预览、导出全部沿用现有的机制（projectStore），不另起一套。
// 可视化编辑：改文档对象 → 序列化成文本；代码编辑：改文本 → 解析得过就换文档。两边改的是同一份文本。
import i18next from 'i18next';
import { animationManifest, animationTemplateCode } from '../../../shared/animation/compile';
import { AnimationDocSchema, parseAnimation, serializeAnimation, type AnimationDoc } from '../../../shared/animation/schema';
import { notify } from '../../stores/noticeStore';
import { useProjectStore } from '../../stores/projectStore';
import type { AnimationPayload, TemplateSource } from '../../templates/catalog';

/** 动画在预览和导出时用的模板标识（不在模板库里；转为模板时换成新的 id） */
export const ANIMATION_VERSION = '0.0.0';

export function draftRef(): { id: string; version: string } {
  const hex = Array.from(crypto.getRandomValues(new Uint8Array(3)), (b) => b.toString(16).padStart(2, '0')).join('');
  return { id: `user.${hex}.animation`, version: ANIMATION_VERSION };
}

/** 从一份合法的文档建模板来源（代码由文档生成） */
export function sourceFromDoc(ref: { id: string; version: string }, doc: AnimationDoc, text = serializeAnimation(doc), issues: AnimationPayload['issues'] = []): TemplateSource {
  const manifest = animationManifest(doc, ref);
  return { ref, manifest, params: [], hidden: [], code: animationTemplateCode(doc), assets: null, animation: { text, doc, issues } };
}

export function currentAnimation(): (AnimationPayload & { source: TemplateSource }) | null {
  const t = useProjectStore.getState().template;
  return t?.animation ? { ...t.animation, source: t } : null;
}

export function isAnimationActive(): boolean {
  return currentAnimation() !== null;
}

/**
 * 可视化编辑：在当前文档的副本上改，校验通过才提交（一次提交就是一步撤销）。
 * 不合法的修改（比如把剪辑点拖出时长）被拒绝并返回 false，文档不动。
 */
export function editDoc(mutate: (doc: AnimationDoc) => void): boolean {
  const cur = currentAnimation();
  if (!cur) return false;
  const draft = structuredClone(cur.doc);
  mutate(draft);
  const parsed = AnimationDocSchema.safeParse(draft);
  if (!parsed.success) {
    notify('error', i18next.t('anim.errors.invalidEdit', { reason: parsed.error.issues[0]?.message ?? '' }));
    return false;
  }
  const next = sourceFromDoc(cur.source.ref, parsed.data);
  if (next.animation!.text === cur.text) return true;
  useProjectStore.getState().setTemplate(next, {}, i18next.language);
  return true;
}

/**
 * 代码编辑：换整份文本。解析得过就换文档（预览随之更新）；解析不过时文本照样保存在工程里（不丢用户的输入），
 * 预览保持最后一份合法的文档，原因放进 issues。
 */
export function setAnimationText(text: string): AnimationPayload['issues'] {
  const cur = currentAnimation();
  if (!cur || text === cur.text) return cur?.issues ?? [];
  const parsed = parseAnimation(text);
  const next = parsed.ok ? sourceFromDoc(cur.source.ref, parsed.doc, text) : { ...cur.source, animation: { text, doc: cur.doc, issues: parsed.issues } };
  useProjectStore.getState().setTemplate(next, {}, i18next.language);
  return parsed.ok ? [] : parsed.issues;
}

/** 新的唯一图层 id：类型名加序号 */
export function nextLayerId(doc: AnimationDoc, type: string): string {
  const used = new Set(doc.layers.map((l) => l.id));
  for (let i = 1; ; i++) {
    const id = `${type}-${i}`;
    if (!used.has(id)) return id;
  }
}
