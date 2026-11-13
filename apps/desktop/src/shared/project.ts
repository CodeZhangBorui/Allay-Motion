// 工程文件 .allay（docs/01-product-architecture.md 1.9）与 project 命名空间的 IPC 数据。
// 渲染进程看不到路径：打开、保存的工程用主进程签发的不透明句柄表示；texture 参数里用户选的图片是 file:<引用>，
// 主进程保存时换成 files 里的本机路径，打开时再签发新的引用（1.6 第 6 条）。
import { TemplateIdSchema } from '@allay/template-sdk';
import { z } from 'zod';
import { ExportPresetSchema } from './export';

export const PROJECT_FORMAT_VERSION = 1;
export const PROJECT_EXTENSION = 'allay';
/** 工程文件大小上限（纯 JSON，正常不过几 KB） */
export const MAX_PROJECT_BYTES = 2 * 1024 * 1024;
export const MAX_RECENTS = 10;

const ParamKey = z.string().regex(/^[a-z][a-zA-Z0-9]*$/).max(64);
const ParamsSchema = z.record(ParamKey, z.json()).refine((p) => Object.keys(p).length <= 128, 'too many params');

export const ProjectOutputSchema = z.strictObject({
  width: z.int().min(16).max(8192),
  height: z.int().min(16).max(8192),
  fps: z.union([z.literal(24), z.literal(25), z.literal(30), z.literal(50), z.literal(60)]),
});

export const ProjectExportSchema = z.strictObject({
  preset: ExportPresetSchema,
  quality: z.enum(['draft', 'standard', 'high', 'ultra']),
  shutterAngle: z.number().min(0).max(360),
});

export const ProjectPreviewSchema = z.strictObject({
  background: z.enum(['checker', 'sample', 'solid']),
});

/** 渲染进程交给主进程保存的内容（不含 files：file: 引用留在 params 里，由主进程换成路径） */
export const ProjectDataSchema = z.strictObject({
  name: z.string().trim().min(1).max(120),
  template: z.strictObject({ id: TemplateIdSchema, version: z.string().min(1).max(64) }),
  params: ParamsSchema,
  output: ProjectOutputSchema,
  export: ProjectExportSchema,
  preview: ProjectPreviewSchema,
  /** 只是记一笔保存时启用了哪些层（1.9） */
  resourceHint: z.array(z.string().max(200)).max(64),
});
export type ProjectData = z.infer<typeof ProjectDataSchema>;

/** 磁盘上的 .allay */
export const ProjectFileSchema = z.looseObject({
  formatVersion: z.literal(PROJECT_FORMAT_VERSION),
  appVersion: z.string().max(64).optional(),
  name: z.string().max(120).catch('').default(''),
  template: z.strictObject({ id: TemplateIdSchema, version: z.string().min(1).max(64) }),
  params: ParamsSchema.catch({}).default({}),
  output: ProjectOutputSchema.catch({ width: 1920, height: 1080, fps: 60 }).default({ width: 1920, height: 1080, fps: 60 }),
  export: ProjectExportSchema.catch({ preset: 'prores4444', quality: 'standard', shutterAngle: 180 }).default({ preset: 'prores4444', quality: 'standard', shutterAngle: 180 }),
  preview: ProjectPreviewSchema.catch({ background: 'checker' }).default({ background: 'checker' }),
  files: z.record(ParamKey, z.string().max(4096)).catch({}).default({}),
  resourceHint: z.array(z.string().max(200)).max(64).catch([]).default([]),
});
export type ProjectFile = z.infer<typeof ProjectFileSchema>;

export const ProjectHandleSchema = z.uuid();

export type ProjectOpenResult =
  | { canceled: true }
  | { canceled?: false; ok: false; error: 'unreadable' | 'invalid' | 'too-new' | 'too-large' | 'missing' }
  | {
      canceled?: false;
      ok: true;
      handle: string;
      /** 文件名（不含扩展名），界面上当工程名 */
      name: string;
      data: ProjectData;
      /** 找不到的图片对应的参数 key：这些参数回到默认值并提示（1.9） */
      missingFiles: string[];
    };

export type ProjectSaveResult = { canceled: true } | { canceled?: false; ok: false; error: 'not-writable' | 'unknown-handle' } | { canceled?: false; ok: true; handle: string; name: string };

export interface RecentProject {
  /** 不透明句柄：openRecent 用 */
  id: string;
  name: string;
  /** 所在文件夹，只用于显示 */
  folder: string;
}
