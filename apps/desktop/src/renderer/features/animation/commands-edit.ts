// 检查器里的修改的类型化命令（docs/animation-editor.md 第 7 节）：图层的内容字段（形状、图片、文字、逐字、混合……）、
// 某一刻的属性值（预览里拖动变换用的也是它）、整段动画的设置。界面上的这些修改也走这几条命令，
// 所以 agent / MCP 能做的和界面一样，撤销记录的名字也一样。改完的文档照常经 schema 校验，不合法的整条拒绝。
import { z } from 'zod';
import { setPropValues } from '../../../shared/animation/params';
import { ANIM_PROPS, LAYER_ID_RE, type AnimationDoc } from '../../../shared/animation/schema';
import { defineCommand, type AnyCommand } from '../../app/registry';
import { useTransportStore } from '../../stores/transportStore';
import { currentAnimation, isAnimationActive, replaceDoc } from './source';

const LayerId = z.string().regex(LAYER_ID_RE);
/** 不能经 animUpdateLayer 改的字段：标识、类型、属性轨道（用关键帧命令）、父级（animSetParent） */
const RESERVED = new Set(['id', 'type', 'props', 'parent']);
const FieldName = z
  .string()
  .regex(/^[a-zA-Z][a-zA-Z0-9]{0,31}$/)
  .refine((k) => !RESERVED.has(k), 'use the dedicated command for this field');
/** JSON 值（null 表示去掉这个字段） */
const Json: z.ZodType<unknown> = z.lazy(() => z.union([z.null(), z.boolean(), z.number(), z.string().max(4096), z.array(Json).max(256), z.record(z.string().max(64), Json)]));

function apply(fn: (doc: AnimationDoc) => AnimationDoc | null): boolean {
  const cur = currentAnimation();
  const next = cur ? fn(cur.doc) : null;
  return !!next && replaceDoc(next);
}

/** 改一个图层的若干字段（值是 null 时去掉那个字段，回到默认） */
export function updateLayer(doc: AnimationDoc, layer: string, fields: Readonly<Record<string, unknown>>): AnimationDoc | null {
  const i = doc.layers.findIndex((l) => l.id === layer);
  if (i < 0) return null;
  const next = structuredClone(doc);
  const l = next.layers[i] as unknown as Record<string, unknown>;
  for (const [k, v] of Object.entries(fields)) {
    if (RESERVED.has(k)) return null;
    if (v === null || v === undefined) delete l[k];
    else l[k] = structuredClone(v);
  }
  return next;
}

const DocPatch = z.strictObject({
  name: z.string().trim().min(1).max(60).optional(),
  category: z.enum(['transition', 'overlay', 'title']).optional(),
  duration: z.number().min(0.1).max(30).optional(),
  cutTime: z.number().min(0).max(30).nullable().optional(),
  camera: z.union([z.strictObject({ type: z.literal('ortho') }), z.strictObject({ type: z.literal('perspective'), fov: z.number().min(5).max(120) })]).optional(),
});

/** 改整段动画的设置；分类改成转场又没有剪辑点时补一个在正中间（同检查器） */
export function updateDoc(doc: AnimationDoc, patch: z.infer<typeof DocPatch>): AnimationDoc {
  const next = structuredClone(doc);
  if (patch.name !== undefined) next.name = patch.name;
  if (patch.duration !== undefined) next.duration = patch.duration;
  if (patch.cutTime !== undefined) next.cutTime = patch.cutTime;
  if (patch.camera !== undefined) next.camera = patch.camera;
  if (patch.category !== undefined) {
    next.category = patch.category;
    if (next.category === 'transition' && next.cutTime === null) {
      const d = typeof next.duration === 'number' ? next.duration : 1;
      next.cutTime = Math.round((d / 2) * 1000) / 1000;
    }
  }
  return next;
}

export const EDIT_COMMANDS: AnyCommand[] = [
  defineCommand({
    id: 'animUpdateLayer',
    titleKey: 'anim.commands.updateLayer',
    effect: 'write',
    undoLabelKey: 'anim.history.layer',
    hideInPalette: true,
    enabled: isAnimationActive,
    input: z.strictObject({ layer: LayerId, fields: z.record(FieldName, Json) }),
    output: z.boolean(),
    run: ({ layer, fields }) => apply((doc) => updateLayer(doc, layer, fields)),
  }),
  defineCommand({
    id: 'animSetPropValues',
    titleKey: 'anim.commands.setPropValues',
    effect: 'write',
    undoLabelKey: 'anim.history.keyframe',
    hideInPalette: true,
    enabled: isAnimationActive,
    // 不给 t 时是播放头的时刻。有关键帧的属性在这一刻落关键帧，绑定到参数的改参数的默认值（同检查器和预览里的拖动）
    input: z.strictObject({ layer: LayerId, values: z.partialRecord(z.enum(ANIM_PROPS), z.number().refine(Number.isFinite)), t: z.number().min(0).max(30).optional() }),
    output: z.boolean(),
    run: ({ layer, values, t }) => apply((doc) => setPropValues(doc, layer, values, t ?? useTransportStore.getState().time)),
  }),
  defineCommand({
    id: 'animUpdateDoc',
    titleKey: 'anim.commands.updateDoc',
    effect: 'write',
    undoLabelKey: 'anim.history.doc',
    hideInPalette: true,
    enabled: isAnimationActive,
    input: DocPatch,
    output: z.boolean(),
    run: (patch) => apply((doc) => updateDoc(doc, patch)),
  }),
];
