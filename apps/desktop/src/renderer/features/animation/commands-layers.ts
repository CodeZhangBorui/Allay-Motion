// 图层的类型化命令（docs/animation-editor.md 10.8）：隐藏 / 独显 / 锁定、重命名、复制、成组 / 解组、父级、排序、可见区间。
// 都只接受明确的图层 id；另有几条带快捷键的命令作用于当前选中的图层（复制 Ctrl+D、成组 Ctrl+G、解组 Ctrl+Shift+G）。
import i18next from 'i18next';
import { z } from 'zod';
import { duplicateLayers, groupLayers, moveLayer, moveLayerRelative, renameLayer, setLayerFlags, setLayerInterval, setParent, ungroup } from '../../../shared/animation/layers';
import { docDuration } from '../../../shared/animation/resolve';
import { LAYER_ID_RE, type AnimationDoc } from '../../../shared/animation/schema';
import { defineCommand, type AnyCommand } from '../../app/registry';
import { notify } from '../../stores/noticeStore';
import { currentAnimation, isAnimationActive, replaceDoc } from './source';
import { useAnimationUi } from './uiState';

const LayerId = z.string().regex(LAYER_ID_RE);
const LayerIds = z.array(LayerId).min(1).max(64);

function apply(fn: (doc: AnimationDoc) => AnimationDoc | null): boolean {
  const cur = currentAnimation();
  const next = cur ? fn(cur.doc) : null;
  return !!next && replaceDoc(next);
}

const selectedLayers = () => useAnimationUi.getState().layers;
const hasLayers = () => isAnimationActive() && selectedLayers().length > 0;

export function duplicateSelected(ids = selectedLayers()): string[] | null {
  const cur = currentAnimation();
  if (!cur || ids.length === 0) return null;
  const r = duplicateLayers(cur.doc, ids, i18next.t('anim.layers.copySuffix'));
  if (!r || !replaceDoc(r.doc)) return null;
  useAnimationUi.getState().selectLayers(r.ids);
  return r.ids;
}

export function groupSelected(ids = selectedLayers()): string | null {
  const cur = currentAnimation();
  if (!cur || ids.length === 0) return null;
  const r = groupLayers(cur.doc, ids, i18next.t('anim.layerTypes.group'));
  if (!r || !replaceDoc(r.doc)) return null;
  useAnimationUi.getState().selectLayers([r.id]);
  return r.id;
}

export function ungroupLayer(id: string): boolean {
  const cur = currentAnimation();
  const g = cur?.doc.layers.find((l) => l.id === id);
  if (!cur || !g || g.type !== 'group') return false;
  const next = ungroup(cur.doc, id);
  if (!next) {
    notify('error', i18next.t('anim.layers.ungroupHasTransform'));
    return false;
  }
  return replaceDoc(next);
}

export const LAYER_COMMANDS: AnyCommand[] = [
  defineCommand({
    id: 'animSetLayerFlags',
    titleKey: 'anim.commands.setLayerFlags',
    effect: 'write',
    undoLabelKey: 'anim.history.layer',
    hideInPalette: true,
    enabled: isAnimationActive,
    input: z.strictObject({ layer: LayerId, hidden: z.boolean().optional(), solo: z.boolean().optional(), locked: z.boolean().optional() }),
    output: z.boolean(),
    run: ({ layer, ...flags }) => apply((doc) => setLayerFlags(doc, layer, flags)),
  }),
  defineCommand({
    id: 'animRenameLayer',
    titleKey: 'anim.commands.renameLayer',
    effect: 'write',
    undoLabelKey: 'anim.history.layer',
    hideInPalette: true,
    enabled: isAnimationActive,
    input: z.strictObject({ layer: LayerId, name: z.string().trim().min(1).max(60) }),
    output: z.boolean(),
    run: ({ layer, name }) => apply((doc) => renameLayer(doc, layer, name)),
  }),
  defineCommand({
    id: 'animDuplicateLayers',
    titleKey: 'anim.commands.duplicateLayers',
    effect: 'write',
    undoLabelKey: 'anim.history.addLayer',
    hideInPalette: true,
    enabled: isAnimationActive,
    input: z.strictObject({ layers: LayerIds }),
    output: z.array(z.string()).nullable(),
    run: ({ layers }) => duplicateSelected(layers),
  }),
  defineCommand({
    id: 'animGroupLayers',
    titleKey: 'anim.commands.groupLayers',
    effect: 'write',
    undoLabelKey: 'anim.history.layer',
    hideInPalette: true,
    enabled: isAnimationActive,
    input: z.strictObject({ layers: LayerIds }),
    output: z.string().nullable(),
    run: ({ layers }) => groupSelected(layers),
  }),
  defineCommand({
    id: 'animUngroup',
    titleKey: 'anim.commands.ungroup',
    effect: 'write',
    undoLabelKey: 'anim.history.layer',
    hideInPalette: true,
    enabled: isAnimationActive,
    input: z.strictObject({ layer: LayerId }),
    output: z.boolean(),
    run: ({ layer }) => ungroupLayer(layer),
  }),
  defineCommand({
    id: 'animSetParent',
    titleKey: 'anim.commands.setParent',
    effect: 'write',
    undoLabelKey: 'anim.history.layer',
    hideInPalette: true,
    enabled: isAnimationActive,
    input: z.strictObject({ layer: LayerId, parent: LayerId.nullable() }),
    output: z.boolean(),
    run: ({ layer, parent }) => apply((doc) => setParent(doc, layer, parent)),
  }),
  defineCommand({
    id: 'animMoveLayer',
    titleKey: 'anim.commands.moveLayer',
    effect: 'write',
    undoLabelKey: 'anim.history.layer',
    hideInPalette: true,
    enabled: isAnimationActive,
    input: z.strictObject({ layer: LayerId, to: z.int().min(0).max(64) }),
    output: z.boolean(),
    run: ({ layer, to }) => apply((doc) => moveLayer(doc, layer, to)),
  }),
  defineCommand({
    id: 'animMoveLayerRelative',
    titleKey: 'anim.commands.moveLayer',
    effect: 'write',
    undoLabelKey: 'anim.history.layer',
    hideInPalette: true,
    enabled: isAnimationActive,
    input: z.strictObject({ layer: LayerId, neighbour: LayerId, place: z.enum(['above', 'below']) }),
    output: z.boolean(),
    run: ({ layer, neighbour, place }) => apply((doc) => moveLayerRelative(doc, layer, neighbour, place)),
  }),
  defineCommand({
    id: 'animSetLayerInterval',
    titleKey: 'anim.commands.setLayerInterval',
    effect: 'write',
    undoLabelKey: 'anim.history.layer',
    hideInPalette: true,
    enabled: isAnimationActive,
    input: z.strictObject({ layer: LayerId, from: z.number().min(0).max(30).nullable().optional(), to: z.number().min(0).max(30).nullable().optional() }),
    output: z.boolean(),
    run: ({ layer, from, to }) => apply((doc) => setLayerInterval(doc, layer, from, to, docDuration(doc))),
  }),
  defineCommand({
    id: 'animSetRepeat',
    titleKey: 'anim.commands.setRepeat',
    effect: 'write',
    undoLabelKey: 'anim.history.layer',
    hideInPalette: true,
    enabled: isAnimationActive,
    input: z.strictObject({ layer: LayerId, repeat: z.unknown() }),
    output: z.boolean(),
    run: ({ layer, repeat }) =>
      apply((doc) => {
        // 复制器的字段由文档 schema 校验（replaceDoc 里）：这里只放进去或去掉
        const i = doc.layers.findIndex((l) => l.id === layer);
        if (i < 0) return null;
        const next = structuredClone(doc);
        const l = next.layers[i]! as Record<string, unknown>;
        if (repeat === null || repeat === undefined) delete l.repeat;
        else l.repeat = JSON.parse(JSON.stringify(repeat)) as unknown;
        return next;
      }),
  }),
  defineCommand({
    id: 'animSetPath',
    titleKey: 'anim.commands.setPath',
    effect: 'write',
    undoLabelKey: 'anim.history.layer',
    hideInPalette: true,
    enabled: isAnimationActive,
    // path 是 null 时去掉路径；progress 给了就同时把 progress 属性换成它（打开路径时让它从 0 走到 1）
    input: z.strictObject({ layer: LayerId, path: z.unknown(), progress: z.unknown().optional() }),
    output: z.boolean(),
    run: ({ layer, path, progress }) =>
      apply((doc) => {
        const i = doc.layers.findIndex((l) => l.id === layer);
        if (i < 0) return null;
        const next = structuredClone(doc);
        const l = next.layers[i]! as Record<string, unknown> & { props: Record<string, unknown> };
        if (path === null || path === undefined) {
          delete l.path;
          delete l.props.progress;
        } else {
          l.path = JSON.parse(JSON.stringify(path)) as unknown;
          if (progress !== undefined) l.props.progress = JSON.parse(JSON.stringify(progress)) as unknown;
        }
        return next;
      }),
  }),
  // ---- 作用于选中的图层、带快捷键 ----
  defineCommand({
    id: 'animDuplicateSelection',
    titleKey: 'anim.commands.duplicateSelection',
    shortcut: 'Ctrl+D',
    category: 'edit',
    effect: 'write',
    undoLabelKey: 'anim.history.addLayer',
    enabled: hasLayers,
    run: () => void duplicateSelected(),
  }),
  defineCommand({
    id: 'animGroupSelection',
    titleKey: 'anim.commands.groupSelection',
    shortcut: 'Ctrl+G',
    category: 'edit',
    effect: 'write',
    undoLabelKey: 'anim.history.layer',
    enabled: hasLayers,
    run: () => void groupSelected(),
  }),
  defineCommand({
    id: 'animUngroupSelection',
    titleKey: 'anim.commands.ungroupSelection',
    shortcut: 'Ctrl+Shift+G',
    category: 'edit',
    effect: 'write',
    undoLabelKey: 'anim.history.layer',
    enabled: () => {
      const cur = currentAnimation();
      const id = useAnimationUi.getState().layer;
      return !!cur && !!id && cur.doc.layers.find((l) => l.id === id)?.type === 'group';
    },
    run: () => {
      const id = useAnimationUi.getState().layer;
      if (id) ungroupLayer(id);
    },
  }),
];
