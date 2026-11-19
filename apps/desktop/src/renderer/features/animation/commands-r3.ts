// 第三轮的类型化命令（docs/animation-editor.md 10.6）：暴露为参数、音效轨、多个关键帧、曲线。
// 界面上的操作都经这些命令（或同一组纯函数），将来内置的 agent 或 MCP 调的也是它们；仍然不做 MCP。
// 入参、返回值都有 zod schema；write 命令进撤销历史。“选中的关键帧”是界面状态，命令本身只接受明确的关键帧列表，
// 另有几条带快捷键的命令（复制、粘贴、删除、全选）作用于当前选择。
import i18next from 'i18next';
import { z } from 'zod';
import {
  alignKeys,
  copyKeys,
  deleteKeys,
  pasteKeys,
  scaleKeys,
  setSegmentBezier,
  shiftKeys,
  snapKeysToFrames,
  keyIndexAt,
  keysOf,
  type KeyClipboard,
  type KeyRef,
} from '../../../shared/animation/edit';
import {
  bindTo,
  BindTargetSchema,
  defaultKeyBase,
  exposeAsParam,
  nextSoundId,
  removeParam,
  SoundPatchSchema,
  unbind,
  updateParam,
  updateSound,
} from '../../../shared/animation/params';
import { docDuration } from '../../../shared/animation/resolve';
import { removeLayer } from '../../../shared/animation/layers';
import { ANIM_PROPS, AnimationDocSchema, AnimParamSchema, isKeyed, LAYER_ID_RE, type AnimationDoc } from '../../../shared/animation/schema';
import { defineCommand, type AnyCommand } from '../../app/registry';
import { notify } from '../../stores/noticeStore';
import { useProjectStore } from '../../stores/projectStore';
import { useTransportStore } from '../../stores/transportStore';
import { currentAnimation, isAnimationActive, replaceDoc } from './source';
import { useAnimationUi } from './uiState';

const KeyRefSchema = z.strictObject({ layer: z.string().regex(LAYER_ID_RE), prop: z.enum(ANIM_PROPS), t: z.number().min(0).max(30) });
const KeyListSchema = z.array(KeyRefSchema).min(1).max(4096);
const ClipboardSchema = z.strictObject({
  kind: z.literal('allay-keys'),
  version: z.literal(1),
  keys: z
    .array(
      z.strictObject({
        layer: z.string().regex(LAYER_ID_RE),
        prop: z.enum(ANIM_PROPS),
        dt: z.number().min(0).max(30),
        v: z.union([z.number().refine(Number.isFinite), z.strictObject({ $param: z.string().max(64) })]),
        ease: z.unknown().optional(),
      }),
    )
    .min(1)
    .max(4096),
});
const BezierSchema = z.tuple([z.number().min(0).max(1), z.number().min(-2).max(3), z.number().min(0).max(1), z.number().min(-2).max(3)]);
const KeysOutput = z.array(KeyRefSchema).nullable();

const write = <T>(fn: (doc: AnimationDoc) => { doc: AnimationDoc; out: T } | null): T | null => {
  const cur = currentAnimation();
  if (!cur) return null;
  const r = fn(cur.doc);
  if (!r) return null;
  return replaceDoc(r.doc) ? r.out : null;
};

/** 关键帧的改动：成功时让选择跟着走（挪到新的时刻） */
function keysWrite(fn: (doc: AnimationDoc, duration: number) => { doc: AnimationDoc; refs: KeyRef[] } | null): KeyRef[] | null {
  const refs = write((doc) => {
    const r = fn(doc, docDuration(doc));
    return r ? { doc: r.doc, out: r.refs } : null;
  });
  if (refs) useAnimationUi.getState().selectKeys(refs);
  return refs;
}

const selected = () => useAnimationUi.getState().keys;
const hasSelection = () => isAnimationActive() && selected().length > 0;
const fps = () => useProjectStore.getState().output.fps;

/** 当前图层所有有关键帧的属性的全部关键帧 */
function allKeysOf(doc: AnimationDoc, layerIds: readonly string[] | null): KeyRef[] {
  const out: KeyRef[] = [];
  for (const l of doc.layers) {
    if (layerIds && !layerIds.includes(l.id)) continue;
    for (const prop of ANIM_PROPS) for (const k of keysOf(l.props[prop])) out.push({ layer: l.id, prop, t: k.t });
  }
  return out;
}

export function copySelection(): KeyClipboard | null {
  const cur = currentAnimation();
  if (!cur) return null;
  const clip = copyKeys(cur.doc, selected());
  useAnimationUi.getState().setClipboard(clip);
  return clip;
}

/** 粘到播放头；目标是选中的图层（剪贴板只有一个图层时）、最后点中的属性（剪贴板只有一条属性时） */
export function pasteSelection(): KeyRef[] | null {
  const ui = useAnimationUi.getState();
  if (!ui.clipboard) return null;
  const at = useTransportStore.getState().time;
  return keysWrite((doc, duration) => pasteKeys(doc, ui.clipboard!, at, duration, { ...(ui.layer ? { layers: [ui.layer] } : {}), ...(ui.key ? { prop: ui.key.prop } : {}) }));
}

export const ANIMATION_R3_COMMANDS: AnyCommand[] = [
  // ---- 参数 ----
  defineCommand({
    id: 'animAddParam',
    titleKey: 'anim.commands.addParam',
    effect: 'write',
    undoLabelKey: 'anim.history.params',
    hideInPalette: true,
    enabled: isAnimationActive,
    input: z.strictObject({ param: AnimParamSchema }),
    output: z.boolean(),
    run: ({ param }) => write((doc) => (doc.params.some((p) => p.key === param.key) ? null : { doc: { ...doc, params: [...doc.params, param] }, out: true })) ?? false,
  }),
  defineCommand({
    id: 'animUpdateParam',
    titleKey: 'anim.commands.updateParam',
    effect: 'write',
    undoLabelKey: 'anim.history.params',
    hideInPalette: true,
    enabled: isAnimationActive,
    input: z.strictObject({ key: z.string().max(64), patch: z.record(z.string(), z.unknown()) }),
    output: z.boolean(),
    run: ({ key, patch }) => {
      const { key: _k, type: _t, ...rest } = patch;
      return write((doc) => {
        const next = updateParam(doc, key, rest as never);
        return next ? { doc: next, out: true } : null;
      }) ?? false;
    },
  }),
  defineCommand({
    id: 'animRemoveParam',
    titleKey: 'anim.commands.removeParam',
    effect: 'write',
    undoLabelKey: 'anim.history.params',
    hideInPalette: true,
    enabled: isAnimationActive,
    input: z.strictObject({ key: z.string().max(64) }),
    output: z.boolean(),
    run: ({ key }) => write((doc) => (doc.params.some((p) => p.key === key) ? { doc: removeParam(doc, key), out: true } : null)) ?? false,
  }),
  defineCommand({
    id: 'animExposeParam',
    titleKey: 'anim.commands.exposeParam',
    effect: 'write',
    undoLabelKey: 'anim.history.params',
    hideInPalette: true,
    enabled: isAnimationActive,
    input: z.strictObject({ target: BindTargetSchema, label: z.string().trim().min(1).max(60), key: z.string().max(64).optional() }),
    output: z.string().nullable(),
    run: ({ target, label, key }) =>
      write((doc) => {
        const r = exposeAsParam(doc, target, label, key ?? defaultKeyBase(target));
        return r ? { doc: r.doc, out: r.key } : null;
      }),
  }),
  defineCommand({
    id: 'animBindParam',
    titleKey: 'anim.commands.bindParam',
    effect: 'write',
    undoLabelKey: 'anim.history.params',
    hideInPalette: true,
    enabled: isAnimationActive,
    input: z.strictObject({ target: BindTargetSchema, key: z.string().max(64) }),
    output: z.boolean(),
    run: ({ target, key }) =>
      write((doc) => {
        const next = bindTo(doc, target, key);
        return next ? { doc: next, out: true } : null;
      }) ?? false,
  }),
  defineCommand({
    id: 'animUnbindParam',
    titleKey: 'anim.commands.unbindParam',
    effect: 'write',
    undoLabelKey: 'anim.history.params',
    hideInPalette: true,
    enabled: isAnimationActive,
    input: z.strictObject({ target: BindTargetSchema }),
    output: z.boolean(),
    run: ({ target }) =>
      write((doc) => {
        const next = unbind(doc, target);
        return next ? { doc: next, out: true } : null;
      }) ?? false,
  }),

  // ---- 音效轨 ----
  defineCommand({
    id: 'animAddSound',
    titleKey: 'anim.commands.addSound',
    effect: 'write',
    undoLabelKey: 'anim.history.sound',
    hideInPalette: true,
    enabled: isAnimationActive,
    input: z.strictObject({ sound: z.string().max(256), at: z.number().min(0).max(30).optional(), gain: z.number().min(0).max(2).optional() }),
    output: z.string().nullable(),
    run: ({ sound, at, gain }) => {
      const id = write((doc) => {
        const nid = nextSoundId(doc);
        const t = Math.min(docDuration(doc), at ?? useTransportStore.getState().time);
        const next = { ...doc, sounds: [...doc.sounds, { id: nid, at: Math.round(t * 10000) / 10000, sound, gain: gain ?? 1 }].sort((a, b) => a.at - b.at) };
        return { doc: next, out: nid };
      });
      if (id) useAnimationUi.getState().selectSound(id);
      return id;
    },
  }),
  defineCommand({
    id: 'animUpdateSound',
    titleKey: 'anim.commands.updateSound',
    effect: 'write',
    undoLabelKey: 'anim.history.sound',
    hideInPalette: true,
    enabled: isAnimationActive,
    input: z.strictObject({ id: z.string().regex(LAYER_ID_RE), patch: SoundPatchSchema }),
    output: z.boolean(),
    run: ({ id, patch }) =>
      write((doc) => {
        const next = updateSound(doc, id, patch);
        return next ? { doc: next, out: true } : null;
      }) ?? false,
  }),
  defineCommand({
    id: 'animRemoveSound',
    titleKey: 'anim.commands.removeSound',
    effect: 'write',
    undoLabelKey: 'anim.history.sound',
    hideInPalette: true,
    enabled: isAnimationActive,
    input: z.strictObject({ id: z.string().regex(LAYER_ID_RE) }),
    output: z.boolean(),
    run: ({ id }) => {
      const ok = write((doc) => (doc.sounds.some((s) => s.id === id) ? { doc: { ...doc, sounds: doc.sounds.filter((s) => s.id !== id) }, out: true } : null)) ?? false;
      if (ok && useAnimationUi.getState().sound === id) useAnimationUi.getState().selectSound(null);
      return ok;
    },
  }),

  // ---- 多个关键帧 ----
  defineCommand({
    id: 'animMoveKeys',
    titleKey: 'anim.commands.moveKeys',
    effect: 'write',
    undoLabelKey: 'anim.history.keyframe',
    hideInPalette: true,
    enabled: isAnimationActive,
    input: z.strictObject({ keys: KeyListSchema, dt: z.number().min(-30).max(30) }),
    output: KeysOutput,
    run: ({ keys, dt }) => keysWrite((doc, duration) => shiftKeys(doc, keys, dt, duration)),
  }),
  defineCommand({
    id: 'animScaleKeys',
    titleKey: 'anim.commands.scaleKeys',
    effect: 'write',
    undoLabelKey: 'anim.history.keyframe',
    hideInPalette: true,
    enabled: isAnimationActive,
    input: z.strictObject({ keys: KeyListSchema, pivot: z.number().min(0).max(30), factor: z.number().positive().max(100) }),
    output: KeysOutput,
    run: ({ keys, pivot, factor }) => keysWrite((doc, duration) => scaleKeys(doc, keys, pivot, factor, duration)),
  }),
  defineCommand({
    id: 'animAlignKeys',
    titleKey: 'anim.commands.alignKeys',
    effect: 'write',
    undoLabelKey: 'anim.history.keyframe',
    hideInPalette: true,
    enabled: isAnimationActive,
    input: z.strictObject({ keys: KeyListSchema, to: z.union([z.literal('playhead'), z.literal('frame'), z.number().min(0).max(30)]) }),
    output: KeysOutput,
    run: ({ keys, to }) =>
      keysWrite((doc, duration) => {
        if (to === 'frame') return snapKeysToFrames(doc, keys, fps(), duration);
        return alignKeys(doc, keys, to === 'playhead' ? useTransportStore.getState().time : to, duration);
      }),
  }),
  defineCommand({
    id: 'animDeleteKeys',
    titleKey: 'anim.commands.deleteKeys',
    effect: 'write',
    undoLabelKey: 'anim.history.keyframe',
    hideInPalette: true,
    enabled: isAnimationActive,
    input: z.strictObject({ keys: KeyListSchema }),
    output: z.boolean(),
    run: ({ keys }) => {
      const ok = write((doc) => ({ doc: deleteKeys(doc, keys), out: true })) ?? false;
      if (ok) useAnimationUi.getState().selectKeys([]);
      return ok;
    },
  }),
  defineCommand({
    id: 'animCopyKeys',
    titleKey: 'anim.commands.copyKeys',
    effect: 'read',
    hideInPalette: true,
    enabled: isAnimationActive,
    input: z.strictObject({ keys: KeyListSchema }),
    output: ClipboardSchema.nullable(),
    run: ({ keys }) => {
      const cur = currentAnimation();
      return cur ? copyKeys(cur.doc, keys) : null;
    },
  }),
  defineCommand({
    id: 'animPasteKeys',
    titleKey: 'anim.commands.pasteKeys',
    effect: 'write',
    undoLabelKey: 'anim.history.keyframe',
    hideInPalette: true,
    enabled: isAnimationActive,
    input: z.strictObject({ clip: ClipboardSchema, at: z.number().min(0).max(30), layers: z.array(z.string().regex(LAYER_ID_RE)).max(64).optional(), prop: z.enum(ANIM_PROPS).optional() }),
    output: KeysOutput,
    run: ({ clip, at, layers, prop }) => keysWrite((doc, duration) => pasteKeys(doc, clip as KeyClipboard, at, duration, { ...(layers ? { layers } : {}), ...(prop ? { prop } : {}) })),
  }),
  defineCommand({
    id: 'animSetSegmentCurve',
    titleKey: 'anim.commands.setSegmentCurve',
    effect: 'write',
    undoLabelKey: 'anim.history.keyframe',
    hideInPalette: true,
    enabled: isAnimationActive,
    input: z.strictObject({ layer: z.string().regex(LAYER_ID_RE), prop: z.enum(ANIM_PROPS), t: z.number().min(0).max(30), bezier: BezierSchema }),
    output: z.boolean(),
    run: ({ layer, prop, t, bezier }) =>
      write((doc) => {
        const next = structuredClone(doc);
        const l = next.layers.find((x) => x.id === layer);
        const track = l?.props[prop];
        if (!l || !isKeyed(track)) return null;
        const r = setSegmentBezier(track, keyIndexAt(track, t), bezier);
        if (!r) return null;
        l.props[prop] = r;
        return { doc: next, out: true };
      }) ?? false,
  }),

  // ---- 作用于当前选择、带快捷键的 ----
  defineCommand({
    id: 'animCopySelection',
    titleKey: 'anim.commands.copySelection',
    shortcut: 'Ctrl+C',
    category: 'edit',
    effect: 'read',
    enabled: hasSelection,
    run: () => {
      if (copySelection()) notify('info', i18next.t('anim.keys.copied', { count: selected().length }));
    },
  }),
  defineCommand({
    id: 'animPasteSelection',
    titleKey: 'anim.commands.pasteSelection',
    shortcut: 'Ctrl+V',
    category: 'edit',
    effect: 'write',
    undoLabelKey: 'anim.history.keyframe',
    enabled: () => isAnimationActive() && useAnimationUi.getState().clipboard !== null,
    run: () => void pasteSelection(),
  }),
  defineCommand({
    id: 'animDeleteSelection',
    titleKey: 'anim.commands.deleteSelection',
    shortcut: 'Delete',
    category: 'edit',
    effect: 'write',
    undoLabelKey: 'anim.history.keyframe',
    enabled: () => isAnimationActive() && (selected().length > 0 || useAnimationUi.getState().sound !== null || useAnimationUi.getState().layers.length > 0),
    run: () => {
      const ui = useAnimationUi.getState();
      if (ui.keys.length > 0) {
        const doc = currentAnimation()?.doc;
        if (doc && replaceDoc(deleteKeys(doc, ui.keys))) ui.selectKeys([]);
      } else if (ui.sound) {
        const doc = currentAnimation()?.doc;
        if (doc && replaceDoc({ ...doc, sounds: doc.sounds.filter((s) => s.id !== ui.sound) })) ui.selectSound(null);
      } else if (ui.layers.length > 0) {
        // 删选中的图层（子图层改挂到被删图层的父级）；锁定的不删
        let doc = currentAnimation()?.doc ?? null;
        for (const id of ui.layers) {
          if (!doc || doc.layers.find((l) => l.id === id)?.locked) continue;
          doc = removeLayer(doc, id) ?? doc;
        }
        if (doc && replaceDoc(doc)) ui.selectLayers([]);
      }
    },
  }),
  defineCommand({
    id: 'animSelectAllKeys',
    titleKey: 'anim.commands.selectAllKeys',
    shortcut: 'Ctrl+A',
    category: 'edit',
    effect: 'read',
    enabled: isAnimationActive,
    run: () => {
      const cur = currentAnimation();
      if (!cur) return;
      const layer = useAnimationUi.getState().layer;
      useAnimationUi.getState().selectKeys(allKeysOf(cur.doc, layer ? [layer] : null));
    },
  }),
  defineCommand({
    id: 'animAlignSelectionToPlayhead',
    titleKey: 'anim.commands.alignToPlayhead',
    category: 'edit',
    effect: 'write',
    undoLabelKey: 'anim.history.keyframe',
    enabled: hasSelection,
    run: () => void keysWrite((doc, duration) => alignKeys(doc, selected(), useTransportStore.getState().time, duration)),
  }),
  defineCommand({
    id: 'animSnapSelectionToFrames',
    titleKey: 'anim.commands.snapToFrames',
    category: 'edit',
    effect: 'write',
    undoLabelKey: 'anim.history.keyframe',
    enabled: hasSelection,
    run: () => void keysWrite((doc, duration) => snapKeysToFrames(doc, selected(), fps(), duration)),
  }),
  defineCommand({
    id: 'animToggleSnap',
    titleKey: 'anim.commands.toggleSnap',
    category: 'view',
    effect: 'read',
    enabled: isAnimationActive,
    run: () => useAnimationUi.getState().setSnap(!useAnimationUi.getState().snap),
  }),
  defineCommand({
    id: 'animToggleGraph',
    titleKey: 'anim.commands.toggleGraph',
    category: 'view',
    effect: 'read',
    enabled: isAnimationActive,
    run: () => useAnimationUi.getState().setView(useAnimationUi.getState().view === 'graph' ? 'keys' : 'graph'),
  }),
];

/** 校验通过才提交的整份替换（命令和界面共用；不合法时提示并返回 false） */
export function validDoc(doc: unknown): AnimationDoc | null {
  const r = AnimationDocSchema.safeParse(doc);
  return r.success ? r.data : null;
}
