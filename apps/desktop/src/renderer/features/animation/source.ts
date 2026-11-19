// 自建动画与工程的衔接（docs/animation-editor.md 第 5 节）。
// 动画文档放在工程当前模板（TemplateSource.animation）上：每次修改都是换一个新的 TemplateSource，
// 所以撤销重做、“已修改”、保存、预览、导出全部沿用现有的机制（projectStore），不另起一套。
// 可视化编辑：改文档对象 → 序列化成文本；代码编辑：改文本 → 解析得过就换文档。两边改的是同一份文本。
import i18next from 'i18next';
import { draftManifest, draftTemplateCode } from '../../../shared/animation/compile';
import { AnimationDocSchema, DOC_PARAM, parseAnimation, serializeAnimation, type AnimationDoc } from '../../../shared/animation/schema';
import { notify } from '../../stores/noticeStore';
import { useProjectStore } from '../../stores/projectStore';
import type { AnimationPayload, TemplateSource } from '../../templates/catalog';

/** 动画在预览和导出时用的模板标识（不在模板库里；转为模板时换成新的 id） */
export const ANIMATION_VERSION = '0.0.0';

export function draftRef(): { id: string; version: string } {
  const hex = Array.from(crypto.getRandomValues(new Uint8Array(3)), (b) => b.toString(16).padStart(2, '0')).join('');
  return { id: `user.${hex}.animation`, version: ANIMATION_VERSION };
}

const DRAFT_CODE = draftTemplateCode();

/**
 * 从一份合法的文档建模板来源。编辑时的预览模板（第 9 项）：代码对每份文档都一样，文档在隐藏参数 DOC_PARAM 里
 * （projectStore 按 animation.doc 填）；manifest 只取决于文档的名称、分类和参数表
 */
export function sourceFromDoc(ref: { id: string; version: string }, doc: AnimationDoc, text = serializeAnimation(doc), issues: AnimationPayload['issues'] = []): TemplateSource {
  const manifest = draftManifest(doc, ref);
  const docParam = manifest.params!.find((p) => p.key === DOC_PARAM)!;
  return { ref, manifest, params: [docParam], hidden: [DOC_PARAM], code: DRAFT_CODE, assets: null, animation: { text, doc, issues } };
}

/** 提交一份新的模板来源：manifest 没变时只改参数（预览走 setParams），变了才重新装载 */
function commitSource(cur: TemplateSource, next: TemplateSource): void {
  const store = useProjectStore.getState();
  if (next.code === cur.code && JSON.stringify(next.manifest) === JSON.stringify(cur.manifest)) store.setAnimationSource(next);
  else store.setTemplate(next, store.params, i18next.language);
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
  commitSource(cur.source, next);
  return true;
}

/** 整份换成另一份文档（多个关键帧、参数这类一次改好几处的操作用）：校验通过才提交，一次一步撤销 */
export function replaceDoc(next: AnimationDoc): boolean {
  return editDoc((draft) => {
    for (const k of Object.keys(draft)) delete (draft as Record<string, unknown>)[k];
    Object.assign(draft, structuredClone(next));
  });
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
  commitSource(cur.source, next);
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
