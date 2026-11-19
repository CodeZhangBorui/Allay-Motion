// 时间轴的类型化命令（docs/animation-editor.md 第 11 项）：标记点、工作区范围。
// 标记和工作区存在文档里（撤销、代码视图、工程文件都照常），画面不用它们。带快捷键的：
// Shift+M 在播放头处加标记；B / N 把工作区的开头 / 结尾设在播放头。
import i18next from 'i18next';
import { z } from 'zod';
import { addMarker, moveMarker, removeMarker, renameMarker, setWorkArea } from '../../../shared/animation/markers';
import { docDuration } from '../../../shared/animation/resolve';
import { LAYER_ID_RE, type AnimationDoc } from '../../../shared/animation/schema';
import { defineCommand, type AnyCommand } from '../../app/registry';
import { useTransportStore } from '../../stores/transportStore';
import { currentAnimation, isAnimationActive, replaceDoc } from './source';

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

export const TIMELINE_COMMANDS: AnyCommand[] = [
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
