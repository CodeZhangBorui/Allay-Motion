// 宿主与引擎 Worker 之间的协议数据（docs/02-engine.md 2.3）。
// 线程边界两侧都用这些 schema 校验：Worker 校验宿主发来的请求，宿主校验 Worker 交回的结果。
// 放在 template-sdk 是因为引擎只能依赖 three、template-sdk、assets（1.4），而这些 schema 需要 zod。
import { z } from 'zod';
import { TemplateManifestSchema } from './manifest';
import type { ParamValue } from './runtime';

export const ParamValueSchema: z.ZodType<ParamValue> = z.lazy(() =>
  z.union([z.number(), z.string(), z.boolean(), z.null(), z.array(ParamValueSchema), z.record(z.string(), ParamValueSchema)]),
);
export const ParamValuesSchema = z.record(z.string(), ParamValueSchema);

export { TemplateManifestSchema, type TemplateManifest } from './manifest';

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
  /** text 参数缺值时按这个语言取默认值（4.4）；缺省英文 */
  locale: z.string().max(16).optional(),
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

/** 类型化数组：不限定底层缓冲的类型（ArrayBuffer 或 SharedArrayBuffer 都接受，运行时只认构造函数） */
const typedArray = <T extends ArrayBufferView>(ctor: abstract new (...args: never[]) => T) => z.custom<T>((v) => v instanceof ctor, { message: `expected ${ctor.name}` });

const RgbaImageShape = {
  width: z.int().min(1).max(MAX_TEXTURE_SIZE),
  height: z.int().min(1).max(MAX_TEXTURE_SIZE),
  data: typedArray<Uint8Array>(Uint8Array),
};
const rgbaLengthOk = (p: { width: number; height: number; data: Uint8Array }) => p.data.byteLength === p.width * p.height * 4;
const RGBA_LENGTH_MESSAGE = { message: 'data length must be width * height * 4' };

export const RgbaImageSchema = z.strictObject(RgbaImageShape).refine(rgbaLengthOk, RGBA_LENGTH_MESSAGE);
export type RgbaImage = z.infer<typeof RgbaImageSchema>;

/**
 * 解码好的 RGBA8 贴图（直通 alpha，sRGB 编码，第一行是图像顶部）。
 * mcmeta 是与这张图来自同一层的 `.png.mcmeta` 原文（动画、界面九宫格），引擎自己解析。
 */
export const TexturePayloadSchema = z
  .strictObject({ kind: z.literal('rgba'), ...RgbaImageShape, mcmeta: z.string().max(65_536).optional() })
  .refine(rgbaLengthOk, RGBA_LENGTH_MESSAGE);
export type TexturePayload = z.infer<typeof TexturePayloadSchema>;

/** 资源栈里的位图字体（原版 font/*.json 展开 reference 之后的 bitmap、space 提供器，3.9） */
export const FontProviderPayloadSchema = z.discriminatedUnion('type', [
  z.strictObject({
    type: z.literal('bitmap'),
    ascent: z.int().min(-512).max(512),
    height: z.int().min(1).max(512),
    rows: z.array(z.array(z.int().min(0).max(0x10ffff)).max(1024)).max(1024),
    image: RgbaImageSchema,
  }),
  z.strictObject({ type: z.literal('space'), advances: z.array(z.tuple([z.int().min(0).max(0x10ffff), z.number().min(-512).max(512)])).max(65_536) }),
]);
export type FontProviderPayload = z.infer<typeof FontProviderPayloadSchema>;

export const FontPayloadSchema = z.strictObject({
  kind: z.literal('font'),
  providers: z.array(FontProviderPayloadSchema).max(256),
  /** 跳过的提供器（unihex、ttf、缺失的贴图等），供诊断 */
  skipped: z.array(z.string()).max(256),
});
export type FontPayload = z.infer<typeof FontPayloadSchema>;

/** 兜底的 BDF 像素字体（@allay/assets 的 BitmapFontTables） */
export const BitmapFontPayloadSchema = z
  .strictObject({
    kind: z.literal('bdf'),
    ascent: z.int().min(0).max(64),
    descent: z.int().min(0).max(64),
    codepoints: typedArray<Uint32Array>(Uint32Array),
    metrics: typedArray<Int16Array>(Int16Array),
    offsets: typedArray<Uint32Array>(Uint32Array),
    bits: typedArray<Uint8Array>(Uint8Array),
  })
  .refine((p) => p.metrics.length === p.codepoints.length * 5 && p.offsets.length === p.codepoints.length, { message: 'table lengths mismatch' });
export type BitmapFontPayload = z.infer<typeof BitmapFontPayloadSchema>;

export const ResourcePayloadSchema = z.union([TexturePayloadSchema, FontPayloadSchema, BitmapFontPayloadSchema]);
export type ResourcePayload = z.infer<typeof ResourcePayloadSchema>;

/** 资源栈里的默认字体，和兜底字体的 ID（resolveResource('font', id)） */
export const DEFAULT_FONT_ID = 'minecraft:default';
export const FALLBACK_FONT_ID = 'allay:fallback';

/** 缩略图请求（03-assets.md 3.10）：方块是带面明暗的等轴视角，物品正面平视 */
export const ThumbRequestSchema = z.strictObject({
  kind: z.enum(['block', 'item']),
  id: z.string().min(1).max(256),
  size: z.union([z.literal(64), z.literal(128)]),
  resourceStamp: z.string().max(256),
});
export type ThumbRequest = z.infer<typeof ThumbRequestSchema>;

export const EngineModeSchema = z.enum(['preview', 'export', 'utility']);
export type EngineMode = z.infer<typeof EngineModeSchema>;

export const ResizeSchema = z.tuple([z.int().min(1).max(8192), z.int().min(1).max(8192)]);
