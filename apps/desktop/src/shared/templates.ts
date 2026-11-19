// 模板与预设在主进程和渲染进程之间传的数据（docs/04-templates.md 4.7、4.8；01-product-architecture.md 1.8）。
import { TemplateIdSchema, type ParamValues, type ResolvedTemplate, type TemplateDiagnostic, type TemplateManifest } from '@allay/template-sdk';
import { z } from 'zod';

/** 模板包大小上限（4.8 第 1 步） */
export const MAX_PACKAGE_BYTES = 50 * 1024 * 1024;
/** 包里所有条目解压后的总大小上限、单个条目上限、条目数上限（解压炸弹，1.6 第 9 条） */
export const MAX_PACKAGE_UNPACKED_BYTES = 200 * 1024 * 1024;
export const MAX_PACKAGE_ENTRY_BYTES = 50 * 1024 * 1024;
export const MAX_PACKAGE_ENTRIES = 2000;
/** 包里允许的扩展名（4.8 第 1 步） */
export const PACKAGE_EXTENSIONS: readonly string[] = ['.json', '.js', '.png', '.webp', '.jpg', '.ogg', '.wav', '.md', '.txt'];

/** resources/templates/ 里内置模板包的文件名 */
export function packageFileName(id: string, version: string): string {
  return `${id}-${version}.allaytpl`;
}

/** 安装校验的错误码（4.8），界面按错误码显示文案 */
export const INSTALL_ERROR_CODES = [
  'not-a-zip',
  'package-too-large',
  'unsafe-path',
  'bad-extension',
  'unpacked-too-large',
  'manifest-missing',
  'manifest-invalid',
  'format-too-new',
  'app-too-old',
  'reserved-id',
  'base-missing',
  'base-not-script',
  'code-missing',
  'derived-has-code',
  'code-too-large',
  'code-has-import',
  'code-syntax',
  'trial-failed',
  'staging-expired',
] as const;
export type InstallErrorCode = (typeof INSTALL_ERROR_CODES)[number];

export interface InstallError {
  code: InstallErrorCode;
  /** 给人看的细节（出错的字段、条目名），英文，界面放在错误码对应文案的后面 */
  detail: string;
  /** 源码预检失败（code-syntax、code-has-import、code-too-large）时的 compile 类诊断，能定位时带行列 */
  diagnostic?: TemplateDiagnostic;
}

/** 试运行（4.8 第 4 步）发现的问题：只是警告，仍允许安装 */
export const TRIAL_WARNINGS = ['nondeterministic', 'first-frame-visible', 'last-frame-visible', 'cut-not-opaque', 'load-warnings'] as const;
export type TrialWarning = (typeof TRIAL_WARNINGS)[number];

export const InstallReportSchema = z.strictObject({
  warnings: z.array(z.enum(TRIAL_WARNINGS)).max(TRIAL_WARNINGS.length),
});
export type InstallReport = z.infer<typeof InstallReportSchema>;

export type TemplateSourceKind = 'builtin' | 'user';

/** templates.list 的一项 */
export interface TemplateEntry {
  id: string;
  version: string;
  source: TemplateSourceKind;
  kind: 'script' | 'derived';
  manifest: TemplateManifest;
  /** 派生模板的基模板缺失（被删除或版本不匹配）：保留但不能装载（4.8 末尾） */
  baseMissing: boolean;
  /** 安装时试运行留下的警告（内置模板为空） */
  trialWarnings: TrialWarning[];
}

/** templates.read 的结果：装载需要的一切 */
export interface TemplateBundle {
  entry: TemplateEntry;
  resolved: ResolvedTemplate;
  /** 基模板（派生模板）或它自己（脚本模板）的源码 */
  code: string;
}

/** 安装的第一阶段（主进程做完 4.8 第 1–3 步，包已解压到暂存区）：交给渲染进程试运行 */
export type StageResult =
  | { canceled: true }
  | { canceled?: false; ok: false; error: InstallError }
  | {
      canceled?: false;
      ok: true;
      stagingId: string;
      bundle: TemplateBundle;
      replaces: boolean;
      /**
       * 确定性静态规则的提示（H12）。只是提示：提交安装时主进程自己把它并进 nondeterministic 警告，
       * 渲染进程不用转交；附在这里供将来显示位置。
       */
      ruleDiagnostics: TemplateDiagnostic[];
    };

export type CommitResult = { ok: true; entry: TemplateEntry } | { ok: false; error: InstallError };

export const StagingIdSchema = z.uuid();
export const TemplateVersionArgSchema = z.string().min(1).max(64);
export const TemplateIdArgSchema = TemplateIdSchema;
/** 模板包 assets/ 里的相对路径 */
export const AssetPathSchema = z.string().min(1).max(200);

/** 另存为派生模板（4.7）：渲染进程交来名称、基模板、要覆盖的默认值和要隐藏的参数 */
export const SaveDerivedSchema = z.strictObject({
  base: z.strictObject({ id: TemplateIdSchema, version: TemplateVersionArgSchema }),
  name: z.string().trim().min(1).max(60),
  defaults: z.record(z.string().max(64), z.json()),
  hidden: z.array(z.string().max(64)).max(128),
});
export type SaveDerivedRequest = z.infer<typeof SaveDerivedSchema>;

// ---- 预设 ----

export const PresetIdSchema = z.string().regex(/^[0-9a-f]{32}$/);

export const SavePresetSchema = z.strictObject({
  template: z.strictObject({ id: TemplateIdSchema, version: TemplateVersionArgSchema }),
  name: z.string().trim().min(1).max(100),
  /** 已经由渲染进程按参数定义去掉与默认值相同的项；主进程再按 schema 校验一次 */
  params: z.record(z.string().max(64), z.json()),
});
export type SavePresetRequest = z.infer<typeof SavePresetSchema>;

export interface PresetEntry {
  id: string;
  name: string;
  template: { id: string; version: string };
  params: ParamValues;
  createdAt: string;
}

export type PresetImportResult = { canceled: true } | { canceled?: false; ok: true; entry: PresetEntry } | { canceled?: false; ok: false; error: string };
export type ExportFileResult = { canceled: true } | { canceled?: false; ok: true; path: string };

// ---- 模板开发模式（docs/08-milestones.md MD）----

/** templates.copyBuiltin 的入参：要复制的内置模板，以及可选的新名字（不给时沿用原名） */
export const CopyBuiltinSchema = z.strictObject({
  id: TemplateIdSchema,
  version: TemplateVersionArgSchema,
  name: z.string().trim().min(1).max(60).optional(),
});
export type CopyBuiltinRequest = z.infer<typeof CopyBuiltinSchema>;

/** 开发模式各方法的失败原因（枚举值，界面按它显示文案） */
export type TemplateDevError = 'not-found' | 'not-builtin' | 'not-script' | 'bad-id' | 'not-user' | 'outside' | 'open-failed';
export type TemplateDevResult<T extends object = object> = ({ ok: true } & T) | { ok: false; error: TemplateDevError };

/**
 * 用户模板文件夹在应用之外被改动（templates.onChanged，主进程 → 渲染进程）。
 * 应用自己的写入（安装、复制、写类型定义等）不会触发。
 */
export interface TemplateDevChange {
  id: string;
  version: string;
  change: 'added' | 'changed' | 'removed';
  /** 新的内容哈希（manifest.json、template.js、assets/** 的 SHA-256）；removed 时为 null */
  hash: string | null;
  /** 改动之后这个模板还能装载（manifest 合法、template.js 在）；为 false 时它已从模板列表里移除 */
  valid: boolean;
}

// ---- 2026-11：内嵌代码编辑与自建动画（docs/decisions.md“2026-11 反馈：开发模式、代码编辑与动画编辑器”）----

/** template.js 的大小上限与安装时相同（1 MB，按 UTF-16 码元粗算） */
export const MAX_TEMPLATE_SOURCE_CHARS = 1024 * 1024;

/** templates.writeSource 的入参：只能写用户模板的 template.js；baseVersion 是读的时候拿到的内容版本 */
export const WriteSourceSchema = z.strictObject({
  id: TemplateIdSchema,
  version: TemplateVersionArgSchema,
  source: z.string().max(MAX_TEMPLATE_SOURCE_CHARS),
  baseVersion: z.string().min(1).max(200),
});
export type WriteSourceRequest = z.infer<typeof WriteSourceSchema>;

export type ReadSourceResult = { ok: true; source: string; version: string; readOnly: boolean } | { ok: false; error: 'not-found' | 'not-script' | 'outside' };

export type WriteSourceResult =
  | { ok: true; version: string }
  | { ok: false; error: 'conflict'; currentVersion: string }
  | { ok: false; error: 'not-user' | 'invalid' | 'io'; diagnostic?: TemplateDiagnostic };

/** templates.createFromAnimation 的入参：动画文档的原文（主进程自己解析、校验、生成代码） */
export const CreateFromAnimationSchema = z.strictObject({
  text: z.string().min(1).max(512 * 1024),
});

export type CreateFromAnimationResult = { ok: true; entry: TemplateEntry } | { ok: false; error: 'invalid' | 'io'; detail?: string };
