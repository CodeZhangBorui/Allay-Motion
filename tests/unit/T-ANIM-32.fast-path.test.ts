// T-ANIM-32（快速路径部分，docs/animation-editor.md 第 8 节）：编辑时的预览模板把文档放在隐藏参数里，
// 改文档（manifest 不变）只改参数值、不加 structureRevision（预览走 setParams）；改了名称、参数表这类会改 manifest 的才重新装载；
// 撤销重做同样；保存的工程里不存这个参数；预览模板的代码与文档无关，从参数里读文档、画出来与转成模板的代码相同。
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { initI18n } from '../../apps/desktop/src/renderer/i18n';
import { projectData } from '../../apps/desktop/src/renderer/features/project/actions';
import { draftRef, editDoc, sourceFromDoc } from '../../apps/desktop/src/renderer/features/animation/source';
import { clearHistory, undo, useProjectStore } from '../../apps/desktop/src/renderer/stores/projectStore';
import { draftTemplateCode } from '../../apps/desktop/src/shared/animation/compile';
import { AnimationDocSchema, DOC_PARAM, newAnimationDoc, type AnimationDoc } from '../../apps/desktop/src/shared/animation/schema';
import { pos, runAnimation } from './helpers/anim-runtime';

const base = (): AnimationDoc => AnimationDocSchema.parse({ ...newAnimationDoc('Fast', 'B'), layers: [{ id: 'r', name: 'R', type: 'rect', props: { x: { keys: [{ t: 0, v: 0 }, { t: 1, v: 100 }] } } }] });

beforeAll(async () => {
  await initI18n('en');
});

beforeEach(() => {
  useProjectStore.getState().reset({ template: sourceFromDoc(draftRef(), base()), name: null, handle: null });
  clearHistory();
});

const state = () => useProjectStore.getState();
const docParam = () => JSON.parse(state().params[DOC_PARAM] as string) as AnimationDoc;

describe('T-ANIM-32 改文档走 setParams 快速路径', () => {
  it('装载时文档就在隐藏参数里；属性面板不显示它', () => {
    expect(docParam()).toEqual(state().template!.animation!.doc);
    expect(state().template!.hidden).toContain(DOC_PARAM);
  });

  it('改关键帧：只改参数（revision 加一，structureRevision 不变），参数里是新文档', () => {
    const { revision, structureRevision } = state();
    expect(editDoc((d) => void ((d.layers[0]!.props.x as { keys: { v: number }[] }).keys[1]!.v = 250))).toBe(true);
    expect(state().revision).toBe(revision + 1);
    expect(state().structureRevision).toBe(structureRevision);
    expect((docParam().layers[0]!.props.x as { keys: { v: number }[] }).keys[1]!.v).toBe(250);
  });

  it('改名称（manifest 变了）：重新装载', () => {
    const { structureRevision } = state();
    editDoc((d) => void (d.name = 'Renamed'));
    expect(state().structureRevision).toBe(structureRevision + 1);
    expect(docParam().name).toBe('Renamed');
  });

  it('撤销只改了文档的一步：仍是快速路径，参数回到原来的文档', () => {
    editDoc((d) => void ((d.layers[0]!.props.x as { keys: { v: number }[] }).keys[1]!.v = 250));
    const { structureRevision } = state();
    undo();
    expect(state().structureRevision).toBe(structureRevision);
    expect(docParam()).toEqual(base());
  });

  it('保存的工程里不存文档参数（文档本身在 animation 里）', () => {
    const data = projectData();
    expect(data).not.toBeNull();
    expect(Object.keys(data!.params)).not.toContain(DOC_PARAM);
  });

  it('预览模板的代码与文档无关，从参数里读文档；画出来与转成模板的代码相同', async () => {
    const d = base();
    expect(sourceFromDoc(draftRef(), d).code).toBe(sourceFromDoc(draftRef(), { ...d, name: 'Other' }).code);
    const embedded = await runAnimation(d);
    const draft = await runAnimation(d, { [DOC_PARAM]: JSON.stringify(d) }, draftTemplateCode());
    embedded.instance.update(0.5);
    draft.instance.update(0.5);
    expect(pos(draft.drawn[0]!.matrix()).x).toBeCloseTo(pos(embedded.drawn[0]!.matrix()).x);
    expect(pos(draft.drawn[0]!.matrix()).x).toBeCloseTo(50);
  });

  it('动画自己的参数不能用这个键', () => {
    expect(AnimationDocSchema.safeParse({ ...base(), params: [{ key: DOC_PARAM, label: 'x', type: 'number', default: 0, min: 0, max: 1 }] }).success).toBe(false);
  });
});
