// 宿主与引擎 Worker 之间的协议数据（docs/02-engine.md 2.3）。
// 线程边界两侧都用这些 schema 校验：Worker 校验宿主发来的请求，宿主校验 Worker 交回的结果。
// 放在 template-sdk 是因为引擎只能依赖 three、template-sdk、assets（1.4），而这些 schema 需要 zod。
import { z } from 'zod';
import type { ParamValue } from './runtime';

export const ParamValueSchema: z.ZodType<ParamValue> = z.lazy(() =>
  z.union([z.number(), z.string(), z.boolean(), z.null(), z.array(ParamValueSchema), z.record(z.string(), ParamValueSchema)]),
);
export const ParamValuesSchema = z.record(z.string(), ParamValueSchema);

export const LocalizedStringSchema = z.union([z.string(), z.strictObject({ 'zh-CN': z.string().optional(), en: z.string().optional() })]);

/**
 * M1 用到的 manifest 字段。完整的 schema（参数定义、分组、时间段、派生）在 M3 加入（04-templates.md 4.3）。
 * 未知字段保留但忽略。
 */
export const TemplateManifestSchema = z.looseObject({
  formatVersion: z.literal(1),
  id: z.string().regex(/^[a-z0-9]+(\.[a-z0-9-]+)+$/),
  version: z.string().min(1).max(64),
  name: LocalizedStringSchema,
  category: z.enum(['transition', 'overlay', 'title']),
});
export type TemplateManifest = z.infer<typeof TemplateManifestSchema>;

export const OutputSettingsSchema = z.strictObject({
  width: z.int().min(16).max(8192),
  height: z.int().min(16).max(8192),
  fps: z.int().min(1).max(240),
});
export type OutputSettings = z.infer<typeof OutputSettingsSchema>;

/** 模板源码上限（04-templates.md 4.8 第 3 步） */
export const MAX_TEMPLATE_CODE_BYTES = 1024 * 1024;

export const LoadRequestSchema = z.strictObject({
  manifest: TemplateManifestSchema,
  code: z.string().min(1).max(MAX_TEMPLATE_CODE_BYTES),
  params: ParamValuesSchema,
  output: OutputSettingsSchema,
  resourceStamp: z.string().max(256),
});
export type LoadRequest = z.infer<typeof LoadRequestSchema>;

export const AudioCueSchema = z.strictObject({
  sound: z.string(),
  at: z.number(),
  gain: z.number(),
  rate: z.number(),
  pan: z.number(),
});
export type AudioCue = z.infer<typeof AudioCueSchema>;

export const LoadResultSchema = z.strictObject({
  duration: z.number().min(0.1).max(30),
  cutTime: z.number().nullable(),
  audioCues: z.array(AudioCueSchema),
  warnings: z.array(z.string()),
});
export type LoadResult = z.infer<typeof LoadResultSchema>;

export const FrameQualitySchema = z.strictObject({
  /** 1 表示没有运动模糊 */
  subframes: z.int().min(1).max(64),
  /** 快门角，度 */
  shutterAngle: z.number().min(0).max(360),
});
export type FrameQuality = z.infer<typeof FrameQualitySchema>;

export const OpaqueSchema = z.strictObject({ key: z.string().regex(/^#[0-9a-fA-F]{6}$/) });
export type Opaque = z.infer<typeof OpaqueSchema>;

export const FrameStatsSchema = z.strictObject({ t: z.number(), ms: z.number() });
export type FrameStats = z.infer<typeof FrameStatsSchema>;

export const ResourceKindSchema = z.enum(['texture', 'sound-meta', 'font', 'raw']);
export type ResourceKind = z.infer<typeof ResourceKindSchema>;

/** 资源的最大边长 */
export const MAX_TEXTURE_SIZE = 4096;

/** 解码好的 RGBA8 贴图（直通 alpha，sRGB 编码，第一行是图像顶部） */
export const TexturePayloadSchema = z
  .strictObject({
    kind: z.literal('rgba'),
    width: z.int().min(1).max(MAX_TEXTURE_SIZE),
    height: z.int().min(1).max(MAX_TEXTURE_SIZE),
    data: z.instanceof(Uint8Array),
  })
  .refine((p) => p.data.byteLength === p.width * p.height * 4, { message: 'data length must be width * height * 4' });
export type TexturePayload = z.infer<typeof TexturePayloadSchema>;

/** M1 只有贴图一种载荷；声音、字体、原始数据在 M2 加入 */
export const ResourcePayloadSchema = TexturePayloadSchema;
export type ResourcePayload = TexturePayload;

export const EngineModeSchema = z.enum(['preview', 'export', 'utility']);
export type EngineMode = z.infer<typeof EngineModeSchema>;

export const ResizeSchema = z.tuple([z.int().min(1).max(8192), z.int().min(1).max(8192)]);
