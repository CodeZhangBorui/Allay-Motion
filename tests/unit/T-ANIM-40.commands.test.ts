// T-ANIM-40：第三轮新功能的类型化命令（docs/animation-editor.md 第 7 节）——检查器里的修改都有命令（图层字段、某一刻的属性值、
// 整段设置），经注册表执行、校验输入、不合法的文档整条拒绝；新功能的命令都注册了；代码窗口的实时标记覆盖复制器、路径和逐字动画。
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { initI18n } from '../../apps/desktop/src/renderer/i18n';
import { CommandError, dispatch as run, getCommand, registerCommand } from '../../apps/desktop/src/renderer/app/registry';
import { ANIMATION_COMMANDS } from '../../apps/desktop/src/renderer/features/animation/workspace';
import { draftRef, sourceFromDoc } from '../../apps/desktop/src/renderer/features/animation/source';
import { clearHistory, useProjectStore } from '../../apps/desktop/src/renderer/stores/projectStore';
import { resolveDoc } from '../../apps/desktop/src/shared/animation/resolve';
import { AnimationDocSchema, newAnimationDoc, serializeAnimation, type AnimationDoc } from '../../apps/desktop/src/shared/animation/schema';
import { liveMarks } from '../../apps/desktop/src/shared/animation/source-map';

beforeAll(async () => {
  await initI18n('en');
  for (const c of ANIMATION_COMMANDS) registerCommand(c);
});

const base = (): AnimationDoc =>
  AnimationDocSchema.parse({
    ...newAnimationDoc('C', 'B'),
    layers: [
      { id: 'r', name: 'R', type: 'rect', props: { x: { keys: [{ t: 0, v: 0 }, { t: 1, v: 100 }] } } },
      { id: 'txt', name: 'T', type: 'text', text: 'Hi there', props: {} },
    ],
  });

beforeEach(() => {
  useProjectStore.getState().reset({ template: sourceFromDoc(draftRef(), base()), name: null, handle: null });
  clearHistory();
});

/** 经注册表执行；失败时给出 CommandError 的码 */
async function dispatch(id: string, input?: unknown): Promise<{ ok: true; output: unknown } | { ok: false; code: string | null }> {
  try {
    return { ok: true, output: await run(id, input) };
  } catch (error) {
    return { ok: false, code: error instanceof CommandError ? error.code : null };
  }
}

const doc = () => useProjectStore.getState().template!.animation!.doc;
const layer = (id: string) => doc().layers.find((l) => l.id === id) as unknown as Record<string, unknown>;

describe('T-ANIM-40 类型化命令', () => {
  it('animUpdateLayer：改形状的圆角、渐变、描边、混合；null 去掉字段；保留字段和不合法的值拒绝', async () => {
    const ok = await dispatch('animUpdateLayer', { layer: 'r', fields: { radius: 20, gradient: { type: 'linear', from: '#000000', to: '#FFFFFF', angle: 0 }, stroke: { color: '#FF0000', width: 4 }, blend: 'add' } });
    expect(ok).toMatchObject({ ok: true, output: true });
    expect(layer('r')).toMatchObject({ radius: 20, blend: 'add', stroke: { width: 4 } });
    await dispatch('animUpdateLayer', { layer: 'r', fields: { blend: null } });
    expect('blend' in layer('r')).toBe(false);
    expect(await dispatch('animUpdateLayer', { layer: 'r', fields: { type: 'text' } })).toMatchObject({ ok: false, code: 'invalid-input' });
    // schema 不允许的值（圆角是负数）：整条拒绝，文档不变
    const before = serializeAnimation(doc());
    expect(await dispatch('animUpdateLayer', { layer: 'r', fields: { radius: -5 } })).toMatchObject({ ok: true, output: false });
    expect(serializeAnimation(doc())).toBe(before);
  });

  it('animUpdateLayer：文字的逐字动画；animSetPropValues 在某一刻落关键帧；animUpdateDoc 改成转场时补剪辑点', async () => {
    await dispatch('animUpdateLayer', { layer: 'txt', fields: { chars: { stagger: 0.1, order: 'center', seed: 1 } } });
    expect(layer('txt').chars).toEqual({ stagger: 0.1, order: 'center', seed: 1 });
    expect(await dispatch('animSetPropValues', { layer: 'r', values: { x: 42, y: 7 }, t: 0.5 })).toMatchObject({ ok: true, output: true });
    const r = doc().layers.find((l) => l.id === 'r')!;
    expect((r.props.x as { keys: { t: number; v: number }[] }).keys.find((k) => k.t === 0.5)?.v).toBe(42);
    expect(r.props.y).toBe(7);
    await dispatch('animUpdateDoc', { name: 'Renamed', category: 'transition', duration: 3 });
    expect(doc()).toMatchObject({ name: 'Renamed', category: 'transition', duration: 3, cutTime: 1.5 });
    expect(await dispatch('animUpdateDoc', { duration: 99 })).toMatchObject({ ok: false, code: 'invalid-input' });
  });

  it('第三轮的新功能都有命令', () => {
    const ids = [
      // 图层、复制器、路径（第二批）
      'animSetLayerFlags', 'animRenameLayer', 'animDuplicateLayers', 'animGroupLayers', 'animUngroup', 'animSetParent', 'animMoveLayer', 'animMoveLayerRelative', 'animSetLayerInterval', 'animSetRepeat', 'animSetPath',
      // 新图层类型和检查器里的修改
      'animAddLayer', 'animUpdateLayer', 'animSetPropValues', 'animUpdateDoc',
      // 时间轴
      'animAddMarker', 'animMoveMarker', 'animRenameMarker', 'animRemoveMarker', 'animSetWorkArea', 'animWorkAreaStart', 'animWorkAreaEnd', 'animClearWorkArea', 'animPrevKey', 'animNextKey', 'animPrevMarker', 'animNextMarker', 'animStepBack', 'animStepForward', 'animSetKeysEase',
      // 模板往返
      'animEditTemplate', 'animUpdateTemplate', 'animConvertToTemplate',
    ];
    for (const id of ids) expect(getCommand(id), id).toBeDefined();
  });
});

describe('T-ANIM-40 实时标记覆盖复制器、路径和逐字动画', () => {
  it('图层可见时标出 repeat、path、chars 整段，标签写份数 / 点数 / 字数', () => {
    const d = AnimationDocSchema.parse({
      ...newAnimationDoc('M', 'B'),
      layers: [
        { id: 'b', name: 'Wall', type: 'rect', props: {}, repeat: { mode: 'grid', cols: 4, rows: 2, stagger: 0.05 }, path: { points: [{ x: 0, y: 0 }, { x: 100, y: 0 }], orient: true } },
        { id: 't', name: 'Title', type: 'text', text: 'Go go', props: {}, chars: { stagger: 0.1 } },
      ],
    });
    const text = serializeAnimation(d);
    const labels = liveMarks(resolveDoc(d), text, 0.5).filter((m) => m.kind === 'param').map((m) => m.label);
    expect(labels).toContain('Wall · repeat ×8 · +0.05s');
    expect(labels).toContain('Wall · path ×2 · orient');
    expect(labels).toContain('Title · chars ×4 · +0.1s');
  });
});
