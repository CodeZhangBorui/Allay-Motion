// 动画工作区的类型化命令（docs/code-editing-and-mcp-plan.md H2；docs/animation-editor.md 第 6 节）。
// 界面按钮、命令面板、将来内置的 agent 或 MCP 调的是同一套命令：入参、返回值都有 zod schema，write 命令进撤销历史。
// 这里不做 MCP（H-MCP 未批准），只把命令层准备好。
import { AppWindow, ArrowSquareOut, Code, FilmSlate, Plus, Stack, TreeStructure } from '@phosphor-icons/react';
import i18next from 'i18next';
import { z } from 'zod';
import { AnimEasingSchema, ANIM_PROPS, isKeyed, LAYER_TYPES, LayerSchema, newAnimationDoc, type Layer, type LayerType } from '../../../shared/animation/schema';
import { docDuration, resolveDoc } from '../../../shared/animation/resolve';
import { keyIndexAt, moveKey, propValue, removeKey, setKeyEase, setValueAt } from '../../../shared/animation/edit';
import { defineCommand, type AnyCommand } from '../../app/registry';
import { notify } from '../../stores/noticeStore';
import { clearHistory, projectRevision, RevisionConflictError, useProjectStore } from '../../stores/projectStore';
import { useTemplateStore } from '../../stores/templateStore';
import { useTransportStore } from '../../stores/transportStore';
import { easeEval } from './easeEval';
import { confirmDiscard } from '../project/actions';
import { previewEngine } from '../preview/previewEngine';
import { currentAnimation, draftRef, editDoc, isAnimationActive, nextLayerId, replaceDoc, setAnimationText, sourceFromDoc } from './source';
import { removeLayer } from '../../../shared/animation/layers';
import { useAnimationUi } from './uiState';
import { codeWindowAvailable, editCode, openCodeWindow, openExternal } from './codeWindow';

const t = (key: string, vars?: Record<string, unknown>) => i18next.t(key, vars ?? {});

const LayerIdInput = z.string().min(1).max(32);
const PropInput = z.enum(ANIM_PROPS);
const Issues = z.array(z.strictObject({ message: z.string(), path: z.string(), line: z.number().optional(), column: z.number().optional() }));

/** 新建图层的默认内容（名字按界面语言取一次） */
export function defaultLayer(type: LayerType, id: string): Layer {
  const name = t(`anim.layerTypes.${type}`);
  switch (type) {
    case 'block':
      return LayerSchema.parse({ id, name, type, block: 'minecraft:grass_block', size: 160, props: { rotX: 20, rotY: 45 } });
    case 'item':
      return LayerSchema.parse({ id, name, type, item: 'minecraft:diamond_sword', size: 200, props: {} });
    case 'text':
      return LayerSchema.parse({ id, name, type, text: t('anim.defaultText'), size: 8, props: {} });
    case 'rect':
      return LayerSchema.parse({ id, name, type, width: 400, height: 240, props: {} });
    case 'ellipse':
      return LayerSchema.parse({ id, name, type, width: 240, height: 240, props: {} });
    case 'line':
      return LayerSchema.parse({ id, name, type, width: 400, height: 12, props: {} });
    case 'group':
      return LayerSchema.parse({ id, name, type, props: {} });
  }
}

/** 新建一个动画（等于新建工程）：有未保存的改动时先问一句 */
export async function newAnimation(name = t('anim.defaultName')): Promise<boolean> {
  if (!(await confirmDiscard())) return false;
  const doc = newAnimationDoc(name, t('anim.layerTypes.block'));
  useProjectStore.getState().reset({ template: sourceFromDoc(draftRef(), doc), name: null, handle: null, locale: i18next.language });
  clearHistory();
  useTransportStore.getState().setTime(0);
  useAnimationUi.getState().select({ layer: doc.layers[0]?.id ?? null, key: null });
  previewEngine.retry();
  return true;
}

export function addLayer(type: LayerType, patch: Partial<Layer> = {}): string | null {
  let id: string | null = null;
  const ok = editDoc((doc) => {
    id = nextLayerId(doc, type);
    doc.layers.push({ ...defaultLayer(type, id), ...patch, id, type } as Layer);
  });
  if (!ok || !id) return null;
  useAnimationUi.getState().select({ layer: id, key: null });
  return id;
}

function layerIndex(id: string): number {
  return currentAnimation()?.doc.layers.findIndex((l) => l.id === id) ?? -1;
}

/** 在 t 处设属性值（自动关键帧，见 edit.ts 的 setValueAt） */
export function setProp(layerId: string, prop: (typeof ANIM_PROPS)[number], value: number, at = useTransportStore.getState().time): boolean {
  return editDoc((doc) => {
    const l = doc.layers.find((x) => x.id === layerId);
    if (l) l.props[prop] = setValueAt(l.props[prop], at, value);
  });
}

/** 在 t 处加（或删）一个关键帧：加的时候取当前插值出来的值 */
export function toggleKey(layerId: string, prop: (typeof ANIM_PROPS)[number], at = useTransportStore.getState().time): boolean {
  return editDoc((doc) => {
    const l = doc.layers.find((x) => x.id === layerId);
    if (!l) return;
    const track = l.props[prop];
    const i = keyIndexAt(track, at);
    if (i >= 0) {
      const next = removeKey(track, i);
      if (next === undefined) delete l.props[prop];
      else l.props[prop] = next;
    } else {
      // 当前插值出来的值（绑定到参数的按参数的默认值算）
      const resolved = resolveDoc(doc).layers.find((x) => x.id === layerId)!;
      const v = propValue(resolved, prop, at, easeEval);
      const keys = isKeyed(track) ? track.keys : [];
      l.props[prop] = { keys: [...keys, { t: Math.round(at * 10000) / 10000, v: Math.round(v * 10000) / 10000 }].sort((a, b) => a.t - b.t) };
    }
  });
}

const SetTextInput = z.strictObject({ text: z.string().max(512 * 1024), baseRevision: z.int().optional() });

export const ANIMATION_COMMANDS: AnyCommand[] = [
  defineCommand({
    id: 'animNew',
    titleKey: 'anim.commands.new',
    category: 'file',
    icon: FilmSlate,
    effect: 'write',
    undoLabelKey: 'anim.history.new',
    input: z.strictObject({ name: z.string().trim().min(1).max(60).optional() }).optional(),
    output: z.boolean(),
    run: (input) => newAnimation(input?.name),
  }),
  defineCommand({
    id: 'animGet',
    titleKey: 'anim.commands.get',
    effect: 'read',
    hideInPalette: true,
    output: z.strictObject({ text: z.string(), revision: z.int(), valid: z.boolean(), issues: Issues }).nullable(),
    run: () => {
      const cur = currentAnimation();
      return cur ? { text: cur.text, revision: projectRevision(), valid: cur.issues.length === 0, issues: [...cur.issues] } : null;
    },
  }),
  defineCommand({
    id: 'animSetText',
    titleKey: 'anim.commands.setText',
    effect: 'write',
    undoLabelKey: 'anim.history.code',
    hideInPalette: true,
    enabled: isAnimationActive,
    input: SetTextInput,
    output: z.strictObject({ ok: z.boolean(), issues: Issues }),
    run: ({ text, baseRevision }) => {
      if (baseRevision !== undefined && baseRevision !== projectRevision()) throw new RevisionConflictError(baseRevision, projectRevision());
      const issues = setAnimationText(text);
      return { ok: issues.length === 0, issues: [...issues] };
    },
  }),
  defineCommand({
    id: 'animAddLayer',
    titleKey: 'anim.commands.addLayer',
    icon: Plus,
    effect: 'write',
    undoLabelKey: 'anim.history.addLayer',
    hideInPalette: true,
    enabled: isAnimationActive,
    input: z.strictObject({ type: z.enum(LAYER_TYPES) }),
    output: z.string().nullable(),
    run: ({ type }) => addLayer(type),
  }),
  defineCommand({
    id: 'animRemoveLayer',
    titleKey: 'anim.commands.removeLayer',
    effect: 'write',
    undoLabelKey: 'anim.history.removeLayer',
    hideInPalette: true,
    enabled: isAnimationActive,
    input: z.strictObject({ layer: LayerIdInput }),
    output: z.boolean(),
    run: ({ layer }) => {
      if (layerIndex(layer) < 0) return false;
      // 子图层改挂到被删图层的父级（layers.ts 的 removeLayer）
      const cur = currentAnimation();
      const next = cur ? removeLayer(cur.doc, layer) : null;
      return !!next && replaceDoc(next);
    },
  }),
  defineCommand({
    id: 'animSetKeyframe',
    titleKey: 'anim.commands.setKeyframe',
    effect: 'write',
    undoLabelKey: 'anim.history.keyframe',
    hideInPalette: true,
    enabled: isAnimationActive,
    input: z.strictObject({ layer: LayerIdInput, prop: PropInput, t: z.number().min(0).max(30), v: z.number().refine(Number.isFinite), ease: AnimEasingSchema.optional() }),
    output: z.boolean(),
    run: ({ layer, prop, t: at, v, ease }) =>
      editDoc((doc) => {
        const l = doc.layers.find((x) => x.id === layer);
        if (!l) throw new Error(`unknown layer ${layer}`);
        const track = l.props[prop];
        // 命令总是落成关键帧（常量轨道先变成一个关键帧）
        const keyed = isKeyed(track) ? track : { keys: [{ t: at, v }] };
        let next = setValueAt(keyed, at, v);
        if (ease !== undefined) next = setKeyEase(next, keyIndexAt(next, at), ease) ?? next;
        l.props[prop] = next;
      }),
  }),
  defineCommand({
    id: 'animRemoveKeyframe',
    titleKey: 'anim.commands.removeKeyframe',
    effect: 'write',
    undoLabelKey: 'anim.history.keyframe',
    hideInPalette: true,
    enabled: isAnimationActive,
    input: z.strictObject({ layer: LayerIdInput, prop: PropInput, t: z.number().min(0).max(30) }),
    output: z.boolean(),
    run: ({ layer, prop, t: at }) =>
      editDoc((doc) => {
        const l = doc.layers.find((x) => x.id === layer);
        if (!l) return;
        const next = removeKey(l.props[prop], keyIndexAt(l.props[prop], at));
        if (next === undefined) delete l.props[prop];
        else l.props[prop] = next;
      }),
  }),
  defineCommand({
    id: 'animMoveKeyframe',
    titleKey: 'anim.commands.moveKeyframe',
    effect: 'write',
    undoLabelKey: 'anim.history.keyframe',
    hideInPalette: true,
    enabled: isAnimationActive,
    input: z.strictObject({ layer: LayerIdInput, prop: PropInput, from: z.number().min(0).max(30), to: z.number().min(0).max(30) }),
    output: z.boolean(),
    run: ({ layer, prop, from, to }) => {
      let moved = false;
      const ok = editDoc((doc) => {
        const l = doc.layers.find((x) => x.id === layer);
        if (!l) return;
        const next = moveKey(l.props[prop], keyIndexAt(l.props[prop], from), to, docDuration(doc));
        if (next) {
          l.props[prop] = next;
          moved = true;
        }
      });
      return ok && moved;
    },
  }),
  defineCommand({
    id: 'animConvertToTemplate',
    titleKey: 'anim.commands.convert',
    category: 'templates',
    icon: TreeStructure,
    effect: 'write',
    enabled: () => {
      const cur = currentAnimation();
      return !!cur && cur.issues.length === 0;
    },
    output: z.strictObject({ id: z.string(), version: z.string() }).nullable(),
    run: () => convertToTemplate(),
  }),
  defineCommand({
    id: 'animEditCode',
    titleKey: 'anim.commands.editCode',
    category: 'view',
    icon: Code,
    effect: 'read',
    enabled: isAnimationActive,
    run: () => editCode(),
  }),
  defineCommand({
    id: 'animOpenCodeWindow',
    titleKey: 'anim.commands.openCodeWindow',
    category: 'view',
    icon: AppWindow,
    effect: 'read',
    enabled: () => isAnimationActive() && codeWindowAvailable(),
    run: () => openCodeWindow(),
  }),
  defineCommand({
    id: 'animOpenExternal',
    titleKey: 'anim.commands.openExternal',
    category: 'view',
    icon: ArrowSquareOut,
    effect: 'read',
    enabled: isAnimationActive,
    output: z.boolean(),
    run: () => openExternal(),
  }),
  defineCommand({
    id: 'animToggleCode',
    titleKey: 'anim.commands.toggleCode',
    category: 'view',
    icon: Stack,
    effect: 'read',
    enabled: isAnimationActive,
    run: () => useAnimationUi.getState().setCodeOpen(!useAnimationUi.getState().codeOpen),
  }),
];

/** 手动转为模板（docs/animation-editor.md 第 7 节）：主进程生成一个标准的用户模板目录，模板库里就有了 */
export async function convertToTemplate(): Promise<{ id: string; version: string } | null> {
  const cur = currentAnimation();
  if (!cur || cur.issues.length > 0) return null;
  const r = await window.allay.templates.createFromAnimation({ text: cur.text });
  if (!r.ok) {
    notify('error', t('anim.errors.convert', { reason: r.detail ?? r.error }));
    return null;
  }
  await useTemplateStore.getState().refresh();
  notify('info', t('anim.converted', { name: cur.doc.name }));
  return { id: r.entry.id, version: r.entry.version };
}
