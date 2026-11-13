// MD-b 的主程序侧准备（docs/code-editing-and-mcp-plan.md H3、H6、H9 的参数部分）：
// 工程修订号与带修订号的写命令；撤销记录的来源标签；热重载换模板时参数按键名和类型重新对上、不进撤销历史。
import { TemplateManifestSchema, type ParamDef } from '../../packages/template-sdk/src/index';
import { initI18n } from '../../apps/desktop/src/renderer/i18n';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { dispatch, registerCommand } from '../../apps/desktop/src/renderer/app/registry';
import { PROJECT_COMMANDS } from '../../apps/desktop/src/renderer/features/commands/projectCommands';
import { remapParams } from '../../apps/desktop/src/renderer/features/templates/remapParams';
import { clearHistory, hotSwapTemplate, setParam, undo, undoInfo, useProjectStore, withOrigin } from '../../apps/desktop/src/renderer/stores/projectStore';
import type { TemplateSource } from '../../apps/desktop/src/renderer/templates/catalog';

beforeAll(async () => {
  await initI18n('en');
  for (const c of PROJECT_COMMANDS) registerCommand(c);
});

function source(params: unknown[], code = 'export default {}'): TemplateSource {
  const manifest = TemplateManifestSchema.parse({ formatVersion: 1, id: 'user.abc123.demo', version: '1.0.0', name: 'demo', category: 'transition', params });
  return { ref: { id: manifest.id, version: manifest.version }, manifest, params: manifest.params as ParamDef[], hidden: [], code, assets: null };
}

const SIZE = { key: 'size', type: 'number', label: 'size', default: 0.5, min: 0, max: 1 };
const TINT = { key: 'tint', type: 'color', label: 'tint', default: '#FFFFFF' };
const MODE = { key: 'mode', type: 'enum', label: 'mode', default: 'a', options: [{ value: 'a', label: 'A' }, { value: 'b', label: 'B' }] };

beforeEach(() => {
  useProjectStore.getState().reset({ template: source([SIZE, TINT, MODE]), name: null, handle: null });
  clearHistory();
});

describe('H9 参数按键名和类型重新对上', () => {
  it('同名同类型保留，类型变了、新加的取默认值，没了的丢掉，越界的钳制', () => {
    const oldDefs = source([SIZE, TINT, MODE]).params;
    const newDefs = source([
      { ...SIZE, max: 0.6 },
      { key: 'tint', type: 'number', label: 'tint', default: 3, min: 0, max: 10 },
      { ...MODE, options: [{ value: 'a', label: 'A' }, { value: 'c', label: 'C' }] },
      { key: 'extra', type: 'boolean', label: 'extra', default: true },
    ]).params;
    const out = remapParams(oldDefs, newDefs, { size: 0.9, tint: '#FF0000', mode: 'b', gone: 1 }, 'en');
    expect(out).toEqual({ size: 0.6, tint: 3, mode: 'a', extra: true });
  });

  it('热重载换模板：工程换成新模板，不进撤销历史；历史里的旧模板也换成新的', () => {
    setParam('size', 0.8, 'en');
    expect(useProjectStore.temporal.getState().pastStates).toHaveLength(1);
    const next = source([SIZE, { key: 'extra', type: 'boolean', label: 'extra', default: false }], 'export default { v: 2 }');
    const rev = useProjectStore.getState().revision;
    hotSwapTemplate(next, remapParams(useProjectStore.getState().template!.params, next.params, useProjectStore.getState().params, 'en'), (old, v) => remapParams(old.params, next.params, v, 'en'));
    const s = useProjectStore.getState();
    expect(s.template).toBe(next);
    expect(s.params).toEqual({ size: 0.8, extra: false });
    expect(s.revision).toBe(rev + 1);
    const past = useProjectStore.temporal.getState().pastStates;
    expect(past).toHaveLength(1);
    expect(past[0]!.template).toBe(next);
    // 撤销回到改参数之前：代码仍是新的
    undo();
    expect(useProjectStore.getState().template).toBe(next);
    expect(useProjectStore.getState().params).toEqual({ size: 0.5, extra: false });
  });
});

describe('H6 撤销记录的来源标签', () => {
  it('界面上直接改参数：来源 ui；经 dispatch 的 write 命令：命令的撤销文案和来源', async () => {
    expect(undoInfo()).toEqual({ undo: null, redo: null });
    setParam('size', 0.7, 'en');
    expect(undoInfo().undo).toEqual({ labelKey: 'history.params', source: 'ui' });
    await dispatch('project.setParams', { params: { size: 0.2 } }, { source: 'main' });
    expect(undoInfo().undo).toEqual({ labelKey: 'history.params', source: 'main' });
    withOrigin({ labelKey: 'command.items.reroll', source: 'module:fake' }, () => setParam('size', 0.3, 'en'));
    expect(undoInfo().undo).toEqual({ labelKey: 'command.items.reroll', source: 'module:fake' });
    undo();
    // 撤销之后：下一次撤销是 main 的那次，重做是模块的那次
    expect(undoInfo()).toEqual({ undo: { labelKey: 'history.params', source: 'main' }, redo: { labelKey: 'command.items.reroll', source: 'module:fake' } });
  });
});

describe('H3 工程修订号', () => {
  it('project.get 返回修订号；project.setParams 带着旧的修订号被拒绝，带当前的被接受', async () => {
    const snap = (await dispatch('project.get')) as { revision: number; params: Record<string, unknown> };
    expect(snap.revision).toBe(useProjectStore.getState().revision);
    const after = (await dispatch('project.setParams', { params: { size: 0.25 }, baseRevision: snap.revision })) as { revision: number; params: Record<string, unknown> };
    expect(after.revision).toBe(snap.revision + 1);
    expect(after.params.size).toBe(0.25);
    await expect(dispatch('project.setParams', { params: { size: 0.9 }, baseRevision: snap.revision })).rejects.toMatchObject({ name: 'RevisionConflictError', expected: snap.revision, actual: snap.revision + 1 });
    expect(useProjectStore.getState().params.size).toBe(0.25);
    await expect(dispatch('project.setParams', { params: { size: 0.9 }, baseRevision: -1 })).rejects.toMatchObject({ code: 'invalid-input' });
  });
});
