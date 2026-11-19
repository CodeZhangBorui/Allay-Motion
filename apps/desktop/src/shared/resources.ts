import { isSafeRelativePath } from '@allay/assets';
import { z } from 'zod';

// resources、cache 两个 IPC 命名空间的数据（docs/01-product-architecture.md 1.8、docs/03-assets.md）。
// 主进程和渲染进程共用；入参 schema 在 ipc-contract.ts 里组装成 tuple。

/** 资源栈里一层的展示信息（6.4 资源栈弹层） */
export interface LayerInfo {
  id: string;
  kind: 'builtin' | 'vanilla' | 'pack';
  name: string;
  description?: string;
  packFormat?: number;
  /** pack.png（渲染进程做成 blob URL 显示） */
  icon?: Uint8Array;
  enabled: boolean;
  /** 1.12 及更早的命名，大部分贴图不会生效（3.5） */
  legacyFormat: boolean;
  warnings: string[];
  /** 原版层：本机游戏还是下载的；资源包：zip、文件夹、原地引用的本机 zip（linked）、导入的音效（imported） */
  source?: 'local' | 'downloaded' | 'zip' | 'folder' | 'linked' | 'imported';
  /** 内置层里有没有任何文件（v1 不自制素材，通常是空的） */
  empty?: boolean;
  /** 原版层：版本号、游戏目录（本机的）、这一版的资源包格式号（“75”或“69.0”这样的文字） */
  versionId?: string;
  gameDir?: string;
  resourceFormat?: string;
  /** 原版层：是不是生效的原版基底（最上面启用的原版层） */
  base?: boolean;
  /** 原版层：资源索引在不在（不在时没有音效和中文语言文件） */
  hasAssetIndex?: boolean;
  /** 资源包：pack.mcmeta 声明的格式范围（文字）、按对照表推出的“为哪个版本制作”、与原版基底的匹配 */
  formats?: { min: string; max: string } | null;
  madeFor?: string | null;
  compat?: 'ok' | 'older' | 'newer' | 'unknown';
  /** 资源包：文件在本机的位置（文件夹、原地引用的 zip） */
  path?: string;
}

/** 设置里登记了、但打不开的资源包（文件被删、zip 被拒绝） */
export interface BrokenPack {
  id: string;
  name: string;
  problem: 'missing' | 'rejected' | 'unreadable';
}

export interface VanillaState {
  /** 用户是否同意使用原版素材；null 表示还没问过 */
  consent: boolean | null;
  enabled: boolean;
  /** 本机探测到的游戏（离线） */
  local: { versionId: string; gameDir: string } | null;
  /** 下载缓存里的版本（离线检查） */
  cached: { versionId: string } | null;
  /** 当前资源栈里用的是哪个 */
  active: 'local' | 'cached' | null;
  /** 同意过使用原版素材，但游戏和下载缓存都找不到了（missing），或者 jar 打不开（jar-unreadable）；已静默退回 */
  problem: 'missing' | 'jar-unreadable' | null;
  /** 生效的原版基底（资源栈里最上面启用的原版层）的层 id 和版本；没有时为 null */
  baseId: string | null;
  baseVersion: string | null;
  /** 设置里登记了、但现在打不开的原版来源（游戏被移动、缓存被删） */
  missingSources: { id: string; versionId: string; kind: 'local' | 'downloaded'; gameDir?: string }[];
}

// ---- 版本检索（docs/03-assets.md 3.12）----

export type VersionKind = 'release' | 'snapshot' | 'old';

export interface VersionEntry {
  versionId: string;
  type: VersionKind;
  /** ISO 时间；版本清单里缺失时为空串 */
  releaseTime: string;
  /** 本机的：所在游戏目录 */
  gameDir?: string;
  /** 已经在资源栈里（对应的层 id） */
  layerId: string | null;
}

export interface VersionCatalog {
  /** 本机游戏目录里带 jar 的版本（官方启动器、用户选过的目录） */
  local: VersionEntry[];
  /** 下载缓存里完整的版本 */
  downloaded: VersionEntry[];
  /** Mojang 版本清单（用户点了“获取版本列表”之后才有，本次运行内有效） */
  remote: { latest: string; versions: VersionEntry[] } | null;
}

export type RemoteVersionsResult = { ok: true; catalog: VersionCatalog } | { ok: false; error: DownloadErrorKind };

export const VanillaSourceArgSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('local'), gameDir: z.string().min(1).max(4096), versionId: z.string().min(1).max(64).regex(/^[\w.-]+$/) }),
  z.strictObject({ kind: z.literal('downloaded'), versionId: z.string().min(1).max(64).regex(/^[\w.-]+$/) }),
]);
export type VanillaSourceArg = z.infer<typeof VanillaSourceArgSchema>;
export const VersionIdArgSchema = z.string().min(1).max(64).regex(/^[\w.-]+$/).refine((s) => s !== '.' && s !== '..');

// ---- 本机 Minecraft 的资源包文件夹 ----

export interface LocalPackFolderInfo {
  launcher: 'official' | 'isolated' | 'prism' | 'curseforge' | 'modrinth';
  instance: string | null;
  gameVersion: string | null;
  path: string;
  packs: {
    name: string;
    path: string;
    kind: 'zip' | 'folder';
    description?: string;
    formats: { min: string; max: string } | null;
    madeFor: string | null;
    compat: 'ok' | 'older' | 'newer' | 'unknown';
    /** 已经在资源栈里 */
    added: boolean;
  }[];
}

export const LocalPackPathSchema = z.string().min(3).max(32_767);

export const DOWNLOAD_ERROR_KINDS = ['network', 'verify', 'disk', 'unknown'] as const;
export type DownloadErrorKind = (typeof DOWNLOAD_ERROR_KINDS)[number];

// ---- 下载原版资源的进度（docs/06-ui-design.md 6.12、docs/decisions.md 界面增强）----
// 五个阶段按顺序走，各有自己的状态；整体进度按字节算（jar、资源索引、音效对象），只增不减，成功之前不到 100%。
// 主进程算好，经 resources:changed 推给渲染进程；渲染进程收到时用 DownloadStateSchema 校验。

/** 取版本清单 → 下载客户端 jar → 提取资源（资源索引、读 jar 的条目目录）→ 取常用音效 → 建立资源栈（完成） */
export const DOWNLOAD_STAGES = ['manifest', 'jar', 'extract', 'sounds', 'finalize'] as const;
export const DownloadStageSchema = z.enum(DOWNLOAD_STAGES);
export type DownloadStage = z.infer<typeof DownloadStageSchema>;

export const STAGE_STATUSES = ['pending', 'active', 'done', 'failed', 'canceled'] as const;
export type StageStatus = (typeof STAGE_STATUSES)[number];

/** 当前在做什么（界面上的一行字） */
export const DOWNLOAD_ACTIVITIES = ['manifest', 'version', 'jar', 'jar-cached', 'index', 'scan', 'sounds-list', 'sounds', 'stack', 'done'] as const;
export type DownloadActivity = (typeof DOWNLOAD_ACTIVITIES)[number];

const Bytes = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);

export const DownloadProgressViewSchema = z.strictObject({
  stage: DownloadStageSchema,
  stages: z
    .array(z.strictObject({ id: DownloadStageSchema, status: z.enum(STAGE_STATUSES), received: Bytes, total: Bytes.nullable() }))
    .length(DOWNLOAD_STAGES.length)
    .refine((list) => list.every((s, i) => s.id === DOWNLOAD_STAGES[i]), 'stages out of order'),
  /** 整体：已收到的字节（含已缓存、跳过的文件）和目前已知的总字节；版本 JSON 读到之前总数未知 */
  received: Bytes,
  total: Bytes.nullable(),
  /** 0–1，只增不减；完成之前最多 0.99 */
  fraction: z.number().min(0).max(1),
  /** 最近约 3 秒的平均速度（字节/秒）；数据不够时为 null */
  bytesPerSecond: z.number().nonnegative().finite().nullable(),
  /** 剩下的字节按当前速度还要多少秒；不知道时为 null */
  etaSeconds: z.number().nonnegative().finite().nullable(),
  /** 读到版本 JSON 之后才有 */
  versionId: z.string().max(64).nullable(),
  activity: z.enum(DOWNLOAD_ACTIVITIES),
  /** 音效阶段：第几个文件 / 一共几个 */
  items: z.strictObject({ done: z.number().int().nonnegative(), total: z.number().int().nonnegative() }).nullable(),
});
export type DownloadProgressView = z.infer<typeof DownloadProgressViewSchema>;

export const DownloadStateSchema = z.discriminatedUnion('status', [
  z.strictObject({ status: z.literal('idle') }),
  z.strictObject({ status: z.literal('running'), progress: DownloadProgressViewSchema }),
  /** 成功：留着最后的进度，直到下一次下载（引导页用它显示“完成”） */
  z.strictObject({ status: z.literal('done'), progress: DownloadProgressViewSchema }),
  /** 失败、取消：progress.stage 是停下的那一步，那一步的状态是 failed / canceled */
  z.strictObject({ status: z.literal('failed'), error: z.enum(DOWNLOAD_ERROR_KINDS), progress: DownloadProgressViewSchema }),
  z.strictObject({ status: z.literal('canceled'), progress: DownloadProgressViewSchema }),
]);
export type DownloadState = z.infer<typeof DownloadStateSchema>;

export interface ResourceState {
  /** 资源栈指纹（3.2）：变了，引擎缓存和缩略图缓存一起失效 */
  stamp: string;
  /** 从下到上，与解析顺序相反（下标 0 是 builtin） */
  layers: LayerInfo[];
  brokenPacks: BrokenPack[];
  vanilla: VanillaState;
  download: DownloadState;
  /** 还在启动时的离线探测 */
  detecting: boolean;
  /** 有没有任何启用的素材层（原版层或资源包）。都没有时界面显示引导状态 */
  hasAssets: boolean;
}

export type AddPackResult =
  | { ok: true; id: string; warnings: string[] }
  | { ok: false; error: 'rejected' | 'unsupported' | 'unreadable'; detail?: string }
  | { canceled: true };

export type ChooseGameDirResult = { ok: true } | { ok: false; error: 'no-release' } | { canceled: true };

export type DownloadResult = { ok: true } | { ok: false; error: DownloadErrorKind | 'busy' } | { canceled: true };

/** fontProviders 的结果：bitmap 提供器只给贴图在资源栈里的路径，由渲染进程读取解码 */
export interface FontProvidersResult {
  providers: (
    | { type: 'bitmap'; file: string; ascent: number; height: number; rows: number[][] }
    | { type: 'space'; advances: [number, number][] }
  )[];
  skipped: string[];
}

/** 音效事件的一个变体（resources.soundVariants）：file 是带命名空间的音效名 */
export interface SoundVariantInfo {
  file: string;
  volume: number;
  pitch: number;
  weight: number;
  /** 衰减距离（格）：sounds.json 的 attenuation_distance，没写时 16（空间音效用） */
  attenuation?: number;
}

/**
 * 一个音效文件（或事件）现在能不能放：local 在本地；remote 在下载缓存的原版层的资源索引里、还没取回，
 * 用户试听或选中时可以按需从 Mojang 取（decisions.md M6b）；missing 哪里都没有。
 */
export type SoundFileState = 'local' | 'remote' | 'missing';

/**
 * 音效的来源（2026-11 反馈）：vanilla 只有原版定义且文件来自原版；overridden 原版有、但资源包改了定义或替换了文件；
 * added 原版没有、资源包新加的；imported 用户自己导入的文件。
 */
export type SoundOrigin = 'vanilla' | 'overridden' | 'added' | 'imported';

/** 音效选择器的分类（@allay/assets 的 SOUND_CATEGORIES） */
export type SoundCategoryKey = 'ambient' | 'block' | 'enchant' | 'entity' | 'event' | 'item' | 'music' | 'music_disc' | 'particle' | 'ui' | 'weather' | 'other';

export interface SoundLibraryEvent {
  id: string;
  state: SoundFileState;
  origin: SoundOrigin;
  /** overridden、added：改动它的资源包的名字（多个时最上面的那个在前） */
  packs?: string[];
  category: SoundCategoryKey;
  /** 从语言文件推出的显示名；推不出时缺省（界面显示 ID） */
  names?: { 'zh-CN'?: string; en?: string };
}

/** 音效选择器的库：资源栈合并后的 sounds.json 里的全部事件 */
export interface SoundLibrary {
  stamp: string;
  events: SoundLibraryEvent[];
  /** 名称来源：两种语言的语言文件在不在（zh_cn 不在时中文界面显示英文字幕） */
  lang: { 'zh-CN': boolean; en: boolean };
}

export type ImportSoundsResult = { ok: true; ids: string[]; skipped: number } | { ok: false; error: 'unsupported' | 'unreadable' } | { canceled: true };
export const ImportedSoundIdSchema = z.string().regex(/^allay_user:imported\.[a-z0-9_]{1,64}$/);

export type SoundFilesResult = { ok: true; states: Record<string, SoundFileState> } | { ok: false; error: DownloadErrorKind; states: Record<string, SoundFileState> };

/** 一次最多问多少个音效文件 */
export const MAX_SOUND_FILES = 256;
export const SoundFileNamesSchema = z.array(z.string().min(3).max(256).regex(/^[a-z0-9_.-]+:[a-z0-9_./-]+$/)).max(MAX_SOUND_FILES);

export interface CacheUsage {
  files: number;
  bytes: number;
}

// ---- 入参 schema ----

export const ResourcePathSchema = z.string().min(1).max(1024).refine(isSafeRelativePath, { message: 'unsafe resource path' });
export const ResourceIdSchema = z.string().min(1).max(512);
/** 音效事件 ID：命名空间:路径（路径里可以有点），例如 minecraft:block.stone.place */
export const SoundEventIdSchema = z.string().min(3).max(256).regex(/^[a-z0-9_.-]+:[a-z0-9_./-]+$/);
export const ResourcePrefixSchema = z.string().max(1024).refine((p) => p === '' || isSafeRelativePath(p.replace(/\/$/, '')), { message: 'unsafe prefix' });
export const LayerIdSchema = z.string().min(1).max(128);
export const VanillaPatchSchema = z.strictObject({ consent: z.boolean().optional(), enabled: z.boolean().optional() });
export const AddPackKindSchema = z.enum(['zip', 'folder']);
/** 拖放的文件：preload 用 webUtils.getPathForFile 取的路径（页面只传 File） */
export const DroppedPathSchema = z.string().min(3).max(32_767);

export const ResourceStampSchema = z.string().regex(/^[0-9a-f]{16}$/);
/** 缩略图的键：渲染进程把 ID 里的 : 和 / 换成 ~ */
export const ThumbKeySchema = z.string().regex(/^[a-z0-9_.~-]{1,200}$/);
/** 缩略图上限；模板封面的悬停预览是一张帧网格图，放宽到 8 MB（decisions.md M4） */
export const MAX_THUMB_BYTES = 8 * 1024 * 1024;
export const ThumbPngSchema = z.instanceof(Uint8Array).refine((b) => b.byteLength > 8 && b.byteLength <= MAX_THUMB_BYTES, { message: 'thumbnail must be a PNG of at most 8 MB' });
