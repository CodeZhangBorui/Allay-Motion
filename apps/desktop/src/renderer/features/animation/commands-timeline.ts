// 时间轴的类型化命令（docs/animation-editor.md 6.7）：标记点、工作区范围。
// 标记和工作区存在文档里（撤销、代码视图、工程文件都照常），画面不用它们。带快捷键的：
// Shift+M 在播放头处加标记；B / N 把工作区的开头 / 结尾设在播放头；
// J / K 跳到上一个 / 下一个关键帧（选中的图层的，没选时是全部图层），Shift+J / Shift+K 跳到上一个 / 下一个标记；
// 上一帧 / 下一帧（方向键，Shift 十帧）也有命令，可以在命令面板里找到。
import i18next from 'i18next';
import { z } from 'zod';
import { addMarker, adjacentTime, moveMarker, removeMarker, renameMarker, setWorkArea } from '../../../shared/animation/markers';
import { layerKeyTimes, setKeysEase } from '../../../shared/animation/edit';
import { docDuration, resolveDoc } from '../../../shared/animation/resolve';
import { AnimEasingSchema, ANIM_PROPS, LAYER_ID_RE, type AnimationDoc } from '../../../shared/animation/schema';
import { defineCommand, type AnyCommand } from '../../app/registry';
import { useTransportStore } from '../../stores/transportStore';
import { stepFrames } from '../commands/commands';
import { currentAnimation, isAnimationActive, replaceDoc } from './source';
import { useAnimationUi } from './uiState';

const MarkerId = z.string().regex(LAYER_ID_RE);
const Time = z.number().min(0).max(30);

function apply(fn: (doc: AnimationDoc) => AnimationDoc | null): boolean {
  const cur = currentAnimation();
  const next = cur ? fn(cur.doc) : null;
  return !!next && (next === cur!.doc || replaceDoc(next));
}

const playhead = () => useTransportStore.getState().time;
const hasMarkers = () => (currentAnimation()?.doc.markers?.length ?? 0) > 0;

export function addMarkerAt(t = playhead(), label?: string): string | null {
  const cur = currentAnimation();
  if (!cur) return null;
  const r = addMarker(cur.doc, Math.min(t, docDuration(cur.doc)), label);
  return r.doc === cur.doc || replaceDoc(r.doc) ? r.id : null;
}

/** 关键帧的时刻：选中的图层（没选时全部图层）有关键帧的所有时刻 */
function keyTimes(): number[] {
  const cur = currentAnimation();
  if (!cur) return [];
  const sel = useAnimationUi.getState().layers;
  const out = new Set<number>();
  for (const l of resolveDoc(cur.doc).layers) if (sel.length === 0 || sel.includes(l.id)) for (const t of layerKeyTimes(l)) out.add(t);
  return [...out];
}

function jump(times: number[], dir: 1 | -1): boolean {
  const t = adjacentTime(times, playhead(), dir);
  if (t === null) return false;
  useTransportStore.getState().setPlaying(false);
  useTransportStore.getState().setTime(t);
  return true;
}

export const TIMELINE_COMMANDS: AnyCommand[] = [
  defineCommand({ id: 'animPrevKey', titleKey: 'anim.commands.prevKey', shortcut: 'J', category: 'playback', effect: 'read', enabled: isAnimationActive, output: z.boolean(), run: () => jump(keyTimes(), -1) }),
  defineCommand({ id: 'animNextKey', titleKey: 'anim.commands.nextKey', shortcut: 'K', category: 'playback', effect: 'read', enabled: isAnimationActive, output: z.boolean(), run: () => jump(keyTimes(), 1) }),
  defineCommand({ id: 'animPrevMarker', titleKey: 'anim.commands.prevMarker', shortcut: 'Shift+J', category: 'playback', effect: 'read', enabled: hasMarkers, output: z.boolean(), run: () => jump((currentAnimation()?.doc.markers ?? []).map((m) => m.t), -1) }),
  defineCommand({ id: 'animNextMarker', titleKey: 'anim.commands.nextMarker', shortcut: 'Shift+K', category: 'playback', effect: 'read', enabled: hasMarkers, output: z.boolean(), run: () => jump((currentAnimation()?.doc.markers ?? []).map((m) => m.t), 1) }),
  defineCommand({ id: 'animStepBack', titleKey: 'anim.commands.stepBack', category: 'playback', effect: 'read', enabled: isAnimationActive, run: () => stepFrames(-1) }),
  defineCommand({ id: 'animStepForward', titleKey: 'anim.commands.stepForward', category: 'playback', effect: 'read', enabled: isAnimationActive, run: () => stepFrames(1) }),
  defineCommand({
    id: 'animSetKeysEase',
    titleKey: 'anim.commands.setKeysEase',
    effect: 'write',
    undoLabelKey: 'anim.history.keyframe',
    hideInPalette: true,
    enabled: isAnimationActive,
    // 一组关键帧的缓动（到下一个关键帧的那一段）；ease 不给是线性
    input: z.strictObject({ keys: z.array(z.strictObject({ layer: z.string().regex(LAYER_ID_RE), prop: z.enum(ANIM_PROPS), t: Time })).min(1).max(4096), ease: AnimEasingSchema.optional() }),
    output: z.boolean(),
    run: ({ keys, ease }) => apply((doc) => setKeysEase(doc, keys, ease)),
  }),
  defineCommand({
    id: 'animAddMarker',
    titleKey: 'anim.commands.addMarker',
    shortcut: 'Shift+M',
    category: 'edit',
    effect: 'write',
    undoLabelKey: 'anim.history.marker',
    enabled: isAnimationActive,
    // 不给 t 时加在播放头处
    input: z.strictObject({ t: Time.optional(), label: z.string().max(60).optional() }).optional(),
    output: z.string().nullable(),
    run: (input) => addMarkerAt(input?.t ?? playhead(), input?.label),
  }),
  defineCommand({
    id: 'animMoveMarker',
    titleKey: 'anim.commands.moveMarker',
    effect: 'write',
    undoLabelKey: 'anim.history.marker',
    hideInPalette: true,
    enabled: hasMarkers,
    input: z.strictObject({ id: MarkerId, t: Time }),
    output: z.boolean(),
    run: ({ id, t }) => apply((doc) => moveMarker(doc, id, Math.min(t, docDuration(doc)))),
  }),
  defineCommand({
    id: 'animRenameMarker',
    titleKey: 'anim.commands.renameMarker',
    effect: 'write',
    undoLabelKey: 'anim.history.marker',
    hideInPalette: true,
    enabled: hasMarkers,
    input: z.strictObject({ id: MarkerId, label: z.string().max(60) }),
    output: z.boolean(),
    run: ({ id, label }) => apply((doc) => renameMarker(doc, id, label)),
  }),
  defineCommand({
    id: 'animRemoveMarker',
    titleKey: 'anim.commands.removeMarker',
    effect: 'write',
    undoLabelKey: 'anim.history.marker',
    hideInPalette: true,
    enabled: hasMarkers,
    input: z.strictObject({ id: MarkerId }),
    output: z.boolean(),
    run: ({ id }) => apply((doc) => removeMarker(doc, id)),
  }),
  defineCommand({
    id: 'animSetWorkArea',
    titleKey: 'anim.commands.setWorkArea',
    effect: 'write',
    undoLabelKey: 'anim.history.workArea',
    hideInPalette: true,
    enabled: isAnimationActive,
    // 只给一端时另一端不动；两端都给 null 是清掉
    input: z.strictObject({ from: Time.nullable().optional(), to: Time.nullable().optional() }),
    output: z.boolean(),
    run: ({ from, to }) => apply((doc) => setWorkArea(doc, docDuration(doc), from, to)),
  }),
  defineCommand({
    id: 'animWorkAreaStart',
    titleKey: 'anim.commands.workAreaStart',
    shortcut: 'B',
    category: 'edit',
    effect: 'write',
    undoLabelKey: 'anim.history.workArea',
    enabled: isAnimationActive,
    run: () => void apply((doc) => setWorkArea(doc, docDuration(doc), playhead(), undefined)),
  }),
  defineCommand({
    id: 'animWorkAreaEnd',
    titleKey: 'anim.commands.workAreaEnd',
    shortcut: 'N',
    category: 'edit',
    effect: 'write',
    undoLabelKey: 'anim.history.workArea',
    enabled: isAnimationActive,
    run: () => void apply((doc) => setWorkArea(doc, docDuration(doc), undefined, playhead())),
  }),
  defineCommand({
    id: 'animClearWorkArea',
    titleKey: 'anim.commands.clearWorkArea',
    category: 'edit',
    effect: 'write',
    undoLabelKey: 'anim.history.workArea',
    enabled: () => !!currentAnimation()?.doc.workArea,
    run: () => void apply((doc) => setWorkArea(doc, docDuration(doc), null, null)),
  }),
];

/** 标记的显示名：有名字用名字，没有时是“标记 n” */
export function markerLabel(label: string | undefined, index: number): string {
  return label ?? i18next.t('anim.markers.unnamed', { n: index + 1 });
}
