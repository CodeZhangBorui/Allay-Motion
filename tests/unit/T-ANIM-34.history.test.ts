// T-ANIM-34（撤销历史列表，docs/animation-editor.md 6.7）：每一步的名字是产生它的那次改动；跳到某一步是连着撤销 / 重做，
// 跳回去之后还能重做回来；拖动中不动。
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { initI18n } from '../../apps/desktop/src/renderer/i18n';
import { dispatch, registerCommand } from '../../apps/desktop/src/renderer/app/registry';
import { ANIMATION_COMMANDS } from '../../apps/desktop/src/renderer/features/animation/workspace';
import { draftRef, sourceFromDoc } from '../../apps/desktop/src/renderer/features/animation/source';
import { beginGesture, clearHistory, endGesture, historyList, jumpHistory, useProjectStore } from '../../apps/desktop/src/renderer/stores/projectStore';
import { AnimationDocSchema, newAnimationDoc } from '../../apps/desktop/src/shared/animation/schema';

beforeAll(async () => {
  await initI18n('en');
  for (const c of ANIMATION_COMMANDS) registerCommand(c);
});

beforeEach(() => {
  useProjectStore.getState().reset({ template: sourceFromDoc(draftRef(), AnimationDocSchema.parse(newAnimationDoc('H', 'B'))), name: null, handle: null });
  clearHistory();
});

const layers = () => useProjectStore.getState().template!.animation!.doc.layers.length;

describe('T-ANIM-34 撤销历史列表', () => {
  it('列出每一步（开头一项是开始），名字是那次改动的命令', async () => {
    await dispatch('animAddLayer', { type: 'rect' });
    await dispatch('animAddMarker', { t: 1 });
    const { entries, current } = historyList();
    expect(entries.map((e) => e.labelKey)).toEqual([null, 'anim.history.addLayer', 'anim.history.marker']);
    expect(current).toBe(2);
  });

  it('跳到开头再跳回最新：连着撤销、重做，一步不丢', async () => {
    const n0 = layers();
    await dispatch('animAddLayer', { type: 'rect' });
    await dispatch('animAddLayer', { type: 'ellipse' });
    jumpHistory(0);
    expect(layers()).toBe(n0);
    expect(historyList().current).toBe(0);
    expect(historyList().entries).toHaveLength(3);
    jumpHistory(2);
    expect(layers()).toBe(n0 + 2);
    jumpHistory(1);
    expect(layers()).toBe(n0 + 1);
  });

  it('拖动中不动', async () => {
    await dispatch('animAddLayer', { type: 'rect' });
    beginGesture();
    jumpHistory(0);
    endGesture();
    expect(historyList().current).toBe(1);
  });
});
